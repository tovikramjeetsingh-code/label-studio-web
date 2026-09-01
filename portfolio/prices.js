// Price refresh. Best-effort by design: this is a static page with no server,
// so every fetch can fail (CORS, an API moving, being offline) and none of it
// is allowed to break the portfolio. A holding always keeps its last known
// price, and a price you type by hand always wins until you clear it.
//
//   Mutual funds — mfapi.in, a CORS-enabled mirror of the AMFI NAV file.
//                  A scheme is linked once (by ISIN, else by name) and the
//                  scheme code is remembered.
//   Stocks/ETFs  — tried against Yahoo's chart endpoint, which is unofficial
//                  and may refuse a browser request. When it does, the price
//                  stays manual.
(function (root) {
  "use strict";

  var MF_API = "https://api.mfapi.in/mf";
  var YF_API = "https://query1.finance.yahoo.com/v8/finance/chart/";
  var TIMEOUT = 9000;

  function getJSON(url) {
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { ctl && ctl.abort(); }, TIMEOUT);
    return fetch(url, { signal: ctl && ctl.signal, mode: "cors", cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .finally(function () { clearTimeout(timer); });
  }

  // mfapi dates are dd-mm-yyyy
  function mfDate(s) {
    var m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(s || ""));
    return m ? m[3] + "-" + m[2] + "-" + m[1] : "";
  }

  function searchSchemes(q) {
    return getJSON(MF_API + "/search?q=" + encodeURIComponent(q)).then(function (list) {
      return (list || []).slice(0, 25).map(function (s) {
        return { code: String(s.schemeCode), name: s.schemeName };
      });
    });
  }

  function navFor(code) {
    return getJSON(MF_API + "/" + encodeURIComponent(code)).then(function (r) {
      var d = r && r.data || [];
      if (!d.length) throw new Error("No NAV history for scheme " + code);
      return {
        value: parseFloat(d[0].nav),
        prev: d[1] ? parseFloat(d[1].nav) : 0,
        date: mfDate(d[0].date),
        source: "mfapi",
        schemeName: r.meta && r.meta.scheme_name || "",
      };
    });
  }

  // Pick the closest scheme name, preferring an exact-ish match over a
  // plausible one — "Growth" and "IDCW" plans of the same fund differ only in
  // a word, so a wrong link is easy and worth guarding against.
  function bestMatch(name, list) {
    var want = norm(name);
    var scored = list.map(function (s) {
      var got = norm(s.name), score = 0;
      if (got === want) score = 1000;
      else {
        var w = want.split(" "), hits = 0;
        w.forEach(function (t) { if (t.length > 2 && got.indexOf(t) >= 0) hits++; });
        score = hits / Math.max(1, w.length) * 100;
        if (/direct/.test(want) !== /direct/.test(got)) score -= 25;
        if (/growth/.test(want) !== /growth/.test(got)) score -= 15;
        if (/idcw|dividend/.test(want) !== /idcw|dividend/.test(got)) score -= 15;
      }
      return { s: s, score: score };
    }).sort(function (a, b) { return b.score - a.score; });
    return scored[0] && scored[0].score >= 60 ? scored[0] : null;
  }
  function norm(s) {
    return String(s || "").toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ").replace(/\bplan\b|\boption\b|\bfund\b/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  // Resolve a scheme code for a holding, remembering it on the holding and in
  // the shared link table so the same fund in another folio resolves instantly.
  function linkScheme(store, h) {
    if (h.schemeCode) return Promise.resolve(h.schemeCode);
    var links = store.get().links || {};
    var byIsin = h.isin && links[h.isin];
    if (byIsin) { store.updateHolding(h.id, { schemeCode: byIsin }); return Promise.resolve(byIsin); }

    return searchSchemes(h.name || h.isin || "").then(function (list) {
      var best = bestMatch(h.name, list);
      if (!best) return null;
      store.updateHolding(h.id, { schemeCode: best.s.code });
      if (h.isin) store.get().links[h.isin] = best.s.code;
      return best.s.code;
    });
  }

  function stockQuote(symbol) {
    var sym = String(symbol || "").trim().toUpperCase();
    if (!sym) return Promise.reject(new Error("No symbol"));
    if (!/[.:]/.test(sym)) sym += ".NS";              // default to NSE
    return getJSON(YF_API + encodeURIComponent(sym) + "?range=5d&interval=1d").then(function (r) {
      var m = r && r.chart && r.chart.result && r.chart.result[0] && r.chart.result[0].meta;
      if (!m || !m.regularMarketPrice) throw new Error("No quote for " + sym);
      return {
        value: m.regularMarketPrice,
        prev: m.chartPreviousClose || m.previousClose || 0,
        date: new Date((m.regularMarketTime || Date.now() / 1000) * 1000).toISOString().slice(0, 10),
        source: "yahoo",
      };
    });
  }

  // Refreshes everything that is not pinned to a manual price.
  // onProgress(done, total, name) is optional. Never rejects.
  function refreshAll(store, onProgress) {
    var holdings = store.get().holdings.slice();
    var total = holdings.length, done = 0;
    var res = { updated: 0, manual: 0, failed: [], skipped: 0 };

    function step(h) {
      var existing = store.priceOf(h);
      if (existing && existing.source === "manual" && existing.pinned) {
        res.manual++; return Promise.resolve();
      }
      var p = h.kind === "stock"
        ? stockQuote(h.symbol || h.name)
        : linkScheme(store, h).then(function (code) {
            if (!code) throw new Error("Could not match “" + h.name + "” to a scheme");
            return navFor(code);
          });

      return p.then(function (price) {
        store.setPrice(h.id, price);
        res.updated++;
      }).catch(function (err) {
        res.failed.push({ name: h.name, reason: (err && err.message) || "failed" });
      }).then(function () {
        done++;
        if (onProgress) onProgress(done, total, h.name);
      });
    }

    // Sequential on purpose: a burst of parallel requests to a free API is the
    // quickest way to get rate-limited mid-refresh.
    return holdings.reduce(function (chain, h) {
      return chain.then(function () { return step(h); });
    }, Promise.resolve()).then(function () { return res; });
  }

  var API = {
    searchSchemes: searchSchemes, navFor: navFor, stockQuote: stockQuote,
    linkScheme: linkScheme, refreshAll: refreshAll, bestMatch: bestMatch, norm: norm,
  };
  root.PFPrices = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
