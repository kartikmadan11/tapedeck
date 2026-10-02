# tapedeck

A real-time equity trade blotter. Book, amend and cancel trades; every connected
browser sees each change as it happens, with netted positions alongside and a
full audit trail per trade.

```sh
docker compose up --build
```

Then open <http://localhost:3000>. Nothing else to install or configure.

The demonstration worth two minutes: open that URL in two windows side by side,
book a trade in one, and watch it appear in both. Amend the same trade from both
windows without reloading, and the second attempt is told the row changed
underneath it, with the version it is now on.

---

## Architecture decisions

**One npm workspace, four packages.** `shared` holds the contracts, `database`
the schema and queries, `backend` the HTTP and websocket server, `frontend` the
client. `shared` is imported by both halves, so a change to the trade shape
breaks compilation on both sides at once rather than at runtime on one of them.

**The contracts are the design.** `AmendTradeInput` has exactly `quantity`,
`price`, `counterparty` and `version`. There is no way to express amending a
symbol or a side, so the rule is not a runtime check that can be forgotten but a
type that cannot be written. Cancellation is a separate sub-resource rather than
a status patch, for the same reason.

**Price is an exact decimal string end to end.** `numeric(18,6)` in Postgres,
and node-postgres returns `numeric` as a string precisely so that no precision is
lost. Matching the wire type to the storage type keeps it that way. Notional is
computed by scaling to `bigint` minor units in `shared/src/money.ts`;
`Number(price)` appears only in display formatting. `database/src/client.ts`
asserts at startup that no type parser is coercing `numeric` to a float, because
the symptom of that regression is a penny of drift rather than a test failure.

**`trade_events` is an append-only table whose `bigserial` primary key is the
websocket sequence number.** One table does three jobs: the audit trail the UI
reads, the ordering the stream depends on, and the seam an outbox would slot
into. The invariant is `version == count(events)` for every trade, which the seed
satisfies by driving its amendments and cancellations through the real write
path rather than writing `status` and `version` directly. A cancelled row's
history therefore agrees with the row.

**Every mutating transaction opens with a constant-keyed
`pg_advisory_xact_lock`.** `bigserial` allocates before commit, so without it seq
7 can commit before seq 6. A reader taking a snapshot can legitimately observe
`max(seq) = 7` while 6 is still uncommitted; 6 then commits and broadcasts, the
client's filter rejects it as older than the snapshot, and that trade is missing
from that client until it reconnects. The window is microseconds, which is
exactly why a test will not find it. With the lock, events commit in strict seq
order, the sequence is gap-free, and `max(seq)` is a true high-water mark. The
cost is that writes serialise: fine at this scale, and the honest replacement at
real scale is broker-side ordering or a logical-decoding outbox.

**Conflicts are diagnosed inside the locked transaction, not inferred from a
zero-row UPDATE.** The row is read, then branched three ways: absent is a 404
`NOT_FOUND`, already cancelled is a 409 `INVALID_STATE`, version mismatch is a
409 `VERSION_CONFLICT` carrying `currentVersion` so the client can say who moved
it. The client-facing contract is still optimistic concurrency with a version
token; the lock is what makes the diagnosis atomic, so the `currentVersion`
reported cannot already be stale.

**The connection handshake is the resync.** A connecting client is sent a
snapshot of trades, positions and `max(seq)` read in one repeatable-read
transaction, then exactly the frames after that `seq`. Frames arriving during the
read are buffered and replayed, so there is no gap and no duplicate. There is no
separate resync request: reconnecting is the resync, and the client's reconnect
is exponential backoff with jitter.

**`seq` exists only on frames that have one.** `ServerFrame` is split into
sequenced frames (`trade.created`, `trade.amended`, `trade.cancelled`) and
unsequenced ones (`snapshot`, `positions`). A `positions` frame has no
`seq` field at all, so "positions must not advance the cursor" is not a comment
that can rot but a shape that will not compile otherwise.

**One client cache, two writers, one guard.** The blotter lives in a single
TanStack Query entry holding `{ seq, trades, positions }`. The REST load writes
it and the socket writes it, and **both refuse a payload whose `seq` is behind
the cached one**. That guard is what makes a refetch safe: without it, a refetch
replaces the cache when it lands and silently discards every frame that arrived
while it was in flight. The socket writes through a pure reducer,
`apply(state, frame)`, which is where the delivery rules are tested without a
server: stale frames, duplicate frames, out-of-order frames and gaps.

**Positions are netted in Postgres, never derived in the browser.** They arrive
in the snapshot, so the panel is populated on first paint rather than after the
first mutation, and a cancelled trade leaves no exposure behind.

