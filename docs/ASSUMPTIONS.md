# Assumptions made

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
