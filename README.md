# tapedeck

A real-time equity trade blotter. Book, amend and cancel trades; every connected
browser sees each change as it happens, with netted positions alongside and a
full audit trail per trade.

```sh
docker compose up --build
```

Then open <http://localhost:3000>. Nothing else to install or configure.

The blotter is already moving when it opens: a generated feed books, amends and
cancels trades every couple of seconds, so the real-time behaviour demonstrates
itself rather than needing to be described. **Pause feed** in the header stops it
for every connected window.

The demonstration worth two minutes: open that URL in two windows side by side,
the second one as <http://localhost:3000/?actor=j.okonkwo> so the two are two
traders, book a trade in each, and watch both rows appear in both windows under
the name that booked them. Pause the feed, then amend the same trade from both
windows without reloading, and the second attempt is told the row changed
underneath it, with the version it is now on.

---

## Architecture decisions

**One npm workspace, four packages.** `shared` holds the contracts, `database`
the schema and queries, `backend` the HTTP and websocket server, `frontend` the
client. `shared` is imported by both halves, so a change to the trade shape
breaks compilation on both sides at once rather than at runtime on one of them.

**The contracts are the design.** `AmendTradeInput` has exactly `quantity`,
`price` and `version`. There is no way to express amending a symbol, a side or a
counterparty, so the rule is not a runtime check that can be forgotten but a type
that cannot be written. `CreateTradeInput` narrows counterparty to the names on
the counterparty list for the same reason, which is argued under Assumptions.
Cancellation is a separate sub-resource rather than a status patch, again for the
same reason.

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
transaction, then exactly the frames after that `seq`, then whether the generated
feed is running. Frames arriving during the read are buffered and replayed, so
there is no gap and no duplicate. There is no separate resync request:
reconnecting is the resync, and the client's reconnect is exponential backoff
with jitter.

Sending the feed state as part of the handshake rather than only when it changes
is what makes a reconnect sufficient. A client that broadcast-only would keep
whatever it last heard, so after an API restart it could show **Start feed** while
rows arrived underneath it, and pressing the button would be a no-op that
published nothing, leaving it stuck until a reload.

**`seq` exists only on frames that have one.** `ServerFrame` is split into
sequenced frames (`trade.created`, `trade.amended`, `trade.cancelled`) and
unsequenced ones (`snapshot`, `positions`, `simulation`). A `positions` frame has
no `seq` field at all, so "positions must not advance the cursor" is not a comment
that can rot but a shape that will not compile otherwise. Adding `simulation` to
the union was what surfaced the handshake gap above: the compiler demanded a
decision at every point that reads a frame, including the two drain passes.

**One client cache, two writers, one guard.** The blotter lives in a single
TanStack Query entry holding `{ seq, trades, positions }`. The REST load writes
it and the socket writes it, and **both refuse a payload whose `seq` is behind
the cached one**. That guard is what makes a refetch safe: without it, a refetch
replaces the cache when it lands and silently discards every frame that arrived
while it was in flight. The **Refresh** button in the header is that refetch, and
it is safe to press at any time for the same reason. The socket writes through a
pure reducer, `apply(state, frame)`, which is where the delivery rules are tested
without a server: stale frames, duplicate frames, out-of-order frames and gaps.

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
| `GET` | `/api/simulation` | `{ running, intervalMs }` for the generated feed |
| `POST` | `/api/simulation` | `{ running }`; starts or stops it |
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
so every run starts from the same 500 trades across 12 symbols: 83 amended, 32
cancelled, 615 events. The generated feed then writes on top of that, so the
counts climb from first paint; `SIMULATION_ENABLED=false` is how to hold the
blotter at exactly the seeded state. The feed's own generator is seeded from the
clock rather than a constant, because two restarts producing an identical stream
would look like a recording rather than a feed.

---

## How to run tests

```sh
npm test            # all four workspaces
npm run typecheck   # tsc --noEmit over both the node and the web projects
npm run lint        # biome
```

498 tests across 20 files. The ones that matter most:

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
- **idempotency under contention**: the same `clientTradeId` posted ten times at
  once, asserting one 201 and nine 200s, one trade id across all ten replies and
  one row in the table. The repository reads for an earlier booking and then
  inserts, which is a check-then-act and is safe only because the write lock
  means one create runs at a time, so this is the test of that claim and it would
  catch the insert being moved out from under the lock later
- **what a grouped view shows**: that grouping leaves the column it groups on and
  the three that net, and takes the other eight off the grid rather than down a
  column of empty cells, which is the reported defect written as a test. Beside
  it, the three properties that make the drop derived rather than stored: that a
  column the trader turned on comes back when the grouping is cleared and is
  never reported out as hidden, so a shared link carries their choice and not the
  grouping's consequences; that grouping by a column somebody had hidden brings
  it back, since it is the one carrying the label and the expander; and that a
  filter on a dropped column still applies, because a net that quietly stopped
  honouring it would read the same for one trader's flow as for everybody's