**No optimistic writes.** Over localhost the broadcast arrives faster than the
eye, so the benefit is nil, and an optimistic write would have to guess
`version + 1` locally: displaying a version the server never assigned, when
version is the token the whole concurrency story rests on. A row with a mutation
in flight is dimmed with its controls disabled, and the broadcast clears it.

### API

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | process and database liveness |
| `GET` | `/api/trades` | `{ seq, trades }`; filters: `symbol`, `side`, `status`, `trader`, `book` |
| `GET` | `/api/trades/:tradeId` | one trade |
| `GET` | `/api/trades/:tradeId/events` | the audit trail |
| `POST` | `/api/trades` | book |
| `PATCH` | `/api/trades/:tradeId` | amend; requires `version` |
| `POST` | `/api/trades/:tradeId/cancel` | cancel; requires `version` |
| `GET` | `/api/positions` | `{ seq, positions }` |
| `GET` | `/ws` | websocket; snapshot on connect, then deltas |

`GET /api/trades` returns an object rather than a bare array so the client can
reject a response older than what its socket already applied. Writes take an
`x-tapedeck-actor` header, recorded against every event; see Assumptions.

---

## Installation instructions

Nothing is required but Docker:

```sh
git clone <this repository> && cd tapedeck
docker compose up --build
```

`.env.example` documents every variable, and each one already has the same
default in `docker-compose.yml`, so a `.env` file is optional.

To work on it directly instead, Node 22.12 or newer (`.nvmrc` says 22) and a
Postgres to point at:

```sh
npm ci
docker compose up -d db        # Postgres only, published on localhost:5433
npm run db:migrate
npm run db:seed
```

---

## How to run the application

**With Docker, which is the supported path:**

```sh
docker compose up --build      # http://localhost:3000
docker compose down            # add -v to discard the database too
```

One container serves the API, the websocket and the built frontend from the same
origin, which is why there is no CORS configuration anywhere in this project and
why the browser derives the websocket URL from `window.location`. The entrypoint
applies migrations, seeds only if the trades table is empty, then starts the
server, so a second `docker compose up` is not a double-seeded blotter.

**On the host, in two terminals:**

```sh
npm run dev:api                # Fastify on :3000
npm run dev:web                # Vite on :5173, proxying /api and /ws to :3000
```

Postgres is published on **5433**, not 5432, so it will not collide with a
Postgres already running on the reviewer's machine. That means two connection
strings, which is deliberate: inside the compose network the API uses
`postgres://tapedeck:tapedeck@db:5432/tapedeck`, while anything on the host uses
`localhost:5433`.

The seed is deterministic, driven by a seeded generator in `database/src/rng.ts`,
so every run produces the same 500 trades across 12 symbols: 83 amended, 32
cancelled, 615 events. The numbers in this README are the numbers you will see.

---

## How to run tests

```sh
npm test            # all four workspaces
npm run typecheck   # tsc --noEmit over both the node and the web projects
npm run lint        # biome
```

176 tests across 10 files. The ones that matter most:

- **concurrency**: two amends submitted at the same `version`, where the second
  gets a 409 `VERSION_CONFLICT` naming the current version
- **two real websocket clients**: a port-0 listener, two `ws` clients, one
  mutation, and an assertion that both received the delta with gap-free
  consecutive `seq`. `app.inject()` cannot do this, since it performs no HTTP
  upgrade, so this test listens for real
- **handshake under load**: a client connecting during a burst of writes gets a
  snapshot and then exactly the frames after it, with no duplicate and no gap
- **the reducer**: 30 cases over stale, duplicate, out-of-order and backdated
  frames, plus gap detection across a digit boundary
- **the full client path**: the app rendered over a stubbed socket, where a
  delivered frame reaches the table, a cancellation strikes a row through, and a
  positions frame moves exposure without advancing the cursor
- **the seed invariant**: `version == count(events)` for all 500 trades
- **the storage contract**: `seq` arrives as a number rather than a string, which
  is the kind of thing that is correct until a dependency bump and then silently
  compares `"10" > "9"` as false

The database-backed tests need a database. The default is
`postgres://tapedeck:tapedeck@localhost:5433/tapedeck_test`, overridable with
`TEST_DATABASE_URL`:

```sh
docker compose up -d db
docker compose exec db createdb -U tapedeck tapedeck_test
npm test
```

They truncate and reseed, which is why they want their own database and not the
one the application is using.

---

## Assumptions made

**The brief contradicts itself on the trade model.** Its TypeScript interface
uses `id` and `tradeDate` and has no `book` or `counterparty`; its sample JSON
uses `tradeId` and `tradeTimestamp` and adds both. The JSON shape was taken: it
is the superset, and it is consistent with a readable `TRD-100001` identifier,
which is far easier to talk about in a review than a UUID.

