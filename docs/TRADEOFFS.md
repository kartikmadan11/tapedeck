# Trade-offs accepted

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