- **the pane layout**: the tree behind resizing and rearranging, as a pure module
  with no React in it, including that a splitter cannot squeeze a pane under its
  floor, that closing a pane shares its space out in proportion, and that a
  splitter left holding one region gives way to it. The two assertions that carry
  the feature are written against the arrangement the defect was reported from,
  three stacked panes: standing one beside another comes back
  `rows(columns(a c) b)` rather than turning the third pane sideways with them,
  and all three panes are still at exactly a third of the window afterwards
- **the panel boundary dragged for real**: the handle between the tape and the
  positions panel moves in pixels, so unlike the splitter between two panes it
  needs no layout and a pointer drag can be driven end to end in jsdom. Includes
  the property that matters, that every move is measured from where the pointer
  went down rather than accumulated per move, so a drag out past the ceiling and
  back returns to exactly where it started
- **the shared link, asserted as a string**: the exact query a two-pane
  workspace produces, rather than only that it decodes back. Readability is the
  feature, and a round-trip test would pass just as well on an opaque blob.
  Alongside it, that the query contains no `%` at all, that a filter value
  outside ASCII still round trips, that a stack of even panes states no
  arrangement at all, and that sharing a smaller workspace clears the parameters
  of the panes that went away. Twenty-four malformed links, each of which has to
  leave the blotter working rather than put a name that is not a column, or a
  path that is not a tree, into a pane
- **only the difference, in both directions**: that a pane nobody has configured
  writes no view at all, that a pane showing the trade id writes that it shows it
  rather than every other pane writing that it does not, that a pane somebody
  unsorted says so rather than reading as a pane with nothing to say, and that a
  hand-written link stating the default is read as what it says and stops stating
  it on the next Share
- **the arrangement, around the whole loop**: driven through the UI rather than
  through the encoder, because the encoder agreeing with itself is not the claim.
  Stand a pane beside another, drag the boundary that only exists because of the
  drop, press Share, then open what was shared in a workspace that knows nothing
  about the first one, and both panes come back inside the split at their share
  of the window rather than of the split
- **the identity, consumed rather than read**: that the name a window trades as
  comes off the link it arrived on and is not in the address bar afterwards,
  because the same bar is what gets shared, and that a name the audit trail could
  not hold is refused while the parameter is still taken out
- **the address bar following the workspace**: that opening a pane leaves it in
  the query string with nobody pressing Share, and that throwing the workspace
  away and rendering it again against that bar comes back to the same two panes,
  which is the reported defect written as a test. Beside it, that three keystrokes
  in a filter box are one write rather than three, that arrival writes nothing at
  all, so a link that did not parse is still there to be read, and that a write
  still in flight when a workspace goes away does not land in the next one
- **a name through a move and through a link**: that a renamed pane dragged
  beside another still answers to its name afterwards, where a positional label
  would have changed under it, and that Share writes the name somebody chose and
  nothing for the panes nobody named. Driven by typing into the nameplate, so the
  draft held in the box, the one rename the workspace hears and the parameter it
  writes are all one path
- **the nav's new pane, through the slot it really renders into**: the test
  mounts the workspace beside a nav node and passes it, so the control is driven
  where it sits rather than where it is declared. It opens a pane on the name it
  was given, opens one with no name at all on Enter alone, arrives on the default
  view where a duplicate arrives on its source's, and lands at the end of a
  side-by-side workspace beside the other two rather than under the last of them
- **the drop preview**: that the ghost arrangement is the one the drop produces
  and not the zone the pointer is in, driven from a side-by-side workspace where
  aiming at a bottom edge has to come back vertical, from three uneven panes
  where the shares have to reorder rather than even out, and from a drop that
  nests, where the ghosts have to divide one slot and leave the rest alone. The
  ghosts are read out of the DOM by the same walk the arrangement assertions use,
  so a preview that disagreed with the drop would fail as a difference between
  two expressions rather than as a screenshot nobody looks at. Plus that the
  preview survives a pointer crossing between two zones of the same pane while
  still clearing when the pointer leaves it: the crossing is the case worth a
  test, because `dragleave` bubbles from the zone being left and the naive
  handler strobes the preview as the hand moves
- **the seed invariant**: `version == count(events)` for all 500 trades
- **the storage contract**: `seq` arrives as a number rather than a string, which
  is the kind of thing that is correct until a dependency bump and then silently
  compares `"10" > "9"` as false
- **the generated feed**: the action picker is a pure function over a list of
  trades, so the mix, the growth cap and the version it amends at are all tested
  with no database and no timers; separately, the runner is driven on its timer to
  prove a rejected write is swallowed and the feed keeps going
