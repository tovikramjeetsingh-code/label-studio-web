// Portfolio UI — tabs, tables, the CAS import review, and the price refresh.
(function () {
  "use strict";

  var store = window.PFStore, calc = window.PFCalc, cas = window.PFCas, prices = window.PFPrices;
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "../vendor/pdf.worker.min.js";

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  var nfMoney = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  var nfWhole = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
  var nfUnits = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

  function money(n) { return "₹" + nfMoney.format(Number(n) || 0); }
  function whole(n) { return "₹" + nfWhole.format(Number(n) || 0); }
  function units(n) { return nfUnits.format(Number(n) || 0); }
  function pct(n) { return (Number(n) || 0).toFixed(2) + "%"; }
  function signCls(n) { return n > 0.005 ? "up" : n < -0.005 ? "down" : ""; }
  function signed(n, f) {
    var v = Number(n) || 0;
    if (Math.abs(v) < 0.005) v = 0;                 // never render "-0.00"

    return '<span class="' + signCls(v) + '">' + (v > 0 ? "+" : "") + (f || money)(v) + "</span>";
  }
  function dateStr(d) { return d || "—"; }

  var tab = "overview";
  var priceStatusText = "";

  // ---- notices ------------------------------------------------------------
  var noticeTimer;
  function notice(kind, msg) {
    var n = $("notice");
    n.className = "notice " + kind;
    n.innerHTML = esc(msg);
    clearTimeout(noticeTimer);
    if (kind !== "error") noticeTimer = setTimeout(function () { n.className = "notice hidden"; }, 6000);
  }
  store.onNotice = notice;

  // ---- current numbers ----------------------------------------------------
  function view() {
    var s = store.get();
    return calc.rollup(s.holdings, s.txns, function (h) { return store.priceOf(h); });
  }

  // ================= OVERVIEW =================
  function renderOverview(v) {
    var t = v.totals;
    var kpis = [
      { k: "Current value", v: money(t.value), sub: v.open.length + " open holdings" },
      { k: "Invested", v: money(t.invested), sub: "cost of what you still hold" },
      { k: "Unrealised P&L", v: signed(t.unrealized), sub: signed(t.unrealizedPct, pct) + " on cost", raw: t.unrealized },
      { k: "XIRR", v: t.xirr == null ? "—" : signed(t.xirr * 100, pct), sub: "money-weighted, all flows" },
      { k: "Day change", v: t.dayChange ? signed(t.dayChange) : "—", sub: "vs previous close" },
      { k: "Realised + income", v: money(t.realized + t.income), sub: money(t.realized) + " booked · " + money(t.income) + " payouts" },
    ];
    $("kpis").innerHTML = kpis.map(function (c) {
      return '<div class="kpi"><div class="k">' + c.k + '</div><div class="v">' + c.v +
             '</div><div class="s">' + c.sub + "</div></div>";
    }).join("");

    if (t.unpriced) {
      notice("warn", t.unpriced + " holding(s) have no price yet — refresh prices, or set one by hand on the Holdings tab.");
    }

    renderChart();
    $("allocation").innerHTML = v.allocation.length ? v.allocation.map(function (a) {
      return '<div class="bar-row"><div class="bar-label">' + esc(a.label) +
        '<b>' + money(a.value) + " · " + pct(a.pct) + "</b></div>" +
        '<div class="bar"><span style="width:' + Math.max(1, a.pct).toFixed(1) + '%"></span></div></div>';
    }).join("") : '<p class="empty">Nothing valued yet.</p>';

    var byPnl = v.open.slice().sort(function (a, b) { return b.unrealized - a.unrealized; });
    var best = byPnl[0], worst = byPnl[byPnl.length - 1];
    $("movers").innerHTML = (best && worst && best !== worst)
      ? ['<div class="mover"><span>Best</span><b>' + esc(best.holding.name) + "</b>" + signed(best.unrealized) + "</div>",
         '<div class="mover"><span>Worst</span><b>' + esc(worst.holding.name) + "</b>" + signed(worst.unrealized) + "</div>"].join("")
      : '<p class="empty">Two or more priced holdings needed.</p>';
  }

  // A plain SVG line chart of the daily snapshots: value against cost.
  function renderChart() {
    var snaps = store.get().snapshots;
    var box = $("chart");
    if (snaps.length < 2) {
      box.innerHTML = '<p class="empty">' + (snaps.length ? "One day recorded so far — the line starts once there are two."
        : "No days recorded yet. Refresh prices to record today.") + "</p>";
      return;
    }
    var W = 720, H = 220, P = { l: 58, r: 12, t: 12, b: 24 };
    var vals = snaps.map(function (s) { return s.value; }).concat(snaps.map(function (s) { return s.invested; }));
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { hi = lo * 1.05 + 1; lo = lo * 0.95; }
    var padY = (hi - lo) * 0.08; lo -= padY; hi += padY;   // keep lines off the frame
    var x = function (i) { return P.l + i * (W - P.l - P.r) / Math.max(1, snaps.length - 1); };
    var y = function (v) { return P.t + (hi - v) * (H - P.t - P.b) / (hi - lo); };
    var path = function (key) {
      return snaps.map(function (s, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(s[key]).toFixed(1); }).join(" ");
    };
    var ticks = [lo, (lo + hi) / 2, hi].map(function (v) {
      return '<g><line class="gl" x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) +
        '"/><text class="tk" x="' + (P.l - 8) + '" y="' + (y(v) + 4).toFixed(1) + '">' + nfWhole.format(v) + "</text></g>";
    }).join("");
    var last = snaps[snaps.length - 1];

    box.innerHTML =
      '<svg viewBox="0 0 ' + W + " " + H + '" class="chart" preserveAspectRatio="none" role="img" ' +
      'aria-label="Portfolio value over time">' + ticks +
      '<path class="ln invested" d="' + path("invested") + '"/>' +
      '<path class="ln value" d="' + path("value") + '"/>' +
      "</svg>" +
      '<div class="legend"><i class="value"></i> Value ' + money(last.value) +
      ' <i class="invested"></i> Invested ' + money(last.invested) +
      "<em>" + snaps[0].date + " → " + last.date + " · " + snaps.length + " days</em></div>";
  }

  // ================= HOLDINGS =================
  var openRow = null;

  function renderHoldings(v) {
    $("holdCount").textContent = v.open.length + " open" + (v.closed.length ? " · " + v.closed.length + " closed" : "");
    var rows = v.rows.slice().sort(function (a, b) { return b.value - a.value || (a.holding.name > b.holding.name ? 1 : -1); });
    if (!rows.length) {
      $("holdTable").innerHTML = '<tr><td class="empty">Nothing here yet — import a CAS, or add a holding below.</td></tr>';
      return;
    }
    var head = "<thead><tr><th>Holding</th><th class='n'>Units</th><th class='n'>Avg cost</th>" +
      "<th class='n'>Price</th><th class='n'>Invested</th><th class='n'>Value</th>" +
      "<th class='n'>P&L</th><th class='n'>XIRR</th></tr></thead>";
    $("holdTable").innerHTML = head + "<tbody>" + rows.map(function (r) {
      var h = r.holding, closed = r.units <= 1e-6;
      var price = r.price || {};
      var main = '<tr class="hrow' + (closed ? " closed" : "") + '" data-id="' + h.id + '">' +
        "<td><b>" + esc(h.name) + "</b>" +
        '<div class="meta">' + esc(h.kind === "stock" ? (h.symbol || h.isin || "Stock") : (h.amc || "Mutual fund")) +
        (h.folio ? " · folio " + esc(h.folio) : "") + (closed ? " · exited" : "") + "</div></td>" +
        "<td class='n'>" + units(r.units) + "</td>" +
        "<td class='n'>" + (r.avgCost ? money(r.avgCost) : "—") + "</td>" +
        "<td class='n'>" + (price.value ? money(price.value) + '<div class="meta">' + esc(price.source || "") + " " + dateStr(price.date) + "</div>" : '<span class="warn-tag">no price</span>') + "</td>" +
        "<td class='n'>" + money(r.invested) + "</td>" +
        "<td class='n'>" + money(r.value) + "</td>" +
        "<td class='n'>" + signed(r.unrealized) + '<div class="meta">' + signed(r.unrealizedPct, pct) + "</div></td>" +
        "<td class='n'>" + (r.xirr == null ? "—" : signed(r.xirr * 100, pct)) + "</td></tr>";
      return main + (openRow === h.id ? detailRow(r) : "");
    }).join("") + "</tbody>";
  }

  function detailRow(r) {
    var h = r.holding, price = r.price || {};
    var tx = r.txns.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return '<tr class="detail"><td colspan="8"><div class="detail-wrap">' +
      '<div class="detail-actions">' +
        '<label>Price ₹<input class="mini" id="mp_' + h.id + '" type="number" step="any" value="' + (price.value || "") + '"></label>' +
        '<label class="inline"><input type="checkbox" id="pin_' + h.id + '"' + (price.pinned ? " checked" : "") + '> keep it (do not auto-update)</label>' +
        '<button class="btn small" data-act="setprice" data-id="' + h.id + '">Save price</button>' +
        (h.kind === "mf"
          ? '<button class="btn small ghost" data-act="link" data-id="' + h.id + '">' + (h.schemeCode ? "Re-link scheme (" + esc(h.schemeCode) + ")" : "Link NAV scheme") + "</button>"
          : '<label>Symbol<input class="mini" id="sym_' + h.id + '" value="' + esc(h.symbol || "") + '" placeholder="RELIANCE"></label>' +
            '<button class="btn small" data-act="setsym" data-id="' + h.id + '">Save symbol</button>') +
        '<button class="btn small danger" data-act="del" data-id="' + h.id + '">Delete holding</button>' +
      "</div>" +
      '<div class="link-box hidden" id="link_' + h.id + '"></div>' +
      (tx.length
        ? '<table class="grid sub-grid"><thead><tr><th>Date</th><th>Type</th><th class="n">Units</th><th class="n">Amount</th><th class="n">NAV</th><th>Note</th><th></th></tr></thead><tbody>' +
          tx.map(function (t) {
            return "<tr><td>" + esc(t.date) + '</td><td><span class="tag ' + t.type + '">' + t.type + "</span></td>" +
              "<td class='n'>" + units(t.units) + "</td><td class='n'>" + money(t.amount) + "</td>" +
              "<td class='n'>" + (t.nav ? money(t.nav) : "—") + "</td><td>" + esc(t.desc || t.src || "") + "</td>" +
              '<td><button class="link-btn" data-act="deltxn" data-id="' + t.id + '">remove</button></td></tr>';
          }).join("") + "</tbody></table>"
        : '<p class="empty">No transactions recorded for this holding.</p>') +
      (r.realized || r.income
        ? '<p class="sub">Booked: ' + signed(r.realized) + " realised · " + money(r.income) + " in payouts.</p>" : "") +
      "</div></td></tr>";
  }

  // ================= TRANSACTIONS =================
  function renderTxns(v) {
    var s = store.get();
    var sel = $("txnHolding"), filter = $("txnFilter");
    var opts = s.holdings.slice().sort(function (a, b) { return a.name > b.name ? 1 : -1; })
      .map(function (h) { return '<option value="' + h.id + '">' + esc(h.name) + (h.folio ? " · " + esc(h.folio) : "") + "</option>"; }).join("");
    var keepSel = sel.value, keepFilter = filter.value;
    sel.innerHTML = opts || '<option value="">Add a holding first</option>';
    filter.innerHTML = '<option value="">Everything</option>' + opts;
    sel.value = keepSel || sel.value;
    filter.value = keepFilter;

    var list = s.txns.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    if (keepFilter) list = list.filter(function (t) { return t.holdingId === keepFilter; });
    $("txnCount").textContent = list.length + " shown";
    var names = {};
    s.holdings.forEach(function (h) { names[h.id] = h.name; });

    $("txnTable").innerHTML = list.length
      ? "<thead><tr><th>Date</th><th>Holding</th><th>Type</th><th class='n'>Units</th><th class='n'>Amount</th><th class='n'>NAV</th><th>Note</th><th></th></tr></thead><tbody>" +
        list.map(function (t) {
          return "<tr><td>" + esc(t.date) + "</td><td>" + esc(names[t.holdingId] || "—") + "</td>" +
            '<td><span class="tag ' + t.type + '">' + t.type + "</span></td>" +
            "<td class='n'>" + units(t.units) + "</td><td class='n'>" + money(t.amount) + "</td>" +
            "<td class='n'>" + (t.nav ? money(t.nav) : "—") + "</td><td>" + esc(t.desc || t.src || "") + "</td>" +
            '<td><button class="link-btn" data-act="deltxn" data-id="' + t.id + '">remove</button></td></tr>';
        }).join("") + "</tbody>"
      : '<tr><td class="empty">No transactions yet.</td></tr>';
  }

  // ================= BACKUP =================
  function renderBackup() {
    var s = store.get();
    $("autoPrices").checked = !!s.settings.autoPrices;
    var bytes = 0;
    try { bytes = (localStorage.getItem("pf.portfolio.v1") || "").length; } catch (e) {}
    $("storageInfo").innerHTML = s.holdings.length + " holdings · " + s.txns.length + " transactions · " +
      s.snapshots.length + " daily snapshots · " + (bytes / 1024).toFixed(1) + " KB stored in this browser.";
    $("priceStatus").innerHTML = esc(priceStatusText || "Prices have not been refreshed in this session yet.");
  }

  // ================= render dispatch =================
  function render() {
    var v = view();
    ["overview", "holdings", "txns", "import", "backup"].forEach(function (t) {
      $("tab-" + t).classList.toggle("hidden", t !== tab);
    });
    Array.prototype.forEach.call($("tabs").querySelectorAll(".modebtn"), function (b) {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    if (tab === "overview") renderOverview(v);
    if (tab === "holdings") renderHoldings(v);
    if (tab === "txns") renderTxns(v);
    if (tab === "backup") renderBackup();
    return v;
  }

  // ================= prices =================
  function refreshPrices() {
    var s = store.get();
    if (!s.holdings.length) { notice("warn", "Nothing to price yet — import a CAS first."); return; }
    var btn = $("refreshBtn");
    btn.disabled = true;
    btn.textContent = "↻ Refreshing…";
    return prices.refreshAll(store, function (done, total, name) {
      btn.textContent = "↻ " + done + "/" + total + " " + (name || "").slice(0, 22);
    }).then(function (res) {
      btn.disabled = false;
      btn.textContent = "↻ Refresh prices";
      var v = view();
      if (v.totals.value > 0) store.snapshot(v.totals.value, v.totals.invested);
      priceStatusText = res.updated + " updated" + (res.manual ? ", " + res.manual + " kept manual" : "") +
        (res.failed.length ? ", " + res.failed.length + " failed: " + res.failed.map(function (f) { return f.name + " (" + f.reason + ")"; }).join("; ") : "") +
        " · " + new Date().toLocaleString("en-IN");
      notice(res.failed.length ? "warn" : "ok", priceStatusText);
      render();
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = "↻ Refresh prices";
      notice("error", "Price refresh failed: " + (e && e.message || e));
    });
  }

  // ================= CAS import =================
  var pending = null;      // {file, lines, parsed, rows}
  var OPENING = "Opening holding from CAS";

  function readFile(file, password) {
    $("importStatus").innerHTML = '<p class="sub">Reading ' + esc(file.name) + "…</p>";
    $("fileInput").value = "";                      // let the same file be picked again
    cas.extractText(file, password).then(function (out) {
      $("pwRow").classList.add("hidden");
      var parsed = cas.parseLines(out.lines);
      pending = { file: file, lines: out.lines, parsed: parsed, rows: buildRows(parsed) };
      $("importStatus").innerHTML = '<p class="sub">' + out.pages + " pages · " + out.lines.length + " lines · " +
        (parsed.formats.length ? esc(parsed.formats.join(" + ")) : "no known CAS layout matched") +
        (parsed.asOf ? " · as on " + esc(parsed.asOf) : "") + "</p>";
      if (!parsed.items.length) {
        notice("warn", "No holdings could be read from this PDF. Open “Show extracted text” to see what came out — the layout may need a tweak.");
        $("reviewCard").classList.remove("hidden");
        $("rawText").textContent = out.lines.join("\n");
        $("rawText").classList.remove("hidden");
      }
      renderReview();
    }).catch(function (err) {
      if (err && err.needsPassword) {
        $("pwRow").classList.remove("hidden");
        $("pwInput").focus();
        $("importStatus").innerHTML = '<p class="sub">This CAS is password protected — enter the password it was sent with.</p>';
        pending = { file: file };
        return;
      }
      notice("error", "Could not read that PDF: " + (err && err.message || err));
      $("importStatus").innerHTML = "";
    });
  }

  function buildRows(parsed) {
    return parsed.items.map(function (it, i) {
      var existing = store.findHolding(it);
      var have = existing ? store.txnsFor(existing.id) : [];
      var seeded = have.some(function (t) { return t.desc === OPENING; });
      var held = calc.position(have).units;
      return {
        i: i, item: it,
        // A demat snapshot already seeded once must not seed again — that is
        // how a re-import silently doubles a stock holding.
        use: !(it.needsCost && seeded),
        cost: it.needsCost ? "" : null,
        date: parsed.asOf || new Date().toISOString().slice(0, 10),
        existing: existing, existingTxns: have.length,
        seeded: seeded, held: held,
        drift: it.needsCost && seeded ? (it.units - held) : 0,
      };
    });
  }

  function statusCell(r) {
    if (!r.existing) return '<span class="ok-tag">new</span>';
    if (r.seeded) {
      if (Math.abs(r.drift) > 1e-6) {
        return '<span class="warn-tag">already imported</span><div class="meta">holds ' + units(r.held) +
          ", statement says " + units(r.item.units) + " — record the difference of " +
          units(Math.abs(r.drift)) + (r.drift > 0 ? " as a buy" : " as a sell") + "</div>";
      }
      return '<span class="warn-tag">already imported</span><div class="meta">quantity matches</div>';
    }
    return '<span class="warn-tag">already held</span>' +
      (r.existingTxns ? '<div class="meta">' + r.existingTxns + " transactions on record; duplicates are skipped</div>" : "");
  }

  function renderReview() {
    if (!pending || !pending.rows) return;
    var rows = pending.rows;
    $("reviewCard").classList.remove("hidden");
    $("reviewCount").textContent = rows.length + " found · " + pending.parsed.txnCount + " transactions";
    $("reviewTable").innerHTML =
      "<thead><tr><th></th><th>Name</th><th>Type</th><th class='n'>Units</th>" +
      "<th class='n'>Transactions</th><th class='n'>Statement price</th><th>Cost basis</th><th>Status</th></tr></thead><tbody>" +
      rows.map(function (r) {
        var it = r.item;
        return '<tr><td><input type="checkbox" data-rev="use" data-i="' + r.i + '"' + (r.use ? " checked" : "") + "></td>" +
          '<td><input class="wide" data-rev="name" data-i="' + r.i + '" value="' + esc(it.name) + '">' +
          '<div class="meta">' + esc(it.isin || "") + (it.folio ? " · folio " + esc(it.folio) : "") + "</div></td>" +
          "<td>" + (it.kind === "stock" ? "Stock" : "MF") + "</td>" +
          "<td class='n'>" + units(it.units || calc.position(it.txns).units) + "</td>" +
          "<td class='n'>" + (it.txns.length || "—") + "</td>" +
          "<td class='n'>" + (it.price ? money(it.price) : "—") + "</td>" +
          "<td>" + (it.needsCost
            ? '<input class="mini" type="number" step="any" placeholder="avg ₹/unit" data-rev="cost" data-i="' + r.i + '" value="' + (r.cost || "") + '">' +
              '<input class="mini" type="date" data-rev="date" data-i="' + r.i + '" value="' + esc(r.date) + '">'
            : '<span class="meta">from transactions</span>') + "</td>" +
          "<td>" + statusCell(r) + "</td></tr>";
      }).join("") + "</tbody>";
    $("rawText").textContent = pending.lines.join("\n");
  }

  function commitImport() {
    if (!pending || !pending.rows) return;
    var added = { holdings: 0, txns: 0, skipped: 0, reseeded: 0 };
    pending.rows.forEach(function (r) {
      if (!r.use) return;
      var it = r.item;
      var before = store.get().holdings.length;
      var h = store.addHolding({
        kind: it.kind, name: it.name, isin: it.isin, folio: it.folio, amc: it.amc,
        symbol: it.kind === "stock" ? (it.symbol || "") : "",
      });
      if (store.get().holdings.length > before) added.holdings++;

      var list;
      if (it.txns.length) {
        list = it.txns.map(function (t) { return Object.assign({}, t, { holdingId: h.id, src: "cas" }); });
      } else if (it.units > 0) {
        var already = store.txnsFor(h.id).some(function (t) { return t.desc === OPENING; });
        if (already) {
          // Seeding again would double the position; the review row says what
          // to record by hand if the quantity has moved since.
          list = [];
          added.reseeded++;
        } else {
          var cpu = Number(r.cost) || it.price || 0;
          list = cpu ? [{
            holdingId: h.id, date: r.date, type: "buy", units: it.units,
            amount: cpu * it.units, nav: cpu, desc: OPENING, src: "cas",
          }] : [];
        }
      } else list = [];

      var res = store.addTxns(list);
      added.txns += res.added;
      added.skipped += res.skipped;
      if (it.price) store.setPrice(h.id, { value: it.price, date: pending.parsed.asOf || r.date, source: "statement" });
    });
    store.save();
    clearReview();
    notice("ok", added.holdings + " holdings and " + added.txns + " transactions saved" +
      (added.skipped ? " · " + added.skipped + " already there, skipped" : "") +
      (added.reseeded ? " · " + added.reseeded + " snapshot holding(s) left alone so nothing doubled" : "") + ".");
    tab = "holdings";
    render();
  }

  function clearReview() {
    pending = null;
    $("reviewCard").classList.add("hidden");
    $("reviewTable").innerHTML = "";
    $("rawText").textContent = "";
    $("rawText").classList.add("hidden");
    $("importStatus").innerHTML = "";
    $("pwRow").classList.add("hidden");
    $("pwInput").value = "";
  }

  // ================= events =================
  $("tabs").addEventListener("click", function (e) {
    var b = e.target.closest(".modebtn");
    if (!b) return;
    tab = b.dataset.tab;
    render();
  });
  $("refreshBtn").addEventListener("click", refreshPrices);

  // holdings: open a row, or act on it
  $("tab-holdings").addEventListener("click", function (e) {
    var act = e.target.closest("[data-act]");
    if (act) {
      var id = act.dataset.id;
      if (act.dataset.act === "del") {
        if (confirm("Delete this holding and its transactions?")) { store.removeHolding(id); openRow = null; render(); }
      } else if (act.dataset.act === "deltxn") {
        store.removeTxn(id); render();
      } else if (act.dataset.act === "setprice") {
        var val = parseFloat($("mp_" + id).value);
        if (!(val > 0)) { notice("warn", "Enter a price above zero."); return; }
        store.setPrice(id, { value: val, date: new Date().toISOString().slice(0, 10), source: "manual", pinned: $("pin_" + id).checked });
        notice("ok", "Price saved.");
        render();
      } else if (act.dataset.act === "setsym") {
        store.updateHolding(id, { symbol: $("sym_" + id).value.trim().toUpperCase() });
        notice("ok", "Symbol saved — refresh prices to try a quote.");
        render();
      } else if (act.dataset.act === "link") {
        linkUI(id);
      }
      return;
    }
    var row = e.target.closest(".hrow");
    if (row) { openRow = openRow === row.dataset.id ? null : row.dataset.id; render(); }
  });

  function linkUI(id) {
    var h = store.get().holdings.filter(function (x) { return x.id === id; })[0];
    if (!h) return;
    var box = $("link_" + id);
    box.classList.remove("hidden");
    box.innerHTML = '<div class="sub">Searching AMFI schemes for “' + esc(h.name) + '”…</div>';
    prices.searchSchemes(h.name).then(function (list) {
      if (!list.length) { box.innerHTML = '<div class="sub">No scheme matched that name. Edit the holding name to the exact scheme name and try again.</div>'; return; }
      box.innerHTML = '<div class="sub">Pick the scheme whose NAV should be used:</div>' +
        list.map(function (s) {
          return '<button class="btn small ghost pick" data-code="' + esc(s.code) + '">' + esc(s.name) + "</button>";
        }).join("");
      box.querySelectorAll(".pick").forEach(function (b) {
        b.addEventListener("click", function () {
          store.updateHolding(id, { schemeCode: b.dataset.code });
          if (h.isin) { store.get().links[h.isin] = b.dataset.code; store.save(); }
          prices.navFor(b.dataset.code).then(function (p) {
            store.setPrice(id, p);
            notice("ok", "Linked — NAV " + money(p.value) + " on " + p.date + ".");
            render();
          }).catch(function (e) { notice("error", "Linked, but the NAV fetch failed: " + e.message); render(); });
        });
      });
    }).catch(function (e) {
      box.innerHTML = '<div class="sub">Scheme search failed (' + esc(e.message) + '). Set the price by hand instead.</div>';
    });
  }

  $("addHoldingForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = new FormData(e.target);
    var isin = String(f.get("isin") || "").trim().toUpperCase();
    var kind = f.get("kind");
    store.addHolding({
      kind: kind, name: String(f.get("name")).trim(),
      isin: /^IN[EF][A-Z0-9]{9}$/.test(isin) ? isin : "",
      symbol: kind === "stock" && !/^IN[EF]/.test(isin) ? isin : "",
      folio: String(f.get("folio") || "").trim(),
    });
    store.save();
    e.target.reset();
    notice("ok", "Holding added — record its transactions next.");
    render();
  });

  $("tab-txns").addEventListener("click", function (e) {
    var act = e.target.closest("[data-act=deltxn]");
    if (act) { store.removeTxn(act.dataset.id); render(); }
  });
  $("txnFilter").addEventListener("change", render);

  $("addTxnForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = new FormData(e.target);
    var holdingId = f.get("holdingId");
    if (!holdingId) { notice("warn", "Add a holding first."); return; }
    var u = parseFloat(f.get("units")) || 0, amt = parseFloat(f.get("amount")) || 0;
    var nav = parseFloat(f.get("nav")) || (u ? amt / u : 0);
    var type = f.get("type");
    if (type !== "income" && !u) { notice("warn", "Units are needed for a buy or a sell."); return; }
    var res = store.addTxns([{ holdingId: holdingId, date: f.get("date"), type: type, units: u, amount: amt, nav: nav, src: "manual" }]);
    notice(res.added ? "ok" : "warn", res.added ? "Transaction recorded." : "An identical transaction is already recorded.");
    e.target.reset();
    render();
  });

  // import
  var drop = $("drop"), fileInput = $("fileInput");
  drop.addEventListener("click", function () { fileInput.click(); });
  drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", function () { drop.classList.remove("drag"); });
  drop.addEventListener("drop", function (e) {
    e.preventDefault(); drop.classList.remove("drag");
    if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0], "");
  });
  fileInput.addEventListener("change", function () { if (fileInput.files[0]) readFile(fileInput.files[0], ""); });
  $("pwBtn").addEventListener("click", function () {
    if (pending && pending.file) readFile(pending.file, $("pwInput").value);
  });
  $("pwInput").addEventListener("keydown", function (e) { if (e.key === "Enter") $("pwBtn").click(); });

  $("reviewTable").addEventListener("input", function (e) {
    var t = e.target.closest("[data-rev]");
    if (!t || !pending) return;
    var r = pending.rows[+t.dataset.i];
    if (!r) return;
    if (t.dataset.rev === "use") r.use = t.checked;
    if (t.dataset.rev === "name") r.item.name = t.value;
    if (t.dataset.rev === "cost") r.cost = t.value;
    if (t.dataset.rev === "date") r.date = t.value;
  });
  $("commitBtn").addEventListener("click", commitImport);
  $("cancelImport").addEventListener("click", clearReview);
  $("rawBtn").addEventListener("click", function () { $("rawText").classList.toggle("hidden"); });

  // backup
  $("exportBtn").addEventListener("click", function () {
    var blob = new Blob([store.exportJSON()], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "portfolio-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });
  $("importJsonBtn").addEventListener("click", function () { $("jsonInput").click(); });
  $("jsonInput").addEventListener("change", function () {
    var f = $("jsonInput").files[0];
    if (!f) return;
    var mode = confirm("OK = merge into what is already here.\nCancel = replace everything with the file.") ? "merge" : "replace";
    f.text().then(function (txt) {
      try {
        var res = store.importJSON(txt, mode);
        notice("ok", "Backup " + res.mode + "d: " + res.holdings + " holdings, " + res.txns + " transactions.");
        render();
      } catch (e) { notice("error", "That file could not be read: " + e.message); }
    });
    $("jsonInput").value = "";
  });
  $("autoPrices").addEventListener("change", function () {
    store.get().settings.autoPrices = $("autoPrices").checked;
    store.save();
  });
  $("resetBtn").addEventListener("click", function () {
    if (confirm("Erase every holding, transaction and snapshot in this browser?")) {
      store.reset(); openRow = null; notice("ok", "Portfolio erased."); render();
    }
  });

  // ================= boot =================
  store.load();
  render();
  if (store.get().settings.autoPrices && store.get().holdings.length) refreshPrices();
})();
