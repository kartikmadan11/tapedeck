# tapedeck

A real-time equity trade blotter. Book, amend and cancel trades; every connected
browser sees each change as it happens, with netted positions alongside and a
full audit trail per trade.

```sh
docker compose up --build
```

Open <http://localhost:3000>, press **Log in**, and sign in as `k.madan` with
the password `tapedeck`. Nothing else to install or configure.

It is already moving when it opens: a generated feed books, amends and cancels
every couple of seconds, so the real-time behaviour demonstrates itself.
**Pause feed** stops it for every connected window.

## The two-minute demo

**Two traders, one book.** Open a second window as
<http://localhost:3000/?actor=j.okonkwo>, whose sign-in form starts on that
name. Book a trade in each and watch both rows appear in both.

**A conflict, shown rather than described.** Pause the feed, then amend the same
trade from both windows without reloading. The second attempt is told the row
changed underneath it, and which version it is now on.

**Right-click a pane** for its own controls: another pane, a duplicate, its
configuration, a reset, a workspace link and a close. Holding **Shift** gives
the browser its own menu back.

**The check worth making.** Pause the feed and set **Group by** to symbol. Every
group row's net quantity and net notional equal the positions panel's row for
that symbol, digit for digit: one in `bigint` in the browser, the other in
`numeric` in Postgres. The seed is 400 trades against a 500-row window, so it
holds from a fresh start until the feed books 100 more, then legitimately stops.

## Architecture decisions

One npm workspace, four packages: `shared` holds the contracts, `database` the
schema and queries, `backend` the HTTP and websocket server, `frontend` the
client. Both halves import `shared`, so a change to the trade shape breaks
compilation on both sides at once rather than at runtime on one.

- **The contracts are the design.** `AmendTradeInput` has exactly `quantity`,
  `price` and `version`, so amending a symbol is not a check that can be
  forgotten but a type that cannot be written. Cancellation is a sub-resource
  rather than a status patch for the same reason.
- **Price is an exact decimal string end to end**, `numeric(18,6)` in Postgres
  and a string on the wire, with notional computed in `bigint` minor units.
  Startup asserts that no type parser is coercing `numeric` to a float.
- **`trade_events` is append-only, and its `bigserial` key is the websocket
  sequence number.** One table is the audit trail, the stream's ordering and the
  seam an outbox would slot into. The invariant is `version == count(events)`.
- **Every mutating transaction opens with a constant-keyed
  `pg_advisory_xact_lock`.** `bigserial` allocates before commit, so without it
  seq 7 can commit before seq 6 and a client that snapshotted at 7 rejects 6 as
  stale. The window is microseconds, which is why a test will not find it.
- **Conflicts are diagnosed inside the locked transaction**, not inferred from a
  zero-row UPDATE: absent is 404 `NOT_FOUND`, already cancelled is 409
  `INVALID_STATE`, a version mismatch is 409 `VERSION_CONFLICT` carrying
  `currentVersion`.
- **The connection handshake is the resync.** A snapshot of trades, positions
  and `max(seq)` read in one repeatable-read transaction, then exactly the
  frames after it, then whether the feed is running. Frames arriving during the
  read are buffered and replayed, so reconnecting is the only resync there is.
- **One client cache, two writers, one guard.** The REST load and the socket
  both write one TanStack Query entry holding `{ seq, trades, positions }`, and
  both refuse a payload whose `seq` is behind the cached one, which is what
  makes **Refresh** safe at any time. Positions inside it are netted in Postgres
  and never derived in the browser, so the panel is right on first paint.
- **No optimistic writes.** One would have to guess `version + 1` locally,
  displaying a version the server never assigned, when version is the token the
  whole concurrency story rests on. A row with a mutation in flight is dimmed.

The reasoning behind each of these is in
[`docs/DECISIONS.md`](docs/DECISIONS.md), under the same heading.

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
| `POST` | `/api/trades/:tradeId/cancel` | cancel; requires `version` |
| `GET` | `/api/positions` | `{ seq, positions }` |
| `GET`, `POST` | `/api/simulation` | `{ running, intervalMs }`; starts or stops the feed |
| `GET` | `/ws` | websocket; snapshot on connect, then deltas |

`GET /api/trades` returns an object rather than a bare array so the client can
reject a response older than its socket already applied. Writes take an
`x-tapedeck-actor` header, recorded against every event; see Assumptions.

## Installation instructions

Nothing is required but Docker:

