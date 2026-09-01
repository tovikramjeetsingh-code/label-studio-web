// node portfolio/test/run.js — checks the maths and the CAS parsers against
// fixtures shaped like the real statements. No browser, no network.
const calc = require("../calc.js");
const cas = require("../cas.js");

let pass = 0, fail = 0;
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 0.01 : tol);
function ok(name, cond, got) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (got !== undefined ? "  got: " + JSON.stringify(got) : "")); }
}
function group(n) { console.log("\n" + n); }

/* ---------------- calc: FIFO ---------------- */
group("FIFO lots and realized gains");
{
  const p = calc.position([
    { date: "2024-01-10", type: "buy",  units: 100, amount: 1000, nav: 10 },
    { date: "2024-06-10", type: "buy",  units: 100, amount: 2000, nav: 20 },
    { date: "2024-09-10", type: "sell", units: 150, amount: 3750, nav: 25 },
  ]);
  ok("50 units left", near(p.units, 50), p.units);
  ok("remaining cost is the newer lot", near(p.invested, 1000), p.invested);
  ok("avg cost 20", near(p.avgCost, 20), p.avgCost);
  ok("realized 1750 (FIFO, not average)", near(p.realized, 1750), p.realized);
}
{
  const p = calc.position([
    { date: "2024-01-10", type: "buy",    units: 10, amount: 1000, nav: 100 },
    { date: "2024-02-10", type: "income", units: 0,  amount: 50 },
  ]);
  ok("payout does not change units", near(p.units, 10), p.units);
  ok("payout recorded as income", near(p.income, 50), p.income);
}
{
  const p = calc.position([{ date: "2024-01-10", type: "sell", units: 10, amount: 500, nav: 50 }]);
  ok("selling with no lots is zero-cost, not negative units", near(p.units, 0) && near(p.realized, 500), p);
}

/* ---------------- calc: XIRR ---------------- */
group("XIRR");
{
  const r = calc.xirr([
    { date: "2024-01-01", amount: -1000 },
    { date: "2024-12-31", amount: 1100 },
  ]);
  ok("~10% over one year", near(r, 0.1, 0.002), r);
}
{
  // 12 monthly SIPs of 1000; ends at 13000 -> positive but modest return
  const flows = [];
  for (let m = 0; m < 12; m++) flows.push({ date: `2024-${String(m + 1).padStart(2, "0")}-01`, amount: -1000 });
  flows.push({ date: "2025-01-01", amount: 13000 });
  const r = calc.xirr(flows);
  ok("SIP XIRR is positive and sane", r > 0.1 && r < 0.35, r);
}
ok("no sign change -> null", calc.xirr([{ date: "2024-01-01", amount: -100 }, { date: "2024-06-01", amount: -100 }]) === null);
ok("single flow -> null", calc.xirr([{ date: "2024-01-01", amount: -100 }]) === null);

/* ---------------- calc: rollup ---------------- */
group("Portfolio roll-up");
{
  const holdings = [
    { id: "h1", kind: "mf", name: "Flexi Cap" },
    { id: "h2", kind: "stock", name: "RELIANCE" },
  ];
  const txns = [
    { holdingId: "h1", date: "2024-01-01", type: "buy", units: 100, amount: 1000, nav: 10 },
    { holdingId: "h2", date: "2024-01-01", type: "buy", units: 10, amount: 10000, nav: 1000 },
  ];
  const prices = { h1: { value: 12, prev: 11 }, h2: { value: 1200, prev: 1200 } };
  const r = calc.rollup(holdings, txns, (h) => prices[h.id]);
  ok("value = 1200 + 12000", near(r.totals.value, 13200), r.totals.value);
  ok("invested 11000", near(r.totals.invested, 11000), r.totals.invested);
  ok("unrealized 2200", near(r.totals.unrealized, 2200), r.totals.unrealized);
  ok("day change from prev NAV", near(r.totals.dayChange, 100), r.totals.dayChange);
  ok("allocation adds to 100%", near(r.allocation.reduce((s, a) => s + a.pct, 0), 100), r.allocation);
  ok("stocks are the bigger sleeve", r.allocation[0].label === "Stocks & ETFs", r.allocation);
}

/* ---------------- cas: helpers ---------------- */
group("CAS helpers");
ok("indian digits", near(cas.num("1,23,456.78"), 123456.78), cas.num("1,23,456.78"));
ok("brackets are negative", near(cas.num("(1,000.500)"), -1000.5), cas.num("(1,000.500)"));
ok("dd-Mon-yyyy", cas.date("14-Mar-2023") === "2023-03-14", cas.date("14-Mar-2023"));
ok("dd/mm/yyyy", cas.date("05/09/2024") === "2024-09-05", cas.date("05/09/2024"));
ok("purchase -> buy", cas.classify("Purchase-SIP") === "buy");
ok("redemption -> sell", cas.classify("Redemption") === "sell");
ok("switch out -> sell", cas.classify("Switch Out - To HDFC Liquid") === "sell");
ok("reinvestment -> buy", cas.classify("Dividend Reinvestment") === "buy");
ok("idcw payout -> income", cas.classify("IDCW Payout") === "income");
ok("stamp duty ignored", cas.classify("*** Stamp Duty ***") === null);