**No authentication.** Writes carry an `x-tapedeck-actor` header, defaulted, and
it is recorded against every event. Threading an actor through now means real
auth replaces one function rather than retrofitting a column into an append-only
table.

**`numeric(18,6)` rather than the conventional four decimal places for cash
equities,** so the same column can hold a price that has been through a currency
conversion without rounding at the boundary. Six places is also enough for the
fractional venue prices that do occur. The regex on the way in allows up to
twelve integer digits and six decimals, and nothing wider is accepted.

**`quantity` is an `integer`,** capping a single trade near 2.1 billion shares.
That is above any realistic equity order and keeps the arithmetic in a type that
cannot drift. A build that needed more would move to `bigint` with the same
string-at-the-boundary treatment that price already gets.

**Trades are never deleted.** Cancellation is a status, so the row and its
history stay, which is what an audit trail means.

**All times are rendered in UTC and labelled as such.** A blotter spanning venues
in one local timezone is a trap; the data is stored as `timestamptz` and the UI
does not pretend otherwise.

**The seeded trade timestamps are spread over the nine hours before startup,** so
the default sort by time is interesting on first paint rather than 500 rows of
the same minute.

---

## Trade-offs accepted

**Writes serialise through one advisory lock.** It is what makes the sequence
gap-free, and the stream's ordering is the property the entire resync contract
depends on. It is also a throughput ceiling, named here rather than left to be
discovered. The replacement is broker-side ordering or logical decoding, not a
cleverer lock.

**The client holds the unfiltered trade set and filters in the browser.** A
server-side filter would mean deciding, for every broadcast delta, whether the
new row belongs in the current filtered view, and getting that wrong in either
direction. At 500 to 1000 rows the filtering is free. Beyond that, filtering
moves to the server and the delta handler gets a predicate, which is a real
change and not a configuration flag.

**No row virtualisation.** 500 rows render fine. It is on the list before
filtering moves server-side, not after.

**`typescript@6.0.3`, not 7.** The 7.0.x package publishes `bin: { tsc }` with no
`tsserver`, and its root `exports` points at a version file with the real code
under `./unstable/*`. Both the compiler API and the language server are gone from
the package root, so it cannot drive an editor. This is a missing entry point,
not caution about a new major.

**`@tanstack/react-table@8.21.3`, not 9.** v9 is a rewrite: `useReactTable` does
not exist at the package root, and the v8 API survives only behind a `./legacy`
subpath. Writing against `/legacy` in order to claim v9 is worse than honestly
using v8.

**The image runs TypeScript through `tsx` rather than a compiled bundle.** That
is one fewer build step and one fewer source map to misconfigure, at the cost of
a slower cold start and `tsx` being a production dependency. For a project whose
entry point is `docker compose up`, the simpler build is the better trade. A
longer-lived service would compile.

**No rate limiting.** A plugin that is installed but never configured or tested
invites exactly the question that cannot be answered, and a limiter that 429s the
reviewer's own smoke test is a self-inflicted wound. Rate limiting belongs at the
gateway in front of this.

**Biome rather than ESLint, which means no type-aware rules.** Biome cannot see
types, so it cannot catch a floating promise. `tsc` under `strict`,
`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` and
`erasableSyntaxOnly` covers most of that gap, and the speed is worth it on a
project this size.

**No CI workflow with a Postgres service container.** The database-backed tests
are a documented local one-liner instead. An hour spent on a CI Postgres is an
hour not spent on the concurrency story the brief actually asks about.

---

## Deployment

`fly.toml` deploys the same image that `docker compose up --build` builds, with
`DATABASE_URL` supplied as a secret by `fly postgres attach` and the entrypoint's
migrate-then-seed-if-empty step doing the rest. The machine is configured not to
suspend on idle, because a suspended machine drops every open websocket and the
demonstration is two windows staying connected.

`docker compose up --build` is the primary instruction regardless. A hosted URL is
additive, never a substitute for a repository that runs in one command.

---

## Repository layout

```
shared/     contracts: trade, error union, websocket frames, decimal money
database/   drizzle schema, migrations, deterministic seed
backend/    fastify app, repositories, service, websocket hub
frontend/   react client: blotter, positions, trade entry, history drawer
docker/     the container entrypoint
docs/       AI usage notes and the prompt log
```

`docs/AI-USAGE.md` records how an AI assistant was used on this project,
including the suggestions that were rejected and why. `docs/prompt-log.md` is the
running log it draws on, written at each phase boundary rather than
reconstructed at the end.
