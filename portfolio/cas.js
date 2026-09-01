// Consolidated Account Statement reader.
//
// Two layouts are understood:
//   * CAMS / KFintech MF CAS  — folios, schemes and every transaction row.
//   * NSDL / CDSL demat CAS   — an ISIN holdings table (quantity + price, but
//                               never a purchase cost, so cost is asked for).
// Text extraction uses the pdf.js already vendored for the label tools; the
// parsing below is plain string work so portfolio/test/run.js can exercise it
// on fixtures without a browser.
(function (root) {
  "use strict";

  var MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
  var ISIN_RE = /\b(IN[EF][A-Z0-9]{9})\b/;
  var NUM = "\\(?-?[\\d,]+\\.\\d{2,6}\\)?";

  function num(s) {
    if (s == null) return 0;
    var t = String(s).trim(), neg = /^\(.*\)$/.test(t);
    t = t.replace(/[(),]/g, "").replace(/^-/, function () { neg = true; return ""; });
    var v = parseFloat(t);
    if (!isFinite(v)) return 0;
    return neg ? -v : v;
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // "14-Mar-2023" / "14/03/2023" / "14-03-23" -> "2023-03-14"
  function date(s) {
    if (!s) return "";
    var m = /^(\d{1,2})[-/\s]([A-Za-z]{3})[a-z]*[-/\s](\d{2,4})$/.exec(String(s).trim());
    if (m) {
      var mo = MONTHS[m[2].toLowerCase()];
      if (!mo) return "";
      return year(m[3]) + "-" + pad(mo) + "-" + pad(+m[1]);
    }
    m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(String(s).trim());
    if (m) return year(m[3]) + "-" + pad(+m[2]) + "-" + pad(+m[1]);
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
    return m ? m[0] : "";
  }
  function year(y) { y = +y; return y < 100 ? (y > 70 ? 1900 + y : 2000 + y) : y; }

  // What a CAMS transaction description means for the unit balance.
  function classify(desc) {
    var d = (desc || "").toLowerCase();
    if (/stamp\s*duty|stt|tax deducted|tds|address|bank|nomination|kyc|folio/.test(d) &&
        !/purchase|redemption|switch/.test(d)) return null;
    if (/reinvest/.test(d)) return "buy";
    if (/idcw|dividend|payout/.test(d) && !/reinvest/.test(d)) return "income";
    if (/redemption|redeem|switch\s*out|sell|withdrawal|swp/.test(d)) return "sell";
    if (/purchase|investment|sip|switch\s*in|systematic|buy|instal/.test(d)) return "buy";
    return null;                                   // unknown wording: leave it out
  }

  // ---- CAMS / KFintech ----------------------------------------------------
  var TXN_RE = new RegExp(
    "^(\\d{1,2}[-/][A-Za-z]{3}[-/]\\d{2,4}|\\d{1,2}[-/]\\d{1,2}[-/]\\d{2,4})\\s+" +
    "(.+?)\\s+(" + NUM + ")\\s+(" + NUM + ")\\s+(" + NUM + ")\\s+(" + NUM + ")\\s*$");

  function parseCams(lines) {
    var out = [], cur = null, amc = "", folio = "", prev = "";

    function flush() {
      if (cur && (cur.txns.length || cur.units)) out.push(cur);
      cur = null;
    }

    lines.forEach(function (line) {
      var l = line.replace(/\s+/g, " ").trim();
      if (!l) return;

      var f = /folio\s*(?:no|number)?\s*[:.]?\s*([A-Z0-9]+\s*\/?\s*[A-Z0-9]*)/i.exec(l);
      if (f && /folio/i.test(l)) folio = f[1].replace(/\s+/g, "");

      if (/mutual fund$/i.test(l) && l.length < 60) amc = l;

      // A scheme header carries an ISIN; everything after it belongs to it.
      var isin = ISIN_RE.exec(l);
      if (isin && !TXN_RE.test(l)) {
        flush();
        var name = l.replace(ISIN_RE, "")
          .replace(/isin\s*[:.]?/i, "")
          .replace(/registrar\s*[:.]?\s*\w+/i, "")
          .replace(/\(advisor\s*[:.].*?\)/i, "")
          .replace(/^[\d\w]{3,10}\s*[-–]\s*/, "")   // KFintech scheme code prefix
          .replace(/\s{2,}/g, " ").trim();
        // Some statements put the ISIN on a line of its own, under the scheme
        // name; borrow the line above when nothing else is left.
        if (name.length < 6 && prev && !ISIN_RE.test(prev)) name = prev;
        cur = {
          kind: isin[1].slice(0, 3) === "INE" ? "stock" : "mf",
          name: name || isin[1], isin: isin[1], folio: folio, amc: amc,
          txns: [], units: 0, price: 0, value: 0, source: "cams",
        };
        prev = l;
        return;
      }

      prev = l;
      if (!cur) return;

      var t = TXN_RE.exec(l);
      if (t) {
        var type = classify(t[2]);
        if (!type) return;
        var units = Math.abs(num(t[4])), amount = Math.abs(num(t[3])), nav = num(t[5]);
        if (type !== "income" && !units) return;
        // A bracketed/negative unit column is a redemption even when the
        // wording did not say so.
        if (num(t[4]) < 0 && type === "buy") type = "sell";
        cur.txns.push({
          date: date(t[1]), type: type, units: units, amount: amount,
          nav: nav || (units ? amount / units : 0), desc: t[2].trim(),
        });
        return;
      }

      var cb = /closing\s*unit\s*balance\s*[:.]?\s*([\d,]+\.?\d*)/i.exec(l);
      if (cb) cur.units = num(cb[1]);
      var nv = /nav\s*on\s*[\d\-A-Za-z/]+\s*[:.]?\s*(?:INR|Rs\.?)?\s*([\d,]+\.?\d*)/i.exec(l);
      if (nv) cur.price = num(nv[1]);
      var mv = /market\s*value\s*on\s*[\d\-A-Za-z/]+\s*[:.]?\s*(?:INR|Rs\.?)?\s*([\d,]+\.?\d*)/i.exec(l);
      if (mv) cur.value = num(mv[1]);
    });

    flush();
    return out;
  }

  // ---- NSDL / CDSL demat holdings ----------------------------------------
  // Rows are a snapshot: ISIN, name, quantity and usually a market price.
  // There is no cost basis in the statement, so those rows come back flagged
  // needsCost and the review screen asks for an average buy price.
  function parseDemat(lines) {
    var out = [];
    lines.forEach(function (line) {
      var l = line.replace(/\s+/g, " ").trim();
      var isin = ISIN_RE.exec(l);
      if (!isin) return;
      if (/closing|opening|nav on|market value on|isin\s*[:.]|registrar/i.test(l)) return;

      var rest = l.replace(isin[1], " ");
      var nums = rest.match(/-?[\d,]+\.?\d*/g) || [];
      nums = nums.map(num).filter(function (n) { return n !== 0; });
      if (nums.length < 2) return;                 // a name and one number is not a row

      var name = rest.replace(/-?[\d,]+\.?\d*/g, " ").replace(/\s{2,}/g, " ").trim();
      name = name.replace(/^[-–|]+|[-–|]+$/g, "").trim();
      if (name.length < 3) return;

      var qty = nums[0];
      var value = nums[nums.length - 1];
      var price = nums.length >= 3 ? nums[nums.length - 2] : (qty ? value / qty : 0);
      if (!(qty > 0)) return;

      out.push({
        kind: isin[1].slice(0, 3) === "INE" ? "stock" : "mf",
        name: name, isin: isin[1], folio: "", amc: "",
        txns: [], units: qty, price: price, value: value,
        needsCost: true, source: "demat",
      });
    });
    return out;
  }

  // ---- entry point --------------------------------------------------------
  function parseLines(lines) {
    var text = lines.join("\n");
    var cams = parseCams(lines);
    var demat = parseDemat(lines);

    // A CAMS scheme block always beats the same ISIN scraped off a holdings
    // table: it carries the transactions, and so the real cost basis.
    var seen = {};
    cams.forEach(function (c) { if (c.isin) seen[c.isin + "|" + c.folio] = true; });
    demat = demat.filter(function (d) { return !seen[d.isin + "|"] && !cams.some(function (c) { return c.isin === d.isin; }); });

    var items = cams.concat(demat);
    var formats = [];
    if (cams.length) formats.push("CAMS/KFintech MF CAS");
    if (demat.length) formats.push("NSDL/CDSL demat CAS");

    var period = /statement\s*(?:for\s*the\s*)?period\s*[:.]?\s*([\d\-A-Za-z/]+)\s*(?:to|-)\s*([\d\-A-Za-z/]+)/i.exec(text);
    var asOf = /as\s*on\s*[:.]?\s*(\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4})/i.exec(text);

    return {
      formats: formats,
      items: items,
      period: period ? { from: date(period[1]), to: date(period[2]) } : null,
      asOf: asOf ? date(asOf[1]) : (period ? date(period[2]) : ""),
      txnCount: items.reduce(function (s, i) { return s + i.txns.length; }, 0),
      lines: lines.length,
    };
  }

  // ---- PDF -> lines (browser only) ---------------------------------------
  // Same reconstruction the label tools use: bucket text items by their y
  // position, then read each bucket left to right.
  function linesFromTextContent(tc) {
    var rows = {};
    tc.items.forEach(function (it) {
      var s = (it.str || "").trim();
      if (!s) return;
      var y = Math.round(it.transform[5]);
      (rows[y] = rows[y] || []).push({ x: it.transform[4], s: s });
    });
    return Object.keys(rows).sort(function (a, b) { return b - a; }).map(function (y) {
      return rows[y].sort(function (a, b) { return a.x - b.x; })
        .map(function (o) { return o.s; }).join(" ").trim();
    }).filter(Boolean);
  }

  // Resolves to {lines, pages}; rejects with err.needsPassword when the CAS is
  // the usual password-protected email attachment.
  function extractText(file, password) {
    if (!root.pdfjsLib) return Promise.reject(new Error("PDF reader failed to load."));
    return file.arrayBuffer().then(function (buf) {
      var task = root.pdfjsLib.getDocument({ data: buf, password: password || undefined });
      return task.promise.then(function (pdf) {
        var lines = [], chain = Promise.resolve();
        for (var p = 1; p <= pdf.numPages; p++) {
          (function (n) {
            chain = chain.then(function () {
              return pdf.getPage(n).then(function (page) {
                return page.getTextContent().then(function (tc) {
                  lines = lines.concat(linesFromTextContent(tc));
                });
              });
            });
          })(p);
        }
        return chain.then(function () { return { lines: lines, pages: pdf.numPages }; });
      }, function (err) {
        var e = new Error(err && err.message || "Could not read this PDF.");
        var name = err && (err.name || err.constructor && err.constructor.name);
        if (name === "PasswordException" || /password/i.test(e.message)) e.needsPassword = true;
        throw e;
      });
    });
  }

  var API = {
    parseLines: parseLines, parseCams: parseCams, parseDemat: parseDemat,
    extractText: extractText, linesFromTextContent: linesFromTextContent,
    num: num, date: date, classify: classify,
  };
  root.PFCas = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