- **the handshake drain**: a client attaching in the microsecond window where a
  frame is published mid-snapshot-read. Driven through a fake socket with a
  `readSnapshot` that publishes into the window, so the race is deterministic
  rather than flaky

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

**No authentication, and the identity is not something anybody can type.** The
header states who the window is trading as; every write carries that name as an
`x-tapedeck-actor` header and it is recorded against every event. It was a text
box, and a text box is the wrong shape for it: the name stamped on an amend is
the one thing in the application a trader should not be able to choose. Real
deployments authenticate at the edge and inject the identity as a header the
application trusts, so what this needs is a seam where that arrives rather than a
control, and replacing it with a verified claim is one function here and one
check on the server rather than a retrofit into an append-only table.

The seam is `?actor=`, taken once before the first render and then taken back out
of the address bar. Consumed rather than read, because the same bar carries the
workspace link: left in, an identity would travel to whoever was sent that link
and have them booking under a name that is not theirs. Once taken it is held in
`sessionStorage`, which is scoped to the window rather than the browser, so two
windows side by side are two traders and a reload of either keeps the one it has.
A cookie or a login session is shared across both windows and could only ever
hold one identity, which would make the demo at the top of this file need two
browser profiles to show the same thing. A name longer than the audit trail's own
schema allows is refused and the window keeps the default, since nothing between
that header and the event store would reject it: the column is `text`, so it
would be written and then fail to parse on the way back out.

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

**The generated feed writes through the service layer, never onto the wire.** It
calls the same `createTrade`, `amendTrade` and `cancelTrade` the REST routes
call, so everything it produces carries a gap-free `seq`, a correct `version`
chain, a complete event history and netted positions. Fabricating frames would
have been less code and would have broken all four, turning the feature that
demonstrates the system into the one that contradicts it. It records `simulator`
as the actor while booking under a real trader name, which is the same split
between authenticated actor and trader of record described above, so the history
of a generated trade is honest about where it came from.

**The blotter is a window on the most recent 500 trades, not the whole book.**
Cancelled trades stay on the tape, so the feed only ever adds rows and never
removes one: left unbounded, a session running for an afternoon accumulates
thousands of rows, every one of which React reconciles each time a frame
arrives. `BLOTTER_LIMIT` lives in `shared` because both ends have to agree on
it: `GET /api/trades` defaults to it, the websocket handshake snapshot is cut to
it, and the client trims its own cache to the same number so a long session
cannot drift back to unbounded one frame at a time. The count above the grid
says **latest 500** rather than **500 trades** once the window is full, so the
figure never claims to be the book. The ordering index already matches the sort,
so the bound is a truncated index scan rather than a full sort that throws most
of its rows away.

**Counterparty is chosen from a list at booking and cannot be amended, which
narrows the amend surface the brief describes.** The brief names quantity, price
and counterparty as the amendable fields. Quantity and price are amendable here;
counterparty is not, and that is a deliberate deviation rather than an omission.

Two things are wrong with a free-text counterparty. The first is that nobody
types one: it is resolved from a counterparty master and carried as a code, an
internal CP code, a BIC, or the LEI that EMIR and MiFIR require for both sides of
a reportable trade. That code drives the pre-trade credit check, the settlement
instructions, which master agreement and netting set the trade falls under, the
margin calculation and the regulatory report. `UBSf` passes every length check a
string field can apply, then fails enrichment, drops out of straight-through
processing into a repair queue, and risks a CSDR settlement fail. So booking is a
picklist over `COUNTERPARTIES`, which stands in for that master and lives in
`shared` so the form, the validator and the generated feed cannot disagree about
what is on it.

The second is that changing who a trade is with is not an amendment at all. If
the wrong name was booked, the trade is cancelled and rebooked under a reason
code, so both the error and the correction are in the audit trail. If the
exposure is genuinely moving, that is a novation or a give-up, and it needs the
incoming party's consent rather than one trader's edit. Rewriting the field in
place would leave the economics attached to a counterparty that never agreed to
them, after credit, margin and the regulatory report had already been filed
against the previous one. For a venue that sits between two counterparties, it is
the last field to leave editable. `amendTradeInput` therefore has no
`counterparty` key at all, so an attempt to send one is a 400 rather than a
silently discarded field, and the amend dialog shows the counterparty as context
with a line saying to cancel and rebook.

The read model keeps counterparty as free text on purpose. It has to parse every
row already in the table, including a trade booked against an entity that has
since left the list, so narrowing it would turn a reference-data change into a
data migration and would make the blotter fail to render a trade rather than
display a name it no longer offers. The narrowing is on the write path, where it
belongs.

**Positions stay firm-wide and are not windowed with the blotter.** They are
aggregated in Postgres over every active trade, so the panel can legitimately
report exposure the 500 visible rows do not add up to. That is the right way
round: a position is a fact about the book, not about what happens to be on
screen, and summing the visible rows in the browser would make the number depend
on the scroll position. The one caller that reads trades unwindowed is the
generated feed, which compares the active count against its own cap and would
book without end if a limit hid the trades above it.

