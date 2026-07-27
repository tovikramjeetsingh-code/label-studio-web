// UI wiring — upload -> (map) -> review -> generate ZIP, all client-side.
(function () {
  const C = window.LABEL_CONFIG;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let ROWS = [];          // canonical rows ready to render
  let MAP_CTX = null;     // stash for the mapping step
  let MODE = "product";   // "product" (60x83) | "item" (50x25 dual-code)

  const ITEMCODE_KEY = "labelStudioItemCode_v1";
  const ITEMSIZE_KEY = "labelStudioItemSize_v1";
  const radioVal = (name, fallback) => {
    const el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : fallback;
  };
  function itemCodeType() { return radioVal("codeType", localStorage.getItem(ITEMCODE_KEY) || "barcode"); }
  function itemSizeKey() { return radioVal("itemSize", localStorage.getItem(ITEMSIZE_KEY) || "50x25"); }

  const buildOne = (r) => MODE === "item" ? window.ItemLabel.buildItemDoc(r, itemCodeType(), itemSizeKey())
                        : MODE === "rack" ? window.ItemLabel.buildRackDoc(r, itemCodeType())
                        : window.LabelRender.buildLabelDoc(r);
  const labelSize = () => MODE === "item" ? window.ItemLabel.sizeOf(itemSizeKey())
                        : MODE === "rack" ? { w: 25, h: 15 }
                        : { w: 60, h: 83 };

  // restore + persist the item-code type and size choices
  (function () {
    [["codeType", ITEMCODE_KEY], ["itemSize", ITEMSIZE_KEY]].forEach(([name, key]) => {
      const saved = localStorage.getItem(key);
      if (saved) { const el = document.querySelector('input[name="' + name + '"][value="' + saved + '"]'); if (el) el.checked = true; }
      document.querySelectorAll('input[name="' + name + '"]').forEach((r) =>
        r.addEventListener("change", () => { if (r.checked) localStorage.setItem(key, r.value); }));
    });
  })();

  function setMode(mode) {
    if (mode === MODE) return;
    MODE = mode;
    document.querySelectorAll(".modebtn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    $("helpProduct").classList.toggle("hidden", mode !== "product");
    $("helpItem").classList.toggle("hidden", mode !== "item");
    $("helpRack").classList.toggle("hidden", mode !== "rack");
    $("codeTypeRow").classList.toggle("hidden", mode !== "item" && mode !== "rack");
    $("itemSizeRow").classList.toggle("hidden", mode !== "item");
    $("dropHint").textContent = mode === "item" ? ".pdf" : ".csv · .xlsx";
    $("fileInput").accept = mode === "item" ? ".pdf,application/pdf" : ".csv,.xlsx,.xls,.xlsm";
    ROWS = [];
    $("mapCard").classList.add("hidden"); $("reviewCard").classList.add("hidden"); $("genCard").classList.add("hidden");
    $("uploadToast").innerHTML = "";
    refreshPrintButtons();
  }
  document.querySelectorAll(".modebtn").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

  // fixed-values panel
  $("fxDesigned").textContent = C.DESIGNED_BY;
  $("fxMfg").textContent = C.MANUFACTURED_BY;
  $("fxCountry").textContent = C.COUNTRY_OF_ORIGIN;

  // stored reference — encrypted bundle, unlocked with the shared team password
  function updateRef() {
    const meta = window.LabelParse.masterMeta();
    if (meta && meta.count) {
      $("masterInfo").innerHTML = "✅ Reference active — <b>" + meta.count.toLocaleString() +
        "</b> SKUs (updated " + esc(meta.built) + "). Missing fields are filled automatically.";
      $("refLocked").classList.add("hidden");
      $("refClear").classList.remove("hidden");
    } else if (window.LabelParse.hasEncrypted()) {
      $("masterInfo").textContent = "";
      $("refLocked").classList.remove("hidden");
      $("refClear").classList.add("hidden");
    } else {
      $("masterInfo").textContent = "No reference is bundled with this site yet.";
      $("refLocked").classList.add("hidden");
      $("refClear").classList.add("hidden");
    }
  }
  async function doUnlock() {
    const pass = $("refPass").value;
    if (!pass) return;
    $("masterInfo").textContent = "Unlocking…";
    try {
      await window.LabelParse.unlockReference(pass);
      $("refPass").value = "";
      updateRef();
    } catch (e) {
      $("masterInfo").innerHTML = '<span style="color:var(--err)">✕ ' + esc(e.message) + "</span>";
      $("refLocked").classList.remove("hidden");
    }
  }
  (async () => { await window.LabelParse.tryAutoUnlock(); updateRef(); })();
  $("refUnlock").addEventListener("click", doUnlock);
  $("refPass").addEventListener("keydown", (e) => { if (e.key === "Enter") doUnlock(); });
  $("refClear").addEventListener("click", () => { window.LabelParse.forgetPassword(); updateRef(); });

  // ---- direct printing (QZ Tray) ----
  const LP = window.LabelPrint;
  function selectedPrinter() { return $("qzPrinter").value || LP.savedPrinter(); }
  function copies() { return Math.max(1, parseInt($("qzCopies").value, 10) || 1); }

  function printConnected() { return LP.isConnected(); }
  function refreshPrintButtons() {
    const ready = printConnected() && ROWS.length > 0;
    $("printAllBtn").disabled = !ready;
    $("printAllBtn").title = printConnected() ? "" : "Connect a printer above first";
    updateCopiesUI();
  }
  // Global Copies applies to item/rack; product uses the per-row Copies column.
  function updateCopiesUI() { $("qzCopiesWrap").classList.toggle("hidden", !(printConnected() && MODE !== "product")); }

  async function populatePrinters() {
    const printers = await LP.listPrinters();
    const def = (await LP.defaultPrinter()) || "";
    const want = LP.savedPrinter() || def;
    const sel = $("qzPrinter");
    sel.innerHTML = printers.map((p) => '<option value="' + esc(p) + '"' + (p === want ? " selected" : "") + ">" + esc(p) + "</option>").join("");
    if (!printers.length) { $("qzInfo").innerHTML = '<span style="color:var(--warn)">Connected, but no printers found on this machine.</span>'; return; }
    if (!want && printers[0]) sel.value = printers[0];
    LP.savePrinter(sel.value);
    sel.classList.remove("hidden"); updateCopiesUI();
    $("qzInfo").innerHTML = "✅ Connected to QZ Tray. Printing to <b>" + esc(sel.value) + "</b>.";
  }

  async function doConnect(silent) {
    if (!LP.available()) { if (!silent) $("qzInfo").innerHTML = '<span style="color:var(--err)">Print library failed to load.</span>'; return; }
    if (!silent) $("qzInfo").textContent = "Connecting to QZ Tray…";
    try {
      await LP.connect();
      await populatePrinters();
      refreshPrintButtons();
    } catch (e) {
      if (!silent) $("qzInfo").innerHTML = '<span style="color:var(--err)">✕ QZ Tray not detected. Install &amp; run it from ' +
        '<a href="https://qz.io/download/" target="_blank" rel="noopener">qz.io/download</a>, then click Connect again.</span>';
      refreshPrintButtons();
    }
  }
  $("qzConnect").addEventListener("click", () => doConnect(false));
  $("qzPrinter").addEventListener("change", () => {
    LP.savePrinter($("qzPrinter").value);
    $("qzInfo").innerHTML = "✅ Connected. Printing to <b>" + esc($("qzPrinter").value) + "</b>.";
  });
  doConnect(true);   // soft auto-connect if QZ is already running + remembered

  // alignment nudge (mm) — persisted, applied to raw TSPL
  const OFFSET_KEY = "labelStudioOffset_v1";
  function applyOffset() {
    const x = parseFloat($("offX").value) || 0, y = parseFloat($("offY").value) || 0;
    window.TSCLabel.setOffset(x, y);
    try { localStorage.setItem(OFFSET_KEY, JSON.stringify({ x, y })); } catch (e) {}
  }
  (function () {
    try { const o = JSON.parse(localStorage.getItem(OFFSET_KEY) || "null"); if (o) { $("offX").value = o.x; $("offY").value = o.y; } } catch (e) {}
    applyOffset();
    ["offX", "offY"].forEach((id) => $(id).addEventListener("change", applyOffset));
  })();

  // Rasterize a jsPDF doc to a 203-dpi canvas (via PDF.js) for BITMAP TSPL.
  async function docToCanvas(doc, widthMm) {
    const pdf = await pdfjsLib.getDocument({ data: doc.output("arraybuffer") }).promise;
    const page = await pdf.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const dotsW = Math.round(widthMm * 203 / 25.4);
    const vp = page.getViewport({ scale: dotsW / vp1.width });
    const cv = document.createElement("canvas");
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: cx, viewport: vp }).promise;
    return cv;
  }

  // per-label copy count (product uses the file's Quantity / the editable column)
  const rowQty = (r) => Math.max(1, parseInt(r._qty, 10) || 1);

  // Render rows to bitmaps and send as raw TSPL, chunked with progress.
  // Each label prints its own copy count (rowQty).
  async function printBitmaps(rows, buildDoc, sizeMm, gapMm) {
    const CHUNK = 20;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const canvases = [];
      for (const r of slice) canvases.push(await docToCanvas(buildDoc(r), sizeMm.w));
      const copiesArr = slice.map(rowQty);
      await LP.printRawBytes(window.TSCLabel.buildBitmapTSPL(canvases, sizeMm, copiesArr, gapMm), selectedPrinter());
      const done = Math.min(i + CHUNK, rows.length);
      $("genMsg").textContent = "Sent " + done + " / " + rows.length + " labels (×copies) to the printer…";
    }
  }

  // 4-up 25x15: render each label, composite rows, BITMAP TSPL, chunked with progress.
  async function print4up(rows, buildDoc) {
    const CHUNK = 20;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const canvases = [];
      for (const r of rows.slice(i, i + CHUNK)) canvases.push(await docToCanvas(buildDoc(r), 25));
      await LP.printRawBytes(window.TSCLabel.buildMultiUpBitmapTSPL(canvases, "25x15", copies()), selectedPrinter());
      $("genMsg").textContent = "Sent " + Math.min(i + CHUNK, rows.length) + " / " + rows.length + " to the printer…";
    }
  }

  // Every label type prints by talking straight to the printer (raw TSPL).
  async function sendPrint(rows) {
    applyOffset();   // use the latest alignment nudge
    if (MODE === "rack") {
      const ct = itemCodeType();
      await print4up(rows, (r) => window.ItemLabel.buildRackDoc(r, ct));
      return;
    }
    if (MODE === "item") {
      if (itemSizeKey() === "50x25") {
        await LP.printRaw(window.TSCLabel.buildItemTSPL(rows, itemCodeType(), copies()), selectedPrinter());  // native 2-up
      } else {
        const ct = itemCodeType();
        await print4up(rows, (r) => window.ItemLabel.buildItemDoc(r, ct, "25x15"));
      }
      return;
    }
    // product 60x83 — single-up bitmap TSPL
    await printBitmaps(rows, (r) => window.LabelRender.buildLabelDoc(r), { w: 60, h: 83 }, window.TSCLabel.prod.gap);
  }

  async function printRow(i) {
    if (!printConnected()) { $("qzInfo").innerHTML = '<span style="color:var(--warn)">Click “Connect printer” above first.</span>'; $("printCard").scrollIntoView({behavior:"smooth"}); return; }
    try { await sendPrint([ROWS[i]]); }
    catch (e) { $("genMsg").innerHTML = '<span style="color:var(--err)">Print failed: ' + esc(e.message || e) + "</span>"; }
  }

  $("printAllBtn").addEventListener("click", async () => {
    if (!printConnected()) return;
    $("printAllBtn").disabled = true; $("genMsg").textContent = "Sending " + ROWS.length + " labels to the printer…";
    try {
      await sendPrint(ROWS);
      $("genMsg").innerHTML = "✅ Sent " + ROWS.length + " labels to <b>" + esc(selectedPrinter()) + "</b>.";
    } catch (e) {
      $("genMsg").innerHTML = '<span style="color:var(--err)">Print failed: ' + esc(e.message || e) + "</span>";
    }
    $("printAllBtn").disabled = false;
  });

  // ---- upload ----
  const drop = $("drop"), fileInput = $("fileInput");
  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault(); drop.classList.remove("drag");
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", () => { if (fileInput.files.length) handleFile(fileInput.files[0]); });

  function resetDrop() { drop.querySelector(".big").textContent = "Drop file here or click to browse"; fileInput.value = ""; }
  function uploadErr(e) {
    resetDrop();
    $("uploadToast").innerHTML = '<div class="toast err">✕ ' + esc(e.message) + "</div>";
    $("mapCard").classList.add("hidden"); $("reviewCard").classList.add("hidden"); $("genCard").classList.add("hidden");
  }

  async function handleFile(file) {
    $("uploadToast").innerHTML = "";
    drop.querySelector(".big").textContent = 'Reading "' + file.name + '"…';
    window._lastFile = file.name;

    if (MODE === "item") {
      let items;
      try { items = await window.ItemLabel.parsePDF(file); }
      catch (e) { uploadErr(e); return; }
      resetDrop();
      ROWS = items;
      renderReview(file.name, items.length + " item codes", [], 0);
      return;
    }

    if (MODE === "rack") {
      let res;
      try { res = await window.LabelParse.parseRack(file); }
      catch (e) { uploadErr(e); return; }
      resetDrop();
      ROWS = res.rows;
      renderReview(file.name, "Rack", [], 0);
      return;
    }

    let res;
    try { res = await window.LabelParse.parseUpload(file); }
    catch (e) { uploadErr(e); return; }
    resetDrop();
    if (res.needsMapping) { renderMapping(file.name, res); return; }
    $("mapCard").classList.add("hidden");
    ROWS = res.rows;
    renderReview(file.name, res.format, res.problems, res.enriched);
  }

  // ---- mapping step ----
  function renderMapping(filename, data) {
    MAP_CTX = data;
    $("reviewCard").classList.add("hidden"); $("genCard").classList.add("hidden");
    $("mapToast").innerHTML = ""; $("mapBadge").textContent = filename;
    const grid = $("mapGrid"); grid.innerHTML = "";
    C.MAPPABLE_FIELDS.forEach((f) => {
      const rowEl = document.createElement("div"); rowEl.className = "map-row";
      const opts = [];
      if (!f.required) opts.push('<option value="__current__">Auto — current month (' + esc(data.currentMonth) + ")</option>");
      else opts.push('<option value="">— choose column —</option>');
      data.columns.forEach((c) => {
        const sel = data.guess[f.field] === c ? " selected" : "";
        opts.push('<option value="' + esc(c) + '"' + sel + ">" + esc(c) + "</option>");
      });
      rowEl.innerHTML =
        '<div class="map-field">' + esc(f.label) +
          (f.required ? ' <span class="req">*</span>' : ' <span class="opt">(optional)</span>') + "</div>" +
        '<select data-field="' + esc(f.field) + '">' + opts.join("") + "</select>" +
        '<div class="map-sample"></div>';
      grid.appendChild(rowEl);
    });
    const update = (sel) => {
      const s = sel.nextElementSibling;
      if (sel.value === "__current__") s.textContent = "e.g. " + MAP_CTX.currentMonth;
      else if (sel.value) { const v = MAP_CTX.samples[sel.value] || []; s.textContent = v.length ? "e.g. " + v.join(" · ") : "(no sample values)"; }
      else s.textContent = "";
      sel.classList.toggle("unset", !sel.value);
    };
    grid.querySelectorAll("select").forEach((sel) => { update(sel); sel.addEventListener("change", () => update(sel)); });
    $("mapCard").classList.remove("hidden");
    $("mapCard").scrollIntoView({ behavior: "smooth" });
  }

  $("mapBtn").addEventListener("click", () => {
    const mapping = {}; let missing = false;
    $("mapGrid").querySelectorAll("select").forEach((sel) => { mapping[sel.dataset.field] = sel.value; if (!sel.value) missing = true; });
    if (missing) { $("mapToast").innerHTML = '<div class="toast err">✕ Choose a column for every required field.</div>'; return; }
    const res = window.LabelParse.applyMapping(MAP_CTX.rawRows, mapping);
    if (!res.rows.length) { $("mapToast").innerHTML = '<div class="toast err">✕ No data rows after mapping.</div>'; return; }
    $("mapCard").classList.add("hidden");
    ROWS = res.rows;
    renderReview(window._lastFile, res.format, res.problems, res.enriched);
  });

  // ---- review ----
  const actionCell = (i) => '<td><a class="pv" data-i="' + i + '">Preview</a> · <a class="pr" data-i="' + i + '">Print</a></td>';

  function renderReview(filename, format, problems, enriched) {
    $("reviewCard").classList.remove("hidden"); $("genCard").classList.remove("hidden");
    const kind = MODE === "item" ? "Item-code" : MODE === "rack" ? "Rack" : format;
    $("fileBadge").textContent = filename + " · " + kind + " · " + ROWS.length + " labels";

    const notes = [];
    if (enriched) notes.push('<div class="toast ok-toast">🔎 ' + enriched +
      " row(s) completed / corrected from the stored listings (size kept from your file).</div>");
    if (problems && problems.length) {
      const list = problems.slice(0, 8).map((p) => "row " + p.row + " (missing: " + p.missing.join(", ") + ")").join("; ");
      notes.push('<div class="toast warn">⚠ ' + problems.length +
        " row(s) have blank required fields — they will still print, check them: " + esc(list) +
        (problems.length > 8 ? " …" : "") + "</div>");
    }
    $("problemToast").innerHTML = notes.join("");

    const thead = $("tbl").querySelector("thead");
    const tb = $("tbl").querySelector("tbody"); tb.innerHTML = "";

    if (MODE === "rack") {
      thead.innerHTML = "<tr><th>#</th><th></th><th>Rack code (barcode)</th><th>Caption</th></tr>";
      ROWS.forEach((r, i) => {
        const tr = document.createElement("tr");
        if (!r.code) tr.classList.add("bad");
        tr.innerHTML = '<td class="rownum">' + (i + 1) + "</td>" + actionCell(i) +
          "<td><b>" + esc(r.code) + "</b></td><td>" + esc(r.sub) + "</td>";
        tb.appendChild(tr);
      });
    } else if (MODE === "item") {
      thead.innerHTML = "<tr><th>#</th><th></th><th>Item Code</th><th>Seller SKU</th><th>Description</th></tr>";
      ROWS.forEach((r, i) => {
        const tr = document.createElement("tr");
        if (!r["item code"]) tr.classList.add("bad");
        tr.innerHTML = '<td class="rownum">' + (i + 1) + "</td>" + actionCell(i) +
          "<td><b>" + esc(r["item code"]) + "</b></td>" +
          "<td>" + esc(r["seller sku code"]) + "</td>" +
          "<td>" + esc(r["description"]) + "</td>";
        tb.appendChild(tr);
      });
    } else {
      thead.innerHTML = "<tr><th>#</th><th></th><th>Copies</th><th>Seller SKU</th><th>SKU Code (barcode)</th><th>Size</th>" +
        "<th>MRP</th><th>Brand</th><th>Article Type</th><th>Style Name</th><th>Style ID</th><th>Month &amp; Year</th></tr>";
      const req = ["seller sku code", "sku code", "size", "mrp"];
      ROWS.forEach((r, i) => {
        const tr = document.createElement("tr");
        if (req.some((c) => !r[c])) tr.classList.add("bad");
        tr.innerHTML =
          '<td class="rownum">' + (i + 1) + "</td>" + actionCell(i) +
          '<td><input class="qty" type="number" min="1" value="' + (r._qty || 1) + '" data-i="' + i + '" style="width:52px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12.5px"></td>' +
          "<td><b>" + esc(r["seller sku code"]) + "</b></td>" +
          "<td>" + esc(r["sku code"]) + "</td><td>" + esc(r.size) + "</td>" +
          "<td>₹" + esc(r.mrp) + "</td><td>" + esc(r.brand) + "</td>" +
          "<td>" + esc(r["article type"]) + "</td><td>" + esc(r["style name"]) + "</td>" +
          "<td>" + esc(r["style id"]) + "</td><td>" + esc(r["month & year of manufacture"]) + "</td>";
        tb.appendChild(tr);
      });
    }
    tb.querySelectorAll("a.pv").forEach((a) => a.addEventListener("click", () => openPreview(+a.dataset.i)));
    tb.querySelectorAll("a.pr").forEach((a) => a.addEventListener("click", () => printRow(+a.dataset.i)));
    tb.querySelectorAll("input.qty").forEach((inp) => inp.addEventListener("change", () => {
      const v = Math.max(1, parseInt(inp.value, 10) || 1); inp.value = v; ROWS[+inp.dataset.i]._qty = v;
    }));

    $("genBtn").disabled = false; $("genBtn").style.display = "";
    $("prog").style.display = "none"; $("progFill").style.width = "0%";
    $("genMsg").textContent = ""; $("downloadBtn").style.display = "none";
    refreshPrintButtons();
  }

  // ---- preview ----
  function openPreview(i) {
    const doc = buildOne(ROWS[i]);
    $("pvFrame").src = doc.output("bloburl");
    $("modal").style.display = "flex";
  }
  $("pvClose").addEventListener("click", closeModal);
  $("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeModal(); });
  function closeModal() { $("modal").style.display = "none"; $("pvFrame").src = "about:blank"; }

  // ---- generate ZIP ----
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let ZIP_BLOB = null;

  $("genBtn").addEventListener("click", async () => {
    $("genBtn").disabled = true; $("prog").style.display = "block";
    $("downloadBtn").style.display = "none"; ZIP_BLOB = null;
    const zip = new JSZip(), used = {}; let total = 0;
    for (let i = 0; i < ROWS.length; i++) {
      const r = ROWS[i];
      const qty = MODE === "product" ? Math.max(1, parseInt(r._qty, 10) || 1) : 1;
      const base0 = (r._filename || r["seller sku code"] || r["item code"] || ("label_" + (i + 1))).replace(/[\\/:*?"<>|]/g, "_");
      const blob = buildOne(r).output("blob");   // build once, add qty times
      for (let c = 0; c < qty; c++) {
        let base = qty > 1 ? base0 + "-" + (c + 1) : base0;
        let name = base, n = 2;
        while (used[name]) { name = base + "_" + n; n++; }
        used[name] = 1;
        zip.file(name + ".pdf", blob);
        total++;
      }
      $("progFill").style.width = Math.round(100 * (i + 1) / ROWS.length) + "%";
      $("genMsg").textContent = (i + 1) + " / " + ROWS.length + " labels…";
      if (i % 15 === 0) await sleep(0);   // let the UI paint
    }
    $("genMsg").textContent = "Zipping…";
    ZIP_BLOB = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    $("prog").style.display = "none";
    $("genMsg").textContent = "✅ " + total + " labels ready.";
    $("genBtn").style.display = "none";
    $("downloadBtn").style.display = "inline-block";
  });

  $("downloadBtn").addEventListener("click", () => {
    if (!ZIP_BLOB) return;
    const base = (window._lastFile || "labels").replace(/\.[^.]+$/, "");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(ZIP_BLOB);
    a.download = base + "_labels.zip";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
})();
