# tapedeck

A real-time equity trade blotter.
Book, amend and cancel trades; every connected browser sees each change as it happens, with netted positions alongside and a full audit trail per trade.

```sh
docker compose up --build
```

Open <http://localhost:3000>, press **Log in**, and sign in as `k.madan` with the password `tapedeck`.
Nothing else to install or configure.

It is already moving when it opens: a generated feed books, amends and cancels every couple of seconds, so the real-time behaviour demonstrates itself.
**Pause feed** stops it for every connected window.

## The two-minute demo

**Two traders, one book.**
Open a second window as <http://localhost:3000/?actor=j.okonkwo>, whose sign-in form starts on that name.
Book a trade in each and watch both rows appear in both.

**Mitigate a conflict.**
Pause the feed, then amend the same trade from both windows without reloading.
The second attempt is told the row changed underneath it, and which version it is now on.

**Right-click a pane** for its own controls: another pane, a duplicate, its configuration, a reset, a workspace link and a close.
Holding **Shift** gives the browser its own menu back.

**The check worth making.**
Pause the feed and set **Group by** to symbol.
Every group row's net quantity and net notional equal the positions panel's row for that symbol, digit for digit: one in `bigint` in the browser, the other in `numeric` in Postgres.

## The product

**The name.**
The tape is the trade feed, a blotter is what you read it on, a deck is what you play it on.

**The screen is black.**
A blotter is stared at all day, and it keeps colour for meaning: green buy, rose sell, amber held, indigo row flash.
Every colour is a named `tape-` token, and a build gate fails on a raw hex.

**Everything is monospace.**
Geist Mono, self-hosted.
Every digit is the same width, so columns line up and a wrong order of magnitude is visible without reading the number.

**A trader arranges their own screen.**
A workspace is a tree of panes you split, resize, duplicate and close, each with its own grouping, sort, filters and columns.
It all lives in the URL, so a screen is something you send rather than describe.

## Architecture decisions

One npm workspace, four packages: `shared` holds the types both sides agree on, `database` the tables and queries, `backend` the server, `frontend` the browser app.
Both halves import `shared`, so changing the shape of a trade breaks the build on both sides at once instead of failing at runtime on one.

- **The types are the design.**
  `AmendTradeInput` has only `quantity`, `price` and `version`, so amending a symbol does not compile.
- **Prices are exact decimals, never floats.**
  `numeric(18,6)` in Postgres, a string on the wire, notional in whole pennies as `bigint`.
  Startup asserts nothing is coercing `numeric` to a float.
- **`trade_events` is append-only, and its `bigserial` id is the websocket sequence number.**
  One table gives the audit trail, the feed's ordering and a seam for a message queue later.
  A trade's version is its event count.
- **Every write takes the same `pg_advisory_xact_lock` first.**
  `bigserial` hands out ids before commit, so without it seq 7 can land before seq 6 and a client caught up at 7 drops 6 forever.
- **Conflicts are decided inside that lock**, not guessed from an UPDATE that changed no rows.
  404 `NOT_FOUND`, 409 `INVALID_STATE`, 409 `VERSION_CONFLICT` with `currentVersion`, because the client handles each differently.
- **Reconnecting is the only catch-up.**
  One snapshot of trades, positions and `max(seq)`, then the frames after it.
  Anything arriving mid-snapshot is held and replayed, so nothing is lost or applied twice.
- **Only frames with a real place in the order carry a `seq`.**
  Positions are derived, so that frame has none.
  Two frames on the same cursor would break gap detection.
- **One cache entry, two writers, one rule.**
  The REST load and the socket both write `{ seq, trades, positions }`, and both reject anything older than what is cached.
  That is what makes **Refresh** safe at any moment.
- **Positions are netted in Postgres, never in the browser.**
  They arrive with the snapshot, so the panel is right on first paint.
  Grid group totals are summed in `bigint` and match it digit for digit.
- **No optimistic updates.**
  They would put a `version` on screen the server never issued.
  A row with a request in flight is dimmed instead.

### API

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | process and database liveness |
| `POST` | `/api/auth/register`, `/login`, `/logout` | mocked sign-in; login returns `{ trader, token }` |
| `GET` | `/api/auth/me` | the session a bearer token belongs to |
| `GET` | `/api/trades` | `{ seq, trades }`; filters: `symbol`, `side`, `status`, `trader`, `book` |
| `GET` | `/api/trades/:tradeId` | one trade |
| `GET` | `/api/trades/:tradeId/events` | the audit trail |
| `POST` | `/api/trades` | book |
| `PATCH` | `/api/trades/:tradeId` | amend; requires `version` |
| `POST` | `/api/trades/:tradeId/fills` | report an execution; requires `version` |
| `POST` | `/api/trades/:tradeId/cancel` | cancel; requires `version` |
| `GET` | `/api/positions` | `{ seq, positions }` |
| `GET`, `POST` | `/api/simulation` | `{ running, intervalMs }`; starts or stops the feed |
| `GET` | `/ws` | websocket; snapshot on connect, then deltas |