**Group aggregates exclude cancelled trades.** A cancelled trade did not happen,
so netting it into a group's quantity or notional would make the grid disagree
with the positions panel, which sums only active trades in SQL. That gives the
strongest single check in the application: with no filters set and **Group by**
symbol, every group row's net quantity and net notional equal the positions row
for the same symbol digit for digit, one computed in `bigint` in the browser and
the other in `numeric` in Postgres. The exclusion is in the aggregation callback
rather than in the filter, so what a trader happens to have filtered to cannot
change what a net position means.

**A group's average price is a quantity-weighted VWAP, computed in `bigint` and
never in floating point.** It is weighted by absolute quantity, so a sell leg
pulls the average rather than cancelling a buy leg out of the denominator, and it
rounds half up at the last place it shows. A group of nothing but cancellations
renders a dash: a zero average price is a claim about where the book traded, and
such a group has nothing to claim. The whole backend is built on exact decimals,
and an average execution price arrived at by adding floats would undermine that
on the one number a reviewer is most likely to check by hand.

**Grouping drops the columns a group cannot answer for.** Nine of the twelve have
nothing to net, so a grouped grid was four figures and a row of empty cells on
every rail: a group of forty trades has no one counterparty and no one timestamp,
and a column of blanks is width spent saying so. What stays is the columns being
grouped on, which carry the label and the expander, and the three that net,
average price, net quantity and net notional. A grouped column leads the row even
if it was hidden before, because it is the heading, and a split by book left where
Book is declared would put its label after the figures it heads.

**That drop is derived from the grouping and never written into what a trader
chose.** Clearing **Group by** gives back exactly the columns they had, and a
shared link states their choice rather than the grouping's consequences. While a
grouping is on the panel offers the dropped columns as unavailable rather than
unticked, since the grid reads those boxes through the override and a tick would
be a control that does nothing. They are hidden rather than taken out of the
table, which matters more than it looks: TanStack silently skips a filter whose
column it cannot resolve, so a shorter column list would have left a trader
filtered to their own flow reading a net that quietly included everybody's. What
it costs is the legs, since expanding a group shows its trades in those same four
columns, so reading one's side or counterparty means clearing the grouping.

**Grouping, ordering, filtering and column visibility live in each grid's own
side panel, not in the top bar.** The top bar keeps the five filters a trader's
hand is already on, and the panel completes the set with the bounds and columns
it does not cover. The reason it is per grid rather than per application is the
workspace: with two panes open, one shared configuration bar could only ever
describe one of them, and it would not say which. The panel is a flex sibling of
the grid rather than an overlay, so opening it shrinks the tape instead of
covering the columns being read, and while it is closed it is `inert`, because a
zero-width panel still holds real form controls and the next **Tab** out of the
grid would otherwise land in an invisible select.

**A workspace is a tree of splits, not one axis with a weight per pane.** Panes
are dragged by the handle on their own bar and dropped on another pane's edge,
and a drop means the pane lands beside that one pane, in that one pane's slot,
with nothing outside the slot moving. That drop is the only thing that turns an
axis, because a separate **side by side** button would be a second way to say
what the drag already says unambiguously, and it would have to pick a subject the
drag already names.

The flat version was built first, and it is worth saying why it is gone rather
than quietly replacing it. One axis for the whole workspace makes sideways a
property of the workspace, so from three stacked panes, standing one of them
beside its neighbour turned the third pane sideways as well. A single axis cannot
express "beside this one", and that is what the tree buys: the slot the drop
landed in becomes a split of two, and every other region keeps the axis and the
share it had. Two invariants hold the shape down, and every operation maintains
both: a split has at least two children, and no split has a child split on its
own axis. The second is worth more than it looks, because it makes the axes
alternate with depth, so a shared link can state the root axis alone and every
other axis follows from how deep it sits.

**A move changes where the panes are and not how big they are.** Taking a pane
out renormalises the panes it leaves behind, and putting it in halves the slot it
lands on, so the two steps are each right on their own and together leave every
pane a different size than it started at. Each pane's share of the window is
therefore measured before a move and restated after it: three panes at a third
each are still a third each once one has been stood beside another, and the only
thing the drop changed is the arrangement.

The boundary between two regions of a split is a splitter that drags to give one
of them more of the screen, and the keyboard reaches both the handle and the
splitter: arrow keys on a splitter move that one boundary and no other, and arrow
keys on a handle make the same four requests a drop does, so a pane can be walked
across the workspace with a key held down. A request with no neighbour that way
turns the axis and keeps the order rather than swapping the two panes over, which
is the difference between **Left** on a stack of two meaning "stand these side by
side" and meaning "put me first".

