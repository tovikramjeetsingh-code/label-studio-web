# Portfolio — mutual funds & stocks, in the browser

A personal portfolio tracker that runs entirely on this page. Import a
Consolidated Account Statement, and it works out units, cost, realised and
unrealised P&L, allocation and **XIRR**, then keeps a daily value history so a
few months of testing produces a real curve.

Nothing is uploaded and there is no account: the PDF is read locally by the
`pdf.js` already vendored for the label tools, and everything is stored in this
browser's `localStorage`. The JSON export is the only way data leaves the device.

Open it at `/portfolio/`.

## Importing a CAS

| Statement | What comes in | Cost basis |
|---|---|---|
| **CAMS / KFintech** MF CAS | every folio, scheme and transaction | exact — computed from the transactions |
| **NSDL / CDSL** demat CAS | ISIN, name, quantity, market price | **you enter it** — the statement has no purchase price |

Password-protected statements (the usual emailed CAS) are handled: the password
box appears when the PDF asks for one, and it is used only to open the file.

Every parsed row lands in an editable **review table** before anything is saved —
names can be corrected, rows unticked, and demat rows given an average buy price.
If a layout is not recognised, **Show extracted text** dumps what came out of the
PDF so the parser can be adjusted.

Re-importing an overlapping statement is expected and safe:

- Duplicate transactions are matched on holding + date + type + units + amount
  and skipped.
- A demat holding that was already seeded is **not** seeded again — that would
  silently double the position. The review row instead says what it holds versus
  what the statement says, so the difference can be recorded as a buy or sell.

## Prices

Fetched on demand (and on load, unless switched off in **Backup**):

- **Mutual funds** — `api.mfapi.in`, a CORS-enabled mirror of the AMFI NAV file.
  A scheme is matched once by name, the scheme code is remembered, and the same
  fund in another folio then resolves instantly. Use **Link NAV scheme** on a
  holding to pick the right plan when the automatic match is wrong — Direct vs
  Regular and Growth vs IDCW differ by one word.
- **Stocks & ETFs** — attempted against Yahoo Finance's chart endpoint, which is
  unofficial and may refuse a browser request.

Every fetch is best-effort. A failure never clears a price or blocks the app: the
last known value stays, the refresh reports what failed, and a price typed by
hand and **pinned** is never overwritten.

## Numbers

- **Cost and realised gains use FIFO** — the oldest units are sold first, which
  is how Indian capital gains are computed. Average cost is over the remaining
  lots only.
- **XIRR** is money-weighted over every transaction plus today's value, solved by
  bisection so lumpy SIP-and-redemption histories cannot make it diverge.
- **Dividend / IDCW payouts** are income: they never change the unit balance, and
  they do count in XIRR.
- A demat holding seeded from a snapshot has one synthetic buy on the statement
  date, so its XIRR is only as good as that date and the average cost entered.

## Backup

`localStorage` is per browser and dies with cleared site data. **Export portfolio
JSON** regularly. Importing offers *merge* (matches holdings by ISIN + folio and
skips duplicate transactions) or *replace*.

## Tests

```
node portfolio/test/run.js
```

Covers FIFO lots, realised gains, XIRR, the roll-up, and both CAS parsers against
fixtures shaped like the real statements — including that the parsed transactions
reproduce the statement's own closing unit balance.

## Files

| File | Does |
|---|---|
| `calc.js` | FIFO positions, XIRR, portfolio roll-up, allocation |
| `cas.js` | PDF → text lines → CAMS / KFintech / NSDL / CDSL parsing |
| `store.js` | state, `localStorage`, dedupe, daily snapshots, export/import |
| `prices.js` | NAV and quote fetching, scheme linking, graceful failure |
| `app.js` | tabs, tables, the import review, events |

`calc.js`, `cas.js`, `store.js` and `prices.js` also load under node, which is
how the test file exercises them.
