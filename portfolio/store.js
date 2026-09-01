// Portfolio state — holdings, transactions, prices and daily snapshots, all in
// localStorage. Nothing is sent anywhere; the JSON export is the backup and the
// only way data moves between browsers.
(function (root) {
  "use strict";

  var KEY = "pf.portfolio.v1";
  var EMPTY = { v: 1, holdings: [], txns: [], prices: {}, snapshots: [], links: {}, settings: { autoPrices: true } };

  function uid(prefix) {
    return (prefix || "id") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var state = clone(EMPTY);
  var listeners = [];

  function load() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(KEY);
      if (raw) {
        var got = JSON.parse(raw);
        state = Object.assign(clone(EMPTY), got);
        state.settings = Object.assign(clone(EMPTY.settings), got.settings || {});
      }
    } catch (e) { /* private mode, or corrupted — start clean rather than die */ }
    return state;
  }

  function save() {
    try {
      root.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      notify("error", "Could not save — browser storage is full or blocked. Export a backup.");
    }
    listeners.forEach(function (fn) { fn(state); });
  }

  function notify(kind, msg) {
    (root.PFStore.onNotice || function () {})(kind, msg);
  }

  function subscribe(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }
  function get() { return state; }

  // ---- holdings -----------------------------------------------------------
  function holdingKey(h) {
    return [(h.isin || "").toUpperCase(), (h.folio || "").toUpperCase(),
            (h.isin ? "" : (h.name || "").toUpperCase())].join("|");
  }

  function findHolding(like) {
    var k = holdingKey(like);
    return state.holdings.filter(function (h) { return holdingKey(h) === k; })[0] || null;
  }

  function addHolding(h) {
    var found = findHolding(h);
    if (found) {
      ["name", "isin", "folio", "amc", "symbol", "schemeCode"].forEach(function (f) {
        if (!found[f] && h[f]) found[f] = h[f];       // fill blanks, never overwrite
      });
      return found;
    }
    var rec = {
      id: uid("h"), kind: h.kind === "stock" ? "stock" : "mf",
      name: h.name || "Untitled", isin: h.isin || "", folio: h.folio || "",
      amc: h.amc || "", symbol: h.symbol || "", schemeCode: h.schemeCode || "",
      added: new Date().toISOString().slice(0, 10),
    };
    state.holdings.push(rec);
    return rec;
  }

  function updateHolding(id, patch) {
    var h = state.holdings.filter(function (x) { return x.id === id; })[0];
    if (h) Object.assign(h, patch);
    save();
    return h;
  }

  function removeHolding(id) {
    state.holdings = state.holdings.filter(function (h) { return h.id !== id; });
    state.txns = state.txns.filter(function (t) { return t.holdingId !== id; });
    delete state.prices[id];
    save();
  }

  // ---- transactions -------------------------------------------------------
  // Re-importing a CAS that overlaps an earlier one is the normal case, so a
  // transaction is identified by its content, not by when it was added.
  function txnKey(t) {
    return [t.holdingId, t.date, t.type, round(t.units, 4), round(t.amount, 2)].join("|");
  }
  function round(n, p) { var f = Math.pow(10, p); return Math.round((Number(n) || 0) * f) / f; }

  function addTxns(list) {
    var seen = {};
    state.txns.forEach(function (t) { seen[txnKey(t)] = true; });
    var added = 0, skipped = 0;
    (list || []).forEach(function (t) {
      var rec = {
        id: uid("t"), holdingId: t.holdingId, date: t.date,
        type: t.type, units: Number(t.units) || 0, amount: Number(t.amount) || 0,
        nav: Number(t.nav) || 0, desc: t.desc || "", src: t.src || "manual",
      };
      if (!rec.date || !rec.holdingId) { skipped++; return; }
      var k = txnKey(rec);
      if (seen[k]) { skipped++; return; }
      seen[k] = true;
      state.txns.push(rec);
      added++;
    });
    save();
    return { added: added, skipped: skipped };
  }

  function removeTxn(id) {
    state.txns = state.txns.filter(function (t) { return t.id !== id; });
    save();
  }

  function txnsFor(id) {
    return state.txns.filter(function (t) { return t.holdingId === id; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  // ---- prices -------------------------------------------------------------
  function setPrice(holdingId, price) {
    var old = state.prices[holdingId];
    // Keep yesterday's number so the day change survives a refresh that only
    // returns a single quote.
    if (old && old.value && price && price.value && old.date && price.date && old.date !== price.date) {
      price.prev = price.prev || old.value;
    }
    state.prices[holdingId] = Object.assign({}, old, price);
    save();
  }
  function priceOf(h) { return state.prices[h.id] || null; }

  // ---- daily snapshots ----------------------------------------------------
  // One row per day: what the portfolio was worth and what it had cost. Six
  // months of these is the chart on the overview.
  function snapshot(value, invested) {
    if (!(value > 0)) return;
    var day = new Date().toISOString().slice(0, 10);
    var last = state.snapshots[state.snapshots.length - 1];
    if (last && last.date === day) { last.value = value; last.invested = invested; }
    else state.snapshots.push({ date: day, value: value, invested: invested });
    if (state.snapshots.length > 3000) state.snapshots = state.snapshots.slice(-3000);
    save();
  }

  // ---- backup -------------------------------------------------------------
  function exportJSON() {
    return JSON.stringify(Object.assign({}, state, {
      exported: new Date().toISOString(), app: "portfolio",
    }), null, 2);
  }

  function importJSON(text, mode) {
    var got = JSON.parse(text);
    if (!got || !Array.isArray(got.holdings)) throw new Error("Not a portfolio backup file.");
    if (mode === "replace") {
      state = Object.assign(clone(EMPTY), got);
      state.settings = Object.assign(clone(EMPTY.settings), got.settings || {});
      save();
      return { holdings: state.holdings.length, txns: state.txns.length, mode: "replace" };
    }
    // merge: map incoming holding ids onto whatever this browser already has
    var map = {}, hAdded = 0;
    got.holdings.forEach(function (h) {
      var before = state.holdings.length;
      var rec = addHolding(h);
      if (state.holdings.length > before) hAdded++;
      map[h.id] = rec.id;
      if (got.prices && got.prices[h.id] && !state.prices[rec.id]) state.prices[rec.id] = got.prices[h.id];
    });
    var res = addTxns((got.txns || []).map(function (t) {
      return Object.assign({}, t, { holdingId: map[t.holdingId] || t.holdingId });
    }));
    (got.snapshots || []).forEach(function (s) {
      if (!state.snapshots.some(function (x) { return x.date === s.date; })) state.snapshots.push(s);
    });
    state.snapshots.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    Object.assign(state.links, got.links || {});
    save();
    return { holdings: hAdded, txns: res.added, skipped: res.skipped, mode: "merge" };
  }

  function reset() { state = clone(EMPTY); save(); }

  var API = {
    load: load, save: save, get: get, subscribe: subscribe, uid: uid,
    addHolding: addHolding, updateHolding: updateHolding, removeHolding: removeHolding,
    findHolding: findHolding, holdingKey: holdingKey,
    addTxns: addTxns, removeTxn: removeTxn, txnsFor: txnsFor,
    setPrice: setPrice, priceOf: priceOf, snapshot: snapshot,
    exportJSON: exportJSON, importJSON: importJSON, reset: reset,
    onNotice: null,
  };
  root.PFStore = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