Stacked is still the default, for the reason it was the only option before: twelve
columns of nowrap trade data and an open config panel overflow one pane, so two
columns start with neither showing a whole row. What a split across the other
axis adds is the splitter, which can give the pane being read most of the width
and leave the other as a strip, which is what someone watching one symbol against
the whole tape actually wants.

**The boundary between the blotter and the positions panel moves in pixels, not
in shares.** Every other boundary in the workspace is a share of an axis, and
this one is not, because the two sides of it are not the same kind of thing. The
tape is fluid and wants whatever is left. The panel holds three columns, a signed
quantity and a notional that runs to six figures, so what it needs is a floor
that does not move when the window does: a share would put it under that floor on
a laptop and waste half a screen on a desk monitor. It drags between 216px and
560px, which is where its own numbers start truncating and where it stops showing
anything more for the width it takes.

A consequence worth stating, since it is the one thing about resizing that is not
symmetrical: with a single pane there is no splitter inside the workspace at all.
A splitter divides two panes, so until a second one is opened the only boundary on
screen is this one. That is why a second pane has to be opened first, with
**Duplicate** or **New pane**, and it is the question the feature gets asked
most.

Weights rather than pixels or percentages, and a pane carries its weight when it
moves. Each pane is a flex item with a basis of zero and a grow factor, so the
browser divides whatever is left after the splitters and nothing in the layout
has to know how wide the window is or how thick a splitter is. A pane arriving
takes half of the one it lands against, so opening one leaves every other pane
the share it was given; closing one shares its space out in proportion rather than
evening everything up; and a splitter cannot reduce a pane below an eighth of the
axis, because a pane showing its filter bar and no rows is in the way rather than
small, and **Close** is how you get rid of one.

**The only pane of a workspace cannot be closed.** Whether a pane can be closed
is derived rather than stored, so there is no flag to get wrong and no way to
represent a workspace with nothing in it, and the schema a link is parsed through
carries the same invariant. Derived from the count and not from the position,
because once a pane can be dragged anywhere in the tree, "the first one" is not a
pane any more, it is a slot, and a rule that pinned the pane sitting in that slot
would move the Close button out from under a trader's cursor on a drop that was
only supposed to rearrange.

**Duplicate** opens another pane on the view the trader is currently looking at,
and every pane renders the same trades from the single cache entry, so a second
pane opens no second fetch, no second socket and no second cursor to reconcile.
It stops being offered at eight panes, which is the point where the link format's
`p1` to `p8` could no longer carry the workspace: a button that produced a
workspace **Share** cannot describe is worse than a button that is not there.

**A pane can also be opened from the nav, named as it is opened.** Duplicate is a
pane's own control and hands over the view in front of it. **New pane** is the
empty one, for a trader who wants a second reading of the tape rather than
another copy of the one they already have, and it takes a name on the way in
because opening a pane is the moment someone knows what it is for. It lands at
the end of the workspace, on the axis the workspace is already divided on, so a
third pane joins two that stand side by side rather than arriving under whichever
of them happens to be last. It takes its half out of that end, so the pane at the
other end keeps the size it was given, and it is withheld at eight panes for the
same reason Duplicate is.

Where that control sits is worth a line, because it is the one place in the
application where a component renders outside its own tree. The nav is where it
belongs: opening a pane is the only thing a trader asks of the workspace without
having a pane in mind. The arrangement it adds to is held inside the workspace,
though, and lifting that one level up to reach the nav would put every rename,
resize and rearrangement through the component that also holds the booking form
and the positions panel. So the app leaves a `display: contents` slot in the nav
and the workspace fills it through a portal: the button's markup, its place in
the tab order and its place in a screen reader's reading of the page are all in
the nav, and the state behind it never leaves the workspace. **Share** stays on
the workspace's own strip, where there is room for the line of text it leaves
behind.

**A pane can be named, and the name belongs to the pane rather than to the slot.**
Clicking the title on a pane's bar turns it into a box, which is also why there is
no sixth control on a bar that already carries five filters: a box that always
looked like one would read as a filter on something. The name is a field on the
leaf in the tree, so it travels with the pane through a move, a promotion and a
reshare without any of the tree operations being told it exists, and a pane
dragged into a split two levels away still answers to what a trader called it. The
name being typed is held in the box and nowhere else, so the workspace hears one
rename when it is committed rather than one per keystroke.

A pane nobody has named is named by where it is, `Trades` and then
`Trades, pane 2`, which is what gives the region label, the grid's own accessible
name and the separators either side of it something to say before anyone has typed
anything. That positional default was kept rather than replaced by the naming
feature, and the reason is worth recording: a default drawn from the pane's
identity instead would have read `Trades 2` for the only pane on screen, because
StrictMode double-invokes a lazy state initialiser and the counter behind the pane
ids therefore starts at two in development.

