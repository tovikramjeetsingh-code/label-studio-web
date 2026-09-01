// Portfolio maths — FIFO lots, realized/unrealized P&L, XIRR, allocation.
// Pure functions over the transaction list; no DOM, no storage. Also loadable
// under node so portfolio/test/run.js can check it.
(function (root) {
  "use strict";

  var DAY = 86400000;

  function toMs(d) {
    if (d instanceof Date) return d.getTime();
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
    if (!m) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  }
  function today() {
    var n = new Date();
    return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  }
  function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function round(n, p) { var f = Math.pow(10, p == null ? 2 : p); return Math.round(n * f) / f; }

  // ---- FIFO position for one holding -------------------------------------
  // txns: [{date, type:'buy'|'sell'|'income', units, amount, nav}]
  // Buys open lots; sells consume the oldest lots first (how Indian capital
  // gains are computed); income (IDCW payout) is cash out of the fund that
  // never touches the unit balance.
  function position(txns) {
    var rows = (txns || []).slice().sort(function (a, b) {
      return toMs(a.date) - toMs(b.date) || (a.type === "buy" ? -1 : 1);
    });
    var lots = [], realized = 0, income = 0, sold = 0, bought = 0;

    rows.forEach(function (t) {
      var units = Math.abs(Number(t.units) || 0);
      var amount = Math.abs(Number(t.amount) || 0);

      if (t.type === "income") { income += amount; return; }

      if (t.type === "buy") {
        if (!units) return;
        var cpu = Number(t.nav) || amount / units;
        bought += cpu * units;
        lots.push({ units: units, cpu: cpu, date: t.date });
        return;
      }

      if (t.type === "sell") {
        if (!units) return;
        var price = Number(t.nav) || (units ? amount / units : 0);
        var left = units;
        sold += price * units;
        while (left > 1e-9 && lots.length) {
          var lot = lots[0];
          var take = Math.min(lot.units, left);
          realized += (price - lot.cpu) * take;
          lot.units -= take;
          left -= take;
          if (lot.units <= 1e-9) lots.shift();
        }
        // Selling more units than the lots hold means the opening balance was
        // never imported; treat the excess as zero-cost rather than dropping it.
        if (left > 1e-9) realized += price * left;
      }
    });

    var units = lots.reduce(function (s, l) { return s + l.units; }, 0);
    var invested = lots.reduce(function (s, l) { return s + l.units * l.cpu; }, 0);
    return {
      units: units,
      invested: invested,
      avgCost: units > 1e-9 ? invested / units : 0,
      realized: realized,
      income: income,
      bought: bought,
      sold: sold,
      lots: lots,
    };
  }

  // ---- XIRR ---------------------------------------------------------------
  // Money-weighted return. Bisection rather than Newton: slower, but it cannot
  // diverge on the lumpy SIP-plus-redemption flows a real portfolio produces.
  function xnpv(rate, flows) {
    var t0 = toMs(flows[0].date);
    var s = 0;
    for (var i = 0; i < flows.length; i++) {
      var yrs = (toMs(flows[i].date) - t0) / DAY / 365;
      s += flows[i].amount / Math.pow(1 + rate, yrs);
    }
    return s;
  }

  function xirr(flows) {
    var f = (flows || []).filter(function (x) { return Number(x.amount); })
      .sort(function (a, b) { return toMs(a.date) - toMs(b.date); });
    if (f.length < 2) return null;
    var pos = f.some(function (x) { return x.amount > 0; });
    var neg = f.some(function (x) { return x.amount < 0; });
    if (!pos || !neg) return null;                 // no sign change, no root

    var lo = -0.9999, hi = 10, flo = xnpv(lo, f), fhi = xnpv(hi, f);
    if (flo * fhi > 0) {                           // widen once for extreme cases
      hi = 100; fhi = xnpv(hi, f);
      if (flo * fhi > 0) return null;
    }
    for (var i = 0; i < 200; i++) {
      var mid = (lo + hi) / 2, fm = xnpv(mid, f);
      if (Math.abs(fm) < 1e-9) return mid;
      if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  }

  // Cash flows for XIRR: money leaving you is negative, money coming back is
  // positive, and today's market value counts as a final inflow.
  function cashflows(txns, currentValue, asOf) {
    var f = (txns || []).map(function (t) {
      var amt = Math.abs(Number(t.amount) || 0);
      if (t.type === "buy") return { date: t.date, amount: -amt };
      return { date: t.date, amount: amt };        // sell + income
    }).filter(function (x) { return x.amount; });
    if (currentValue > 0) f.push({ date: iso(asOf || today()), amount: currentValue });
    return f;
  }

  // ---- portfolio roll-up --------------------------------------------------
  // holdings: [{id, kind, name, ...}]  txnsByHolding: {holdingId: [txn]}
  // priceOf(holding) -> {value, prev, date, source} | null
  function rollup(holdings, txns, priceOf) {
    var byHolding = {};
    (txns || []).forEach(function (t) {
      (byHolding[t.holdingId] = byHolding[t.holdingId] || []).push(t);
    });

    var rows = (holdings || []).map(function (h) {
      var p = position(byHolding[h.id] || []);
      var price = (priceOf && priceOf(h)) || null;
      var pv = price && Number(price.value) || 0;
      var value = p.units * pv;
      var prev = price && Number(price.prev) || 0;
      return {
        holding: h,
        units: p.units,
        invested: p.invested,
        avgCost: p.avgCost,
        realized: p.realized,
        income: p.income,
        price: price,
        value: value,
        unrealized: value - p.invested,
        unrealizedPct: p.invested > 0 ? (value - p.invested) / p.invested * 100 : 0,
        dayChange: prev && pv ? (pv - prev) * p.units : 0,
        xirr: xirr(cashflows(byHolding[h.id] || [], value)),
        txns: byHolding[h.id] || [],
        priced: !!(price && price.value),
      };
    });

    var open = rows.filter(function (r) { return r.units > 1e-6; });
    var invested = sum(open, "invested"), value = sum(open, "value");
    var allFlows = [];
    (txns || []).forEach(function (t) {
      var amt = Math.abs(Number(t.amount) || 0);
      if (!amt) return;
      allFlows.push({ date: t.date, amount: t.type === "buy" ? -amt : amt });
    });
    if (value > 0) allFlows.push({ date: iso(today()), amount: value });

    return {
      rows: rows,
      open: open,
      closed: rows.filter(function (r) { return r.units <= 1e-6 && r.txns.length; }),
      totals: {
        invested: invested,
        value: value,
        unrealized: value - invested,
        unrealizedPct: invested > 0 ? (value - invested) / invested * 100 : 0,
        realized: sum(rows, "realized"),
        income: sum(rows, "income"),
        dayChange: sum(open, "dayChange"),
        xirr: xirr(allFlows),
        unpriced: open.filter(function (r) { return !r.priced; }).length,
      },
      allocation: allocate(open, value),
    };
  }

  function sum(rows, key) {
    return rows.reduce(function (s, r) { return s + (Number(r[key]) || 0); }, 0);
  }

  function allocate(rows, total) {
    var byKind = {};
    rows.forEach(function (r) {
      var k = r.holding.kind === "stock" ? "Stocks & ETFs" : "Mutual funds";
      byKind[k] = (byKind[k] || 0) + r.value;
    });
    return Object.keys(byKind).map(function (k) {
      return { label: k, value: byKind[k], pct: total > 0 ? byKind[k] / total * 100 : 0 };
    }).sort(function (a, b) { return b.value - a.value; });
  }

  var API = {
    position: position, xirr: xirr, xnpv: xnpv, cashflows: cashflows,
    rollup: rollup, allocate: allocate, toMs: toMs, iso: iso, today: today, round: round,
  };

  root.PFCalc = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
