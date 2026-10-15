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

## A quick tour

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

## Design notes

- [Architecture decisions](docs/ARCHITECTURE.md): the package layout, money, ordering, concurrency, catch-up, and the API.
- [Assumptions made](docs/ASSUMPTIONS.md): where the brief was silent or contradicted itself, and the product calls that followed.
- [Trade-offs accepted](docs/TRADEOFFS.md): what was given up, why, and what replaces it at scale.

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
docs/       architecture decisions, assumptions, trade-offs
```