/* ---------------- cas: CAMS fixture ---------------- */
group("CAMS / KFintech MF CAS");
const camsLines = [
  "Consolidated Account Statement",
  "Statement Period: 01-Apr-2024 To 31-Mar-2025",
  "HDFC Mutual Fund",
  "Folio No: 12345678 / 90 PAN: ABCDE1234F KYC: OK",
  "HDFC Flexi Cap Fund - Growth Plan (Advisor: ARN-0005) Registrar : CAMS ISIN: INF179K01YV8",
  "Opening Unit Balance: 0.000",
  "05-Apr-2024 Purchase 10,000.00 8.6050 1,162.0300 8.6050",
  "05-May-2024 Purchase-SIP 5,000.00 4.2000 1,190.4761 12.8050",
  "10-Jun-2024 *** Stamp Duty *** 0.50",
  "15-Dec-2024 Redemption (2,000.00) (1.6000) 1,250.0000 11.2050",
  "20-Jan-2025 IDCW Payout 300.00 0.0000 1,300.0000 11.2050",
  "Closing Unit Balance: 11.2050 NAV on 31-Mar-2025: INR 1,400.0000 Market Value on 31-Mar-2025: INR 15,687.00",
  "ICICI Prudential Mutual Fund",
  "Folio No: 99887766 / 11",
  "ICICI Prudential Bluechip Fund - Growth Registrar : KFINTECH ISIN: INF109K01BL4",
  "01-Jul-2024 Purchase 20,000.00 200.0000 100.0000 200.0000",
  "Closing Unit Balance: 200.0000 NAV on 31-Mar-2025: INR 115.5000 Market Value on 31-Mar-2025: INR 23,100.00",
];
{
  const r = cas.parseLines(camsLines);
  ok("format detected", r.formats.includes("CAMS/KFintech MF CAS"), r.formats);
  ok("two schemes", r.items.length === 2, r.items.map((i) => i.name));
  const a = r.items[0];
  ok("scheme name cleaned of ISIN/advisor/registrar", a.name === "HDFC Flexi Cap Fund - Growth Plan", a.name);
  ok("isin", a.isin === "INF179K01YV8", a.isin);
  ok("folio", a.folio === "12345678/90", a.folio);
  ok("amc", a.amc === "HDFC Mutual Fund", a.amc);
  ok("kind mf", a.kind === "mf");
  ok("4 usable txns, stamp duty dropped", a.txns.length === 4, a.txns);
  ok("first txn parsed", a.txns[0].date === "2024-04-05" && near(a.txns[0].units, 8.605) && near(a.txns[0].nav, 1162.03), a.txns[0]);
  ok("bracketed redemption is a sell", a.txns[2].type === "sell" && near(a.txns[2].units, 1.6), a.txns[2]);
  ok("payout is income", a.txns[3].type === "income" && near(a.txns[3].amount, 300), a.txns[3]);
  ok("closing balance", near(a.units, 11.205), a.units);
  ok("statement NAV", near(a.price, 1400), a.price);
  ok("statement value", near(a.value, 15687), a.value);
  ok("period read", r.period && r.period.from === "2024-04-01" && r.period.to === "2025-03-31", r.period);
  ok("second folio kept separate", r.items[1].folio === "99887766/11", r.items[1].folio);

  // the parsed transactions must reproduce the statement's own closing balance
  const p = calc.position(a.txns);
  ok("txns reproduce closing units", near(p.units, 11.205, 0.001), p.units);
}

/* ---------------- cas: demat fixture ---------------- */
group("NSDL / CDSL demat CAS");
const dematLines = [
  "NSDL Consolidated Account Statement",
  "As on 31-Mar-2025",
  "ISIN Security Current Bal Free Bal Market Price Value(In Rs.)",
  "INE002A01018 RELIANCE INDUSTRIES LIMITED 10.000 10.000 1,234.50 12,345.00",
  "INE467B01029 TATA CONSULTANCY SERVICES LTD 5.000 5.000 3,500.00 17,500.00",
  "Total 29,845.00",
];
{
  const r = cas.parseLines(dematLines);
  ok("format detected", r.formats.includes("NSDL/CDSL demat CAS"), r.formats);
  ok("two securities", r.items.length === 2, r.items.map((i) => i.name));
  const s = r.items[0];
  ok("kind stock", s.kind === "stock");
  ok("name", s.name === "RELIANCE INDUSTRIES LIMITED", s.name);
  ok("qty", near(s.units, 10), s.units);
  ok("price", near(s.price, 1234.5), s.price);
  ok("value", near(s.value, 12345), s.value);
  ok("flagged for a cost basis", s.needsCost === true);
  ok("as-on date", r.asOf === "2025-03-31", r.asOf);
}

/* ---------------- cas: combined statement ---------------- */
group("Statement carrying both sections");
{
  const r = cas.parseLines(camsLines.concat(dematLines));
  ok("both formats", r.formats.length === 2, r.formats);
  ok("4 items total", r.items.length === 4, r.items.length);
  ok("MF blocks keep their transactions", r.items.filter((i) => i.txns.length).length === 2);
}
{
  // an ISIN duplicated in both sections must not double-count
  const r = cas.parseLines(camsLines.concat([
    "INF179K01YV8 HDFC FLEXI CAP FUND GROWTH 11.205 11.205 1,400.00 15,687.00",
  ]));
  ok("duplicate ISIN dropped in favour of the CAMS block", r.items.length === 2, r.items.map((i) => i.name));
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