Clearing the box takes the name back off rather than setting an empty one, because
absent and a name that happens to be empty are different states. A link carries
the names somebody chose and leaves the rest to the position, so a pane put back
on its default renumbers to wherever it sits when the link is opened. Pressing
Enter on a name that was not changed is not a rename either, or merely clicking a
default name would fix it onto the pane and the link would then have to carry a
name nobody chose. **Duplicate** does not take the source's name for the same
reason: two panes called the same thing are two panes nobody can tell apart, on
screen or in a screen reader.

**A shared link carries the view and the arrangement, not the data and not the
reading position.** Each pane's grouping, ordering, filters and columns go into
the query string, along with where the pane sits and how much of the window it
has. Which groups someone had expanded and which row they had selected are
deliberately left out: those are where a trader was, not how they were looking.

**The address bar follows the workspace, so a reload comes back to it.** The
defect that made this necessary: open a third pane, reload, and the workspace is
back to two, because the bar still held the link from before the third was there
and **Share** was the only thing that ever wrote it. Now every change writes it,
which leaves Share with the one job it is named for, putting the link on the
clipboard. Writes are debounced by a quarter of a second, because a filter
arrives one keystroke at a time and `history.replaceState` is rate limited by the
browser, Safari at around a hundred calls in thirty seconds. `replaceState` and
not `pushState`: a sort changed four times is not four places for the back button
to return to.

Nothing is written on arrival, which is the one asymmetry in that. On arrival the
bar is the source rather than the record, and rewriting it into the canonical
form of itself would throw away the only copy of what somebody typed. That
matters most for the link that did not parse, since the query a trader needs to
be able to read is exactly the one the workspace could not open.

**The link is readable, and is meant to be edited.** Two panes, a grouping, a
sort, a filter and a hidden column read as this and nothing more:

```
?panes=2&p1.group=symbol&p1.hide=book
        &p2.sort=quantity&p2.where.symbol=BARC&p2.show=tradeId
```

Panes are numbered from one, matching the names a pane gets from its position on
screen when nobody has given it one of its own. `-` marks a
descending sort, as it does in most APIs that take one. A filter is one parameter
per column rather than a list of pairs, because a value is free text and any
separator picked for it is a separator a trader can type into the box and break
their own link with. Lists repeat the key instead of joining on a comma, for a
duller reason: `URLSearchParams` serialises to form-urlencoding, whose safe set
is alphanumerics plus `*`, `-`, `.` and `_`, so one comma-joined list would have
put `%2C` in the address bar and taken the readability with it. Nothing in the
query is escaped except the two parts of it that are free text someone typed into
a box, a filter value and a pane's name, and a space in either comes out as `+`,
which is in the safe set and still reads as a space.

The count only has to be stated for a pane that carries no settings of its own,
so appending `?p1.group=symbol` to a bare address is a complete request. That is
the case the format exists for: changing a view without opening the app, and
being able to read a colleague's link before clicking it.

**A link states what a pane does differently, and nothing it does the same.** The
view a pane opens on is ordered by time with the trade id column off, so neither
of those appears in a link that leaves them alone. Writing them would put
`p1.sort=-tradeTimestamp&p1.hide=tradeId` on every pane of every workspace and
bury the thing the link is actually for. A pane that shows the trade id writes
`show=tradeId`, which is the fact worth sending, and a pane nobody has configured
writes nothing but its own number. The one case that has to be stated is a pane
somebody unsorted, because an absent sort now means the default order: `p1.sort=`
with nothing after it is a pane with no order at all. A hand-edited link that
states the default anyway is read as what it says and simply stops stating it the
next time the bar is written, so editing one is forgiving and what comes back out
of it is canonical.

`p{n}.name` carries a name somebody gave a pane, and only that: a pane on its
positional name writes no name at all, because stating it would be stating the
pane's own number back. It leads each pane's parameters, so a link to a named
workspace says what the panes are called before it says how they are sorted.

```
?panes=2&p1.name=EU+Flow&p1.group=symbol&p2.name=Cancels&p2.where.status=CANCELLED
```

**The arrangement rides along in three more parameters, and all three are
omitted when they say nothing.** A stack of evenly sized panes is what a link
opens on, so the common case writes none of them, and a link from before the
panes could nest still means what it meant:

```
?panes=3&axis=columns&p1.at=0.0&p2.at=0.1&p3.at=1&p1.size=0.1&p2.size=0.3&p3.size=0.6
```

`axis` is the root split's, and the only one there is to state, because no split
holds a split on its own axis and the rest therefore alternate with depth.
`p{n}.at` is the child index at each level down to the pane, so `0.1` is the
second region of the first. `p{n}.size` is the pane's share of the **window**,
not of the split above it, which is the one of the two numbers that still means
the same thing after the levels in between have changed: a weight is only
meaningful beside its siblings, so the weights are re-derived from the shares on
the way back in.