```sh
git clone <this repository> && cd tapedeck
docker compose up --build
```

`.env.example` documents every variable, and each already has the same default
in `docker-compose.yml`, so a `.env` file is optional.

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

One container serves the API, the websocket and the built frontend from the same
origin, which is why there is no CORS configuration anywhere and why the browser
derives the websocket URL from `window.location`. The entrypoint migrates, seeds
only if the trades table is empty, then starts, so a second `docker compose up`
is not a double-seeded blotter.

On the host, in two terminals:

```sh
npm run dev:api                # Fastify on :3000
npm run dev:web                # Vite on :5173, proxying /api and /ws to :3000
```

Postgres is published on **5433** so it will not collide with one already
running on the reviewer's machine: inside the compose network the API uses
`db:5432`, and anything on the host uses `localhost:5433`.

The seed is deterministic: every run starts from the same 400 trades across 12
symbols, 69 amended, 25 cancelled, 494 events. `SIMULATION_ENABLED=false` holds
the blotter at exactly that state.

## How to run tests

```sh
npm run check         # typecheck, lint, palette, tests. The one to run
npm test              # all four workspaces
npm run typecheck     # tsc --noEmit over both the node and the web projects
npm run lint          # biome
npm run lint:palette  # no raw colour in a .tsx
npm run format        # biome, writing its fixes
```

544 tests across 24 files. The database-backed ones need a database, defaulting
to `postgres://tapedeck:tapedeck@localhost:5433/tapedeck_test` and overridable
with `TEST_DATABASE_URL`:

```sh
docker compose up -d db
docker compose exec db createdb -U tapedeck tapedeck_test
npm test
```

They truncate and reseed, which is why they want their own database.
[`docs/DECISIONS.md`](docs/DECISIONS.md) lists the heaviest ones and what each
holds down.

## Assumptions made

Each of these is argued at length in [`docs/DECISIONS.md`](docs/DECISIONS.md).

- **The brief contradicts itself on the trade model**, so the sample JSON's
  shape was taken as the superset of its TypeScript interface: `tradeId` and
  `tradeTimestamp`, with `book` and `counterparty`.
- **Sign-in is mocked, and the trade routes are deliberately not behind it.**
  Accounts and tokens are Maps in the API process, and writes take the actor
  from an `x-tapedeck-actor` header the caller asserts, which is the seam a
  verified claim would arrive on.
- **A session belongs to the window, not the browser**, as one `sessionStorage`
  entry, so two windows are two traders. `?actor=` pre-fills the form rather
  than granting an identity, and is removed from the address bar because that
  bar also carries the workspace link.
- **Every price is in one currency, and there is no currency column.** The
  twelve seeded instruments are FTSE names quoted in pence, and a second
  currency means an FX rate the brief never supplies.
- **`numeric(18,6)` rather than four decimal places**, so a price that has been
  through a conversion is not rounded at the boundary. `quantity` is an
  `integer`, capping one trade near 2.1 billion shares.
- **Trades are never deleted.** Cancellation is a status, so the row and its
  history stay, which is what an audit trail means.
- **All times are rendered in UTC and labelled as such**, because a blotter
  spanning venues in one local timezone is a trap.
- **The generated feed writes through the service layer, never onto the wire**,
  so what it produces carries a gap-free `seq`, a correct version chain and
  netted positions. It records `simulator` as the actor while booking under a
  real trader name.
- **The blotter is a window on the most recent 500 trades, not the whole book.**
  `BLOTTER_LIMIT` lives in `shared` because the REST read, the handshake
  snapshot and the cache trim have to agree. Positions stay firm-wide, being a
  fact about the book rather than about what is on screen.
- **Counterparty is chosen from a list and cannot be amended**, since it drives
  the credit check, the settlement and the regulatory report, and changing who a
  trade is with is a cancel and rebook. The book is a picklist for the same
  reason, which closed a live defect: the form prefilled `EQ-LDN-1` against a
  list that said `EQ-LDN-01`.
- **Group aggregates exclude cancelled trades**, or the grid would disagree with
  the positions panel. A group's average price is a `bigint` VWAP weighted by
  absolute quantity, so a sell leg pulls the average rather than leaving the
  denominator.
- **The multi-pane workspace keeps its controls on the pane, not in a shared
  bar.** One top bar could only ever describe one of two open panes, so each
  grid owns a side panel that shrinks the tape rather than covering it, and a
  pane's own actions sit behind a right-click. The cost is discoverability,
  which is why the demo above says so.
