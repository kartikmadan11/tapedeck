# Architecture decisions

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

## API

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
Writes take an `x-tapedeck-actor` header, recorded against every event; see [Assumptions](ASSUMPTIONS.md).