Paths are forgiving about two things and strict about one, because a readable URL
is a URL people hand-edit. A gap in the indices is an order and nothing more, so
`0` and `2` are the first and the second. A level holding a single slot has
nothing to divide, so what it holds moves up, which is the same rule that
promotes a region when the pane beside it is closed. But a pane and a split in
the same slot is a question with no answer, and the whole link is rejected rather
than guessed at. Sizes work the same way: state one and the rest divide what is
left over evenly, so `&p1.size=0.5` on a workspace of three is complete, while a
link that spends the window before it has placed every pane is rejected.

A path is stated for a pane and the leaves are numbered, so the paths are what
say where the panes go and the numbering is only how their parameters are
grouped. A hand-edited link whose two disagree draws the panes where the paths
put them, and renumbers them the next time the bar is written.

It replaced a base64url payload of the same state, which was opaque and, as it
turned out, three times longer at 374 characters against 114. JSON's repeated key
names were most of what was being encoded, and spelling the fields out as
four-letter parameters drops them entirely. What the old format got for free and
this one has to do deliberately is clearing: closing a pane or a filter now has
to remove a parameter, or the next read reassembles a workspace nobody is looking
at. There is a test for exactly that.

The parsed result is still `safeParse`d and discarded whole on any failure. The
schema names the twelve real column ids, holds panes to a floor of one so the
invariant above cannot be bypassed by URL, and caps them at eight, since each
pane is a table model and a virtualiser and a link is a thing someone else
clicks. A readable URL is a URL people mistype, so this path is now reached far
more often than the base64 one was, and it still rejects the whole link rather
than applying the part it could read: a half-applied link shows a view nobody
chose, which reads as the app losing state rather than as the link being wrong.

**The magnitude bar is drawn on notional and scaled to what is on screen.**
10,000 shares of a 72p stock and of a 400p stock are not comparable sizes, and
notional is the figure a risk conversation is actually about. The scale is taken
over the filtered rows and quantised up to a round number, so bars rescale with
the filter instead of all collapsing to unreadably short, and one large arrival
does not re-scale every bar on the tape every two seconds. Leaf rows only: a
group's net is measured against other nets rather than against single trades, and
one axis cannot honestly carry both.

**Booking is protected against the repeat, not against the press.** A blanket
confirmation on **Book trade** would be the wrong fix: working an order in clips
means booking the same ticket several times in a row on purpose, so a dialog
every time trains the hand to dismiss it and then the one that matters is
dismissed too. What the system cannot otherwise tell apart is an intentional run
from an accidental repeat, so there are three separate guards and each answers a
different failure.

The first is the duplicate window. A press identical to the last booking in
symbol, side, quantity, price, book and counterparty, inside five seconds, holds
and the button asks to confirm, naming the trade it would repeat and how long ago
it went. Editing any field drops the hold, because a held press has to describe
what is on screen. The trader is deliberately not part of that signature: two
windows booking the same clip are two trades and neither is the other's
duplicate, so including it would let one window's booking silence the other's
warning.

The second is a notional ceiling. A single extra digit on the quantity is the
mistake that actually costs money, so a ticket over 250,000 holds the same way
and says what the figure and the limit are. The number is strictly over, since a
limit is a ceiling rather than something to argue with, and it sits at 3.4x the
prefilled ticket so one extra zero on the quantity trips it and ordinary booking
never sees it. A duplicate takes precedence over a size: an oversized ticket was
already confirmed for its size when it was first booked, so on a repeat the
repeat is the new information.

The third is the only one that is a guarantee rather than a prompt, and it
answers a failure the other two cannot see. Each ticket mints a `clientTradeId`,
sent with the booking and stored on the row under a unique index. A key that has
already booked returns that trade with a **200** instead of booking another, so a
retry after a timeout cannot double-book even though the first attempt may well
have committed before the response was lost, and so two submits racing each other
produce one trade. It is re-minted on success, which is what keeps a deliberate
second clip a second trade rather than a silent replay of the first. The key
identifies the request, not the trade, so it is absent from the read model and
never travels back to a client. It is optional, because the seed and the generated
feed book without one; Postgres treats nulls in a unique index as distinct, which
is what lets them.

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

**A splitter writes to the DOM while it is being dragged and commits once, on
release.** Everything else in this application holds its state in React, and this
is the one deliberate exception. A pane is a virtualised grid of 500 trades, so
putting a resize through state would re-render both panes on every pointer move;
instead the splitter sets `flex-grow` on its two neighbours directly and calls
back once when the pointer goes up, with the value it already wrote, so there is
no frame where the DOM and the state disagree. It reaches those two neighbours as
DOM siblings rather than through refs, which is sound because the markup that
places a splitter is the markup that guarantees a pane on each side of it.