`GET /api/trades` returns an object rather than a bare array so the client can reject a response older than its socket already applied.
Writes take an `x-tapedeck-actor` header, recorded against every event; see Assumptions.

## Installation instructions

Nothing is required but Docker: clone the repository, then `docker compose up --build`.
`.env.example` documents every variable, and each already has the same default in `docker-compose.yml`, so a `.env` is optional.

To work on it directly, Node 22.12 or newer (`.nvmrc` says 22) and a Postgres:

```sh
npm ci
docker compose up -d db        # Postgres only, published on localhost:5433
npm run db:migrate
npm run db:seed
```

## How to run the application

```sh
docker compose up --build      # http://localhost:3000
docker compose down            # add -v to discard the database too
```

One container serves the API, the websocket and the built frontend from the same origin, which is why there is no CORS configuration anywhere and why the browser derives the websocket URL from `window.location`.
The entrypoint migrates, seeds only if the trades table is empty, then starts, so a second `docker compose up` is not a double-seeded blotter.

On the host, in two terminals:

```sh
npm run dev:api                # Fastify on :3000
npm run dev:web                # Vite on :5173, proxying /api and /ws to :3000
```

Postgres is published on **5433** so it will not collide with one already running on the reviewer's machine: inside the compose network the API uses `db:5432`, and anything on the host uses `localhost:5433`.

The seed is deterministic: every run starts from the same 400 trades across 12 symbols, 70 amended, 321 filled, 45 part filled, 27 cancelled, 863 events.
`SIMULATION_ENABLED=false` holds the blotter at exactly that state.

## How to run tests

The backend tests run against a real Postgres, so start one first.
The frontend and shared projects need nothing:

```sh
docker compose up -d db
```

They use `postgres://tapedeck:tapedeck@localhost:5433/tapedeck_test`, overridable with `TEST_DATABASE_URL`, and create that database themselves if it is not there yet.
Then:

```sh
npm run check         # typecheck, lint, palette, tests. The one to run
npm test              # all four workspaces
npm run typecheck     # tsc --noEmit over both the node and the web projects
npm run lint          # biome
npm run lint:palette  # no raw colour in a .tsx
```

They truncate and reseed between files, which is why they get a database of their own rather than sharing `tapedeck`.

`npm run check` runs the four gates in the order whose failure is cheapest to read: types, lint, palette, tests.
The two `tsc` projects are split by environment, and the root `tsconfig.json` only points an editor at both, which stops a language server inventing its own project and reporting errors the build does not have.

The tests are organised around the hard problems, not around files.
`backend/test/concurrency.test.ts` is the one that matters: two amends at the same version, `INVALID_STATE` beating a stale version on a cancelled trade, numbering staying gap-free past a digit boundary, and `version == count(events)` under load.
The websocket tests bind port 0 and connect real `ws` clients, because `app.inject()` performs no HTTP upgrade.

## Assumptions made

- **The brief contradicts itself on the trade model**, so the sample JSON was taken as the superset: `tradeId` and `tradeTimestamp`, with `book` and `counterparty`.
- **Sign-in is fake, and the trade endpoints are deliberately not behind it.**
  Accounts and tokens are Maps in the API process, and writes take the actor from an `x-tapedeck-actor` header the caller asserts.
  That header is the seam a verified identity would arrive on.
- **A session belongs to the window, not the browser**, as one `sessionStorage` entry, so two windows are two traders.
  `?actor=` only pre-fills the form, and is stripped from the address bar because that bar also carries the workspace link.
- **One currency, no currency column.**
  The twelve seeded instruments are FTSE names in pence, and a second currency needs an FX rate the brief never supplies.
- **`numeric(18,6)` rather than four decimal places**, so a converted price is not rounded at the boundary.
  `quantity` is an `integer`, capping a trade near 2.1 billion shares.
- **All times are shown in UTC and labelled as such**, because a blotter spanning venues should not guess a local zone.
- **The generated feed writes through the service layer, never straight onto the wire**, so it gets gap-free `seq`, a correct version chain and netted positions like anything else.
  It records `simulator` as the actor while booking under a real trader's name.
- **The blotter shows the most recent 500 trades, not the whole book.**
  `BLOTTER_LIMIT` lives in `shared` because the REST read, the snapshot and the cache trim must agree.
  Positions stay firm-wide, being a fact about the book rather than about the screen.
- **P&L is marked against the instrument list's reference price, not a market price.**
  The brief supplies no market data, so the column is headed `P&L vs ref` and moves when the book moves rather than when the market does.
  A symbol the list no longer carries shows a dash, since a zero would mean a flat position.