- **A workspace is a tree of splits, and travels as a readable link**:
  `?panes=2&p1.group=symbol&p2.where.symbol=BARC` is the whole format, carrying
  the view and the arrangement, never the data. A flat axis with a weight per
  pane could not express "beside this one".
- **The magnitude bar is drawn on notional**, scaled over the filtered rows and
  quantised up, because 10,000 shares of a 72p stock and of a 400p stock are not
  comparable sizes and a bar re-scaling on every arrival is noise.
- **Booking is protected against the repeat, not against the press**, since
  working an order in clips means booking the same ticket on purpose. An
  identical ticket inside five seconds holds the button, one over 250,000
  notional holds and says the limit, and every ticket mints a `clientTradeId`
  under a unique index.

## Trade-offs accepted

- **Writes serialise through one advisory lock**, which is what makes the
  sequence gap-free and is also a throughput ceiling. The replacement is
  broker-side ordering or logical decoding, not a cleverer lock.
- **The client holds the unfiltered trade set and filters in the browser.** A
  server-side filter would mean deciding, for every broadcast delta, whether the
  new row belongs in the current view. At 500 rows the filtering is free.
- **A splitter writes to the DOM while being dragged and commits once, on
  release**, the one deliberate exception to holding state in React: a pane is a
  virtualised grid of 500 trades, so a resize through state would re-render both
  panes on every pointer move.
- **Dragging a pane uses native drag and drop, so the drop zones are
  mouse-only.** The keyboard route is the handle's arrow keys, making the same
  four requests a drop does, and the ghost preview calls the functions the drop
  calls, so it cannot promise an outcome the drop will not deliver.
- **The positions panel's width is the one part of the layout a link does not
  carry.** It survives a drag and not a reload, left for the deadline rather
  than for a reason.
- **Rows are virtualised against a stated 32px row height rather than a measured
  one**, which is most of what makes a second pane cheap. It forces
  `table-layout: fixed` with an explicit `colgroup`, since otherwise column
  widths shift as the tape scrolls, and keeping the digits on a vertical line is
  the brief's one explicit UX requirement.
- **Both booking guards are advisory, and the limit is one hardcoded number**,
  because they are about what the hand just did, which only the client knows.
  The idempotency key is the enforced half, by a unique index. A real desk would
  read its limit from a limits service.
- **A replayed booking answers 200 and publishes nothing**, since a replay wrote
  no event. The cost is that 201 is no longer a reliable signal that a POST
  created something, which is why the tests assert both codes.
- **`typescript@6.0.3`, not 7**, whose package ships no `tsserver` and puts the
  compiler API under `./unstable/*`, so it cannot drive an editor. Likewise
  **`@tanstack/react-table@8.21.3`**: v9 keeps the v8 API behind `./legacy`.
- **The image runs TypeScript through `tsx` rather than a compiled bundle.** One
  fewer build step and one fewer source map to misconfigure, at the cost of a
  slower cold start.
- **Three named omissions.** No rate limiting, which belongs at the gateway and
  would otherwise 429 the reviewer's own smoke test. No CI workflow with a
  Postgres service container, so the database-backed tests are a documented
  local one-liner. And no type-aware lint rules, because Biome has none, though
  `tsc` under `strict` and `noUncheckedIndexedAccess` covers most of that gap.

## Deployment

`fly.toml` deploys the same image compose builds, with `DATABASE_URL` from
`fly postgres attach`. The machine does not suspend on idle, because that drops
every open websocket. `docker compose up --build` is the primary instruction
regardless.

## Repository layout

```
shared/     contracts: trade, error union, websocket frames, decimal money
database/   drizzle schema, migrations, deterministic seed
backend/    fastify app, repositories, services, websocket hub
frontend/   react client: landing, blotter, positions, trade entry, history
docker/     the container entrypoint
docs/       the long-form decisions, AI usage notes and the prompt log
```

[`docs/DECISIONS.md`](docs/DECISIONS.md) is the argument behind every line in
Architecture decisions, Assumptions and Trade-offs above.
[`docs/WHAT-WE-BUILT.md`](docs/WHAT-WE-BUILT.md) maps the brief's requirements
and bonus items onto what is here, and
[`docs/AI-USAGE.md`](docs/AI-USAGE.md) records how an AI assistant was used,
drawing on [`docs/prompt-log.md`](docs/prompt-log.md).