**Dragging a pane uses native drag and drop, so the drop zones are mouse-only.**
The browser hit-tests real elements for us, and the alternative is measuring every
pane on every pointer move to work out which edge the cursor is nearest. The cost
is that HTML5 drag and drop is a pointer gesture with no keyboard equivalent, so
the four zones are `aria-hidden` and the keyboard route is the handle's own arrow
keys, which make the same four requests. It also means the zones cannot be found
by role in a test and are addressed by their attributes, the same way rows are
found by `data-trade-id`.

A consequence that was a live bug for a while: **the zones cannot show where a
drop is going with `:hover`**, because a browser stops updating hover states once
a native drag is in progress. The outline they originally carried therefore never
appeared, and it took a screenshot to notice.

**What replaced it previews the arrangement, not the zone.** The two are
different rectangles, and the first attempt drew the wrong one. Aiming at the
bottom third of a pane in a side-by-side workspace turns the workspace vertical
and gives the dragged pane a full-width band of roughly half the height: it does
not land in the third the pointer is in. Tinting the zone therefore described the
hit test rather than the result. So `dragover` now feeds a ghost layer over the
whole workspace, with one empty div per pane at the axis, order and share the
drop would produce, and the pane being moved outlined among them. It is built by
calling the same `placementFor` and `moved` the drop itself calls, so the preview
cannot promise one outcome and the drop deliver another. The ghosts hold no
content, so this costs a handful of divs rather than a second copy of two
virtualised grids, and their `gap-2` is exactly the 8px a real separator occupies
as a flex item, which is what puts them on the boundaries the panes will take.

Three details in there that are each a bug if missed. The layer carries
`pointer-events-none`: it sits above the drop zones, so without it the preview
would swallow the `dragover` that draws it and the drop that ends it. `dragleave`
bubbles up from the zone being left, so a pointer crossing from one zone of a
pane to the next looks identical to one leaving the pane, and the handler
compares `relatedTarget` against the pane or the preview strobes as the hand
moves. And the aim is reported from `dragover` rather than `dragenter`, which
does not fire again when a pointer re-enters the zone it started in. jsdom
declares no `DragEvent`, so `relatedTarget` is dropped there and the test setup
aliases it to `MouseEvent`, which carries everything these handlers read.

**The positions panel's width is the one part of the layout a link does not
carry.** Everything about the workspace itself travels now: which pane is where,
which way round the axis is, how the space is divided and what each pane is
called. The panel boundary is the exception, so it survives a drag and not a
reload, and a link opens it at whatever width the receiver last left it at rather
than at the sender's. Closing that is one more parameter in the same schema,
`panel` beside `panes`, and it was left for the deadline rather than for a reason.
It belongs there rather than in a second store of its own, because two places that
both describe the layout is how a workspace comes back half restored.

**Rows are virtualised against a stated row height rather than a measured one.**
Every row is exactly 32px, so the virtualiser is told the height instead of
measuring each row, which is most of what makes a second pane cheap rather than
twice the work. It also forces `table-layout: fixed` with an explicit
`colgroup`: left to the browser, column widths are decided by whichever rows
happen to be in view and shift as the tape scrolls, and keeping the digits on a
vertical line down quantity, price and notional is the one explicit UX
requirement in the brief. The cost is that every column has to state a width, and
a row whose height stopped being 32px would scroll the tape to the wrong place.

**Both booking guards are advisory, and the limit is one hardcoded number.** The
duplicate window and the notional ceiling live in the browser and hold a press
rather than refusing a booking, so `curl` is not subject to either and nor is the
generated feed. That is the right place for them: they are about what the hand
just did, which is information only the client has, and the server's job is the
guarantee rather than the nag. The idempotency key is the half that is enforced,
by a unique index rather than by a check the client could skip.

A real desk would not read its limit out of a constant either. It would come from
a limits service, per book and per trader and probably per symbol, with a
four-eyes override above a second threshold and the breach recorded whether or not
it was confirmed. `NOTIONAL_LIMIT` is one number in one module so that
substitution is a provider swap rather than a rewrite, and the guard logic is a
pure function tested without React for the same reason.

**A replayed booking answers 200 and publishes nothing.** The trade is in the
body either way, so a client that ignores the status still gets what it asked
for, and one that reads it can tell that its retry did not double-book. No frame
goes out, because a replay wrote no event: there is no `seq` to put on a frame,
re-broadcasting would flash a row every client already has, and positions cannot
have moved. The cost is that **201** is no longer a reliable signal that a POST
created something, which is why the route states the distinction and the tests
assert both codes.

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

**The generated feed re-reads every active trade on each tick** to pick something
to amend or cancel. At one write every two seconds against a thousand rows that
is free, and it keeps the picker a pure function over a plain list. A faster
cadence or a larger book would need a sampling query instead, which is a change
to one injected callback rather than to the feed itself.

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