- **Symbol, book and counterparty are dropdowns over reference data**, so a booking cannot name an instrument that does not exist.
  Counterparty cannot be amended either, since it drives credit, settlement and reporting, so changing it is a cancel and rebook.
  The dropdowns closed a live defect: the form prefilled `EQ-LDN-1` against a list that said `EQ-LDN-01`.
- **Status is a fill lifecycle, not a flag**: `NEW`, `PARTIALLY_FILLED`, `FILLED`, `CANCELLED`, with `filledQuantity` behind it and a check constraint tying the two.
  Nothing is ever deleted, since cancelling is a status.
  Exposure nets what was booked rather than what executed, because a working order is risk the desk already carries.
- **Group totals exclude cancelled trades**, or the grid would disagree with the positions panel.
  Average price is a `bigint` VWAP weighted by absolute quantity, so a sell leg pulls the average rather than padding the denominator.
- **Split by pivots across the columns, not down the rows.**
  Grouped by symbol and split by side gives a `BUY` block and a `SELL` block beside it, so one line reads the whole symbol.
  Values are read off the whole book, so a keystroke cannot reshape the grid, and it is capped at eight.
- **Pane controls live on the pane, not in a shared top bar**, since one bar could only ever describe one of two open panes.
  Each grid owns a side panel for grouping, sorting, filtering and columns, and both pane and workspace actions sit behind a right-click.
  The cost is discoverability, which is why the demo spells it out.
- **A workspace is a tree of splits and travels as a readable link**: `?panes=2&p1.group=symbol&p2.where.symbol=BARC` is the whole format, carrying the view but never the data.
  A flat list with a weight per pane could not express "beside this one".
- **The magnitude bar is drawn on notional**, scaled over the filtered rows and rounded up, because 10,000 shares of a 72p stock and of a 400p stock are not comparable sizes.
- **Booking guards against the repeat, not the press**, since working an order in clips means booking the same ticket on purpose.
  An identical ticket within five seconds holds the button, one over 250,000 notional holds and says the limit, and every ticket mints a `clientTradeId` behind a unique index.

## Trade-offs accepted

- **All writes queue behind one advisory lock.**
  That is what keeps the sequence gap-free and commit-ordered, and it is a throughput ceiling taken knowingly.
  The replacement is broker-side ordering or logical decoding, not a cleverer lock.
- **The browser holds all the trades and filters locally.**
  At 500 rows it is free; it moves into the query the moment the window is the whole book.
- **A splitter writes straight to the DOM while dragging and commits once, on release.**
  The one deliberate exception to holding state in React: a pane is a virtualised grid of 500 rows, so resizing through state would re-render both panes on every pointer move.
- **Dragging a pane uses native drag and drop, so the drop zones are mouse-only.**
  The keyboard route is the handle's arrow keys, making the same four requests a drop does.
- **The positions panel's width is the one part of the layout a link does not carry.**
  It survives a drag but not a reload, left that way for the deadline.
- **Rows are assumed 32px tall rather than measured**, which is most of what makes a second pane cheap.
  It forces `table-layout: fixed` with an explicit `colgroup`, and the cost is that a row cannot grow to its content.
- **Both booking guards are advisory and the limit is one hardcoded number**, because they are about what the hand just did, which only the client knows.
  The idempotency key is the enforced half, backed by a unique index.
- **A replayed booking answers 200 and publishes nothing**, since a replay wrote no event, so 201 is no longer a reliable signal that a POST created something.
- **`typescript@6.0.3`, not 7**, whose package ships no `tsserver` and puts the compiler API under `./unstable/*`.
  Same story with **`@tanstack/react-table@8.21.3`**: v9 keeps the v8 API behind `./legacy`.
- **The image runs TypeScript through `tsx` rather than a compiled bundle**, for one fewer build step at the cost of a slower cold start.
- **Three omissions, named rather than hidden.**
  No rate limiting, which belongs at the gateway and would otherwise 429 a reviewer's own smoke test.
  No CI workflow with a Postgres service container, so the database-backed tests are a documented local one-liner.
  No type-aware lint rules, because Biome cannot read types, though `strict` and `noUncheckedIndexedAccess` cover most of that gap.

## Deployment

`fly.toml` deploys the same image compose builds, with `DATABASE_URL` from `fly postgres attach`.
Idle suspend is off, since it would drop every open websocket.

## Repository layout

```text
shared/     contracts: trade, error union, websocket frames, decimal money
database/   drizzle schema, migrations, deterministic seed
backend/    fastify app, repositories, services, websocket hub
frontend/   react client: landing, blotter, positions, trade entry, history
docker/     the container entrypoint
```
