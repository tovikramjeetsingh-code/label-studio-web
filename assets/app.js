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
  const PRODSIZE_KEY = "labelStudioProdSize_v1";
  const radioVal = (name, fallback) => {
    const el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : fallback;
  };
  function itemCodeType() { return radioVal("codeType", localStorage.getItem(ITEMCODE_KEY) || "barcode"); }
  function itemSizeKey() { return radioVal("itemSize", localStorage.getItem(ITEMSIZE_KEY) || "50x25"); }
  // Product-label stock — shared by the Product, Myntra STN and Find tabs.
  function prodSizeKey() { return radioVal("prodSize", localStorage.getItem(PRODSIZE_KEY) || "60x83"); }

  const buildOne = (r) => MODE === "item" ? window.ItemLabel.buildItemDoc(r, itemCodeType(), itemSizeKey())
                        : MODE === "rack" ? window.ItemLabel.buildRackDoc(r, itemCodeType())
                        : window.LabelRender.buildLabelDoc(r, prodSizeKey());
  const labelSize = () => MODE === "item" ? window.ItemLabel.sizeOf(itemSizeKey())
                        : MODE === "rack" ? { w: 25, h: 15 }
                        : window.LabelRender.sizeOf(prodSizeKey());

  // restore + persist the item-code type and size choices
  (function () {
    [["codeType", ITEMCODE_KEY], ["itemSize", ITEMSIZE_KEY], ["prodSize", PRODSIZE_KEY]].forEach(([name, key]) => {
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
    $("helpStn").classList.toggle("hidden", mode !== "stn");
    $("helpFind").classList.toggle("hidden", mode !== "find");
    $("helpScan").classList.toggle("hidden", mode !== "scan");
    $("uscanCard").classList.toggle("hidden", mode !== "scan");
    $("helpPick").classList.toggle("hidden", mode !== "pick");
    $("pickCard").classList.toggle("hidden", mode !== "pick");
    $("helpBox").classList.toggle("hidden", mode !== "box");
    $("boxCard").classList.toggle("hidden", mode !== "box");
    $("findCard").classList.toggle("hidden", mode !== "find");
    $("drop").classList.toggle("hidden", mode === "find");     // finder needs no upload
    $("codeTypeRow").classList.toggle("hidden", mode !== "item" && mode !== "rack");
    $("itemSizeRow").classList.toggle("hidden", mode !== "item");
    // Product stock applies wherever a product label is produced.
    $("prodSizeRow").classList.toggle("hidden",
      mode === "item" || mode === "rack" || mode === "pick" || mode === "box");
    const wantsPdf = mode === "item" || mode === "pick" || mode === "box";
    $("dropHint").textContent = (wantsPdf ? ".pdf" : ".csv · .xlsx") + " · multiple OK";
    $("fileInput").accept = wantsPdf ? ".pdf,application/pdf" : ".csv,.xlsx,.xls,.xlsm";
    $("fileInput").multiple = true;
    ROWS = [];
    $("mapCard").classList.add("hidden"); $("reviewCard").classList.add("hidden"); $("genCard").classList.add("hidden");
    $("scanCard").classList.add("hidden");
    $("uploadToast").innerHTML = "";
    STN_INDEX = null;
    // The STN file is optional — a scanned SKU code resolves from the bundled
    // listings on its own, so open the scan station straight away.
    if (mode === "stn") { SCANS = []; renderScans(); showScanCard("no STN loaded"); }
    if (mode === "pick") { PICK = null; $("pickTbl").querySelector("tbody").innerHTML = "";
      $("pickToast").innerHTML = ""; $("pickBadge").textContent = "no picklist loaded"; }
    if (mode === "box") { BOXES = []; renderBox(); $("boxToast").innerHTML = ""; }
    if (mode === "scan") { USCANS = []; renderUScans(); showUScanCard();
      setTimeout(() => $("uscanInput").focus(), 50); }
    if (mode === "find") { FIND_ROWS = []; $("findTbl").querySelector("tbody").innerHTML = "";
      $("findToast").innerHTML = ""; $("findPrintAll").classList.add("hidden");
      $("findZip").classList.add("hidden"); refreshFindUI();
      setTimeout(() => $("findInput").focus(), 50); }
    refreshPrintButtons();
  }
  document.querySelectorAll(".modebtn").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

  // fixed-values panel
  $("fxDesigned").textContent = C.DESIGNED_BY;
  $("fxMfg").textContent = C.MANUFACTURED_BY;
  $("fxCountry").textContent = C.COUNTRY_OF_ORIGIN;

  // stored reference — bundled with the app, loads itself on startup
  function updateRef() {
    const meta = window.LabelParse.masterMeta();
    const im = window.LabelParse.itemsMeta();
    if (meta && meta.count) {
      $("masterInfo").innerHTML = "✅ Reference active — <b>" + meta.count.toLocaleString() +
        "</b> SKUs (updated " + esc(meta.built) + ")" +
        (im ? " · <b>" + im.items.toLocaleString() + "</b> item barcodes (" + esc(im.built) + ")" : "") + ".";
    } else if (window.LabelParse.hasEncrypted()) {
      $("masterInfo").innerHTML = '<span style="color:var(--err)">✕ Reference failed to load — ' +
        "the bundled key doesn't match this build.</span>";
    } else {
      $("masterInfo").textContent = "No reference is bundled with this site yet.";
    }
  }
  (async () => {
    $("masterInfo").textContent = "Loading reference…";
    await window.LabelParse.tryAutoUnlock();
    updateRef();
    refreshFindUI();
  })();

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
  function updateCopiesUI() {
    const perRow = MODE === "product" || MODE === "stn" || MODE === "scan";
    $("qzCopiesWrap").classList.toggle("hidden", !(printConnected() && !perRow));
  }

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
  const PRINTER_KEY = "labelStudioPrinter_v1";
  function applyPrinterSetup() {
    const o = {
      density: $("pDensity").value, speed: $("pSpeed").value,
      gap: $("pGap").value, direction: $("pDirection").value,
      media: $("pMedia").value, tear: $("pTear").checked,
    };
    window.TSCLabel.setPrinter(o);
    try { localStorage.setItem(PRINTER_KEY, JSON.stringify(o)); } catch (e) {}
  }
  (function () {
    try {
      const o = JSON.parse(localStorage.getItem(PRINTER_KEY) || "null");
      if (o) {
        if (o.density !== undefined) $("pDensity").value = o.density;
        if (o.speed !== undefined) $("pSpeed").value = o.speed;
        if (o.gap !== undefined) $("pGap").value = o.gap;
        if (o.direction !== undefined) $("pDirection").value = o.direction;
        if (o.media) $("pMedia").value = o.media;
        if (o.tear !== undefined) $("pTear").checked = !!o.tear;
      }
    } catch (e) {}
    applyPrinterSetup();
    ["pDensity", "pSpeed", "pGap", "pDirection", "pMedia", "pTear"].forEach((id) =>
      $(id).addEventListener("change", () => { applyPrinterSetup(); showJobDump(true); }));

    $("pShow").addEventListener("click", () => showJobDump());
    $("pCalibrate").addEventListener("click", async () => {
      if (!printConnected()) { $("qzInfo").innerHTML =
        '<span style="color:var(--warn)">Connect the printer first.</span>'; return; }
      applyPrinterSetup();
      try {
        await LP.printRawBytes(window.TSCLabel.calibrationJob(labelSize()), selectedPrinter());
        $("qzInfo").innerHTML = "✅ Calibration sent — the printer will feed a label to measure the stock.";
      } catch (e) { $("qzInfo").innerHTML = '<span style="color:var(--err)">✕ ' + esc(e.message) + "</span>"; }
    });
  })();

  // Picklist stock, sent as the TSPL SIZE for that job.
  const PICKSIZE_KEY = "labelStudioPickSize_v1";
  function pickSize() {
    const w = parseFloat($("pickW").value) || window.Picklist.size.w;
    const h = parseFloat($("pickH").value) || window.Picklist.size.h;
    return { w, h };
  }
  (function () {
    try {
      const o = JSON.parse(localStorage.getItem(PICKSIZE_KEY) || "null");
      if (o) { if (o.w) $("pickW").value = o.w; if (o.h) $("pickH").value = o.h; }
    } catch (e) {}
    ["pickW", "pickH"].forEach((id) => $(id).addEventListener("change", () => {
      try { localStorage.setItem(PICKSIZE_KEY, JSON.stringify(pickSize())); } catch (e) {}
      const el = $("pickPerPage");
      if (el) el.textContent = window.Picklist.rowsPerPage(pickSize());
      if (typeof renderPick === "function") renderPick();
    }));
  })();

  // Box-sticker stock, sent as the TSPL SIZE for that job.
  const BOXSIZE_KEY = "labelStudioBoxSize_v1";
  function boxSize() {
    const w = parseFloat($("boxW").value) || window.BoxLabel.size.w;
    const h = parseFloat($("boxH").value) || window.BoxLabel.size.h;
    return { w, h };
  }
  (function () {
    try {
      const o = JSON.parse(localStorage.getItem(BOXSIZE_KEY) || "null");
      if (o) { if (o.w) $("boxW").value = o.w; if (o.h) $("boxH").value = o.h; }
    } catch (e) {}
    ["boxW", "boxH"].forEach((id) => $(id).addEventListener("change", () => {
      try { localStorage.setItem(BOXSIZE_KEY, JSON.stringify(boxSize())); } catch (e) {}
    }));
  })();

  // Show the exact setup the printer receives, so this is not a black box.
  function showJobDump(onlyIfOpen) {
    const pre = $("pDump");
    if (onlyIfOpen && pre.classList.contains("hidden")) return;
    applyPrinterSetup();
    const size = MODE === "pick" ? pickSize() : MODE === "box" ? boxSize() : labelSize();
    pre.textContent = window.TSCLabel.setupLines(size, window.TSCLabel.prod.gap)
      .replace(/\r\n/g, "\n") + "CLS\nBITMAP 0,0,…\nPRINT 1,1";
    pre.classList.remove("hidden");
  }

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

  // Render rows to bitmaps and send as ONE raw TSPL job (one QZ prompt for the batch).
  // Each label prints its own copy count (rowQty). Canvases are freed as we go.
  async function printBitmaps(rows, buildDoc, sizeMm, gapMm) {
    const T = window.TSCLabel, parts = [T.bitmapHeader(sizeMm, gapMm)];
    for (let i = 0; i < rows.length; i++) {
      const cv = await docToCanvas(buildDoc(rows[i]), sizeMm.w);
      parts.push(T.bitmapLabel(cv, rowQty(rows[i])));
      $("genMsg").textContent = "Preparing " + (i + 1) + " / " + rows.length + "…";
      if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    $("genMsg").textContent = "Sending to the printer…";
    await LP.printRawBytes(T.concat(parts), selectedPrinter());
  }

  // 4-up 25x15: composite each row of labels, build ONE raw job (one QZ prompt).
  // Quarter-turn a rendered label so a landscape page prints onto portrait
  // stock. Used by 30x60, which is drawn 60x30 so its barcode gets the long axis.
  function rotate90(cv) {
    const out = document.createElement("canvas");
    out.width = cv.height; out.height = cv.width;
    const cx = out.getContext("2d");
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, out.width, out.height);
    cx.translate(out.width / 2, out.height / 2);
    cx.rotate(-Math.PI / 2);
    cx.drawImage(cv, -cv.width / 2, -cv.height / 2);
    return out;
  }

  // Render one label to a 203-dpi canvas sized for its slot on the roll.
  async function slotCanvas(doc, sizeKey, slotWmm) {
    const spec = window.LabelRender.specOf(sizeKey);
    if (!spec.rotate) return docToCanvas(doc, slotWmm);
    return rotate90(await docToCanvas(doc, spec.w));   // 60mm wide -> 30mm wide
  }

  // A multi-up row carries one copy count for all N labels in it, so per-row
  // quantities are handled by repeating the rows before they are laid out.
  async function printMultiUp(rows, buildDoc, roll, nCopies, sizeKey) {
    const T = window.TSCLabel, g = T.rolls[roll];
    const copiesOf = () => (nCopies == null ? copies() : nCopies);
    const parts = [T.bitmapHeader({ w: T.mediaWidth(roll), h: g.labelH }, g.rowGap)];
    for (let i = 0; i < rows.length; i += g.up) {
      const upc = [];
      for (const r of rows.slice(i, i + g.up)) {
        upc.push(sizeKey ? await slotCanvas(buildDoc(r), sizeKey, g.labelW)
                         : await docToCanvas(buildDoc(r), g.labelW));
      }
      parts.push(T.bitmapLabel(T.compositeRow(upc, roll), copiesOf()));
      $("genMsg").textContent = "Preparing " + Math.min(i + g.up, rows.length) + " / " + rows.length + "…";
      if (i % 40 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    $("genMsg").textContent = "Sending to the printer…";
    await LP.printRawBytes(T.concat(parts), selectedPrinter());
  }

  // Every label type prints by talking straight to the printer (raw TSPL).
  async function sendPrint(rows) {
    applyOffset(); applyPrinterSetup();   // latest nudge + printer setup
    if (MODE === "rack") {
      const ct = itemCodeType();
      await printMultiUp(rows, (r) => window.ItemLabel.buildRackDoc(r, ct), "25x15");
      return;
    }
    if (MODE === "item") {
      if (itemSizeKey() === "50x25") {
        await LP.printRaw(window.TSCLabel.buildItemTSPL(rows, itemCodeType(), copies()), selectedPrinter());  // native 2-up
      } else {
        const ct = itemCodeType();
        await printMultiUp(rows, (r) => window.ItemLabel.buildItemDoc(r, ct, "25x15"), "25x15");
      }
      return;
    }
    // product label — 60x83 runs single-up, 30x60 runs 3-up on its own roll
    const sz = prodSizeKey();
    if (window.TSCLabel.rolls[sz]) {
      const expanded = [];
      rows.forEach((r) => { for (let n = rowQty(r); n > 0; n--) expanded.push(r); });
      await printMultiUp(expanded, (r) => window.LabelRender.buildLabelDoc(r, sz), sz, 1, sz);
    } else {
      await printBitmaps(rows, (r) => window.LabelRender.buildLabelDoc(r, sz),
        window.LabelRender.sizeOf(sz), window.TSCLabel.prod.gap);
    }
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
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener("change", () => { if (fileInput.files.length) handleFiles(fileInput.files); });

  function resetDrop() { drop.querySelector(".big").textContent = "Drop file here or click to browse"; fileInput.value = ""; }
  function uploadErr(e, filename) {
    resetDrop();
    $("uploadToast").innerHTML = '<div class="toast err">✕ ' +
      (filename ? esc(filename) + ": " : "") + esc(e.message) + "</div>";
    $("mapCard").classList.add("hidden"); $("reviewCard").classList.add("hidden"); $("genCard").classList.add("hidden");
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList);
    if (!files.length) return;
    $("uploadToast").innerHTML = "";
    const label = files.length === 1 ? files[0].name : files.length + " files";
    drop.querySelector(".big").textContent = "Reading " + label + "…";
    window._lastFile = label;

    // Item + Rack: combine ALL uploaded files into one batch (auto-aligned in the layout).
    if (MODE === "item") {
      const all = [];
      try { for (const f of files) all.push(...await window.ItemLabel.parsePDF(f)); }
      catch (e) { uploadErr(e); return; }
      resetDrop();
      ROWS = all;
      renderReview(label, all.length + " item codes", [], 0);
      return;
    }
    if (MODE === "rack") {
      const all = [];
      try { for (const f of files) all.push(...(await window.LabelParse.parseRack(f)).rows); }
      catch (e) { uploadErr(e); return; }
      resetDrop();
      ROWS = all;
      renderReview(label, "Rack", [], 0);
      return;
    }

    // Picklist tab: PDFs in, 4x6 stickers out.
    if (MODE === "pick") { await handlePicklists(files); return; }

    // Box sticker tab: invoice PDFs in, 4x6 carton stickers out.
    if (MODE === "box") { await handleInvoices(files); return; }

    // Scan & print: uploads teach the app, they do not make a batch.
    if (MODE === "scan") {
      const notes = [];
      for (const f of files) {
        let kind;
        try { kind = await window.LabelParse.sniffUpload(f); }
        catch (e) { notes.push('<div class="toast err">✕ ' + esc(f.name) + ": " + esc(e.message) + "</div>"); continue; }
        try {
          const res = kind === "items" ? await window.LabelParse.addItemBarcodes(f)
                    : kind === "listings" ? await window.LabelParse.addListings(f)
                    : null;
          if (!res) {
            notes.push('<div class="toast err">✕ ' + esc(f.name) +
              " — not an item-barcode export or a Seller Listings Report.</div>");
          } else if (!res.saved) {
            notes.push('<div class="toast err">✕ ' + esc(f.name) + " — added " + res.added +
              ", but this browser's storage is full so it won't be remembered.</div>");
          } else {
            notes.push('<div class="toast ok-toast">✓ ' + esc(f.name) + " — added <b>" + res.added +
              "</b> new " + (res.kind === "items" ? "item barcode(s)" : "listing(s)") +
              (res.already ? ", " + res.already + " already known" : "") + ".</div>");
          }
        } catch (e) {
          notes.push('<div class="toast err">✕ ' + esc(f.name) + ": " + esc(e.message) + "</div>");
        }
      }
      resetDrop();
      showUScanCard(notes.join(""));
      setTimeout(() => $("uscanInput").focus(), 50);
      return;
    }

    // STN scan: parse the STN file(s) into a lookup index, then wait for scans.
    if (MODE === "stn") {
      const all = [];
      for (const f of files) {
        let res;
        try { res = await window.LabelParse.parseUpload(f); }
        catch (e) { uploadErr(e, f.name); return; }
        if (res.needsMapping) { uploadErr(new Error("not a recognised STN export"), f.name); return; }
        res.rows.forEach((r) => { r._src = f.name; });
        all.push(...res.rows);
      }
      resetDrop();
      if (!all.length) { uploadErr(new Error("No rows found in the STN file(s).")); return; }
      ROWS = all;
      STN_INDEX = buildStnIndex(all);
      SCANS = []; renderScans();
      showScanCard(label);
      return;
    }

    // Product: parse every file (format detected per file) into ONE batch.
    // A single unrecognised file still goes to the manual-mapping step; when
    // several are dropped at once the unrecognised ones are reported instead,
    // since mapping is per-file and can't be applied across a mixed batch.
    const all = [], problems = [], formats = [], unmapped = [];
    let enriched = 0;
    for (const f of files) {
      let res;
      try { res = await window.LabelParse.parseUpload(f); }
      catch (e) { uploadErr(e, f.name); return; }
      if (res.needsMapping) {
        if (files.length === 1) { resetDrop(); renderMapping(f.name, res); return; }
        unmapped.push(f.name); continue;
      }
      res.rows.forEach((r) => { r._src = f.name; });
      all.push(...res.rows);
      res.problems.forEach((p) => problems.push({ ...p, file: f.name }));
      enriched += res.enriched || 0;
      if (!formats.includes(res.format)) formats.push(res.format);
    }
    resetDrop();
    if (!all.length) {
      uploadErr(new Error("No recognised rows. Unreadable: " + unmapped.join(", ")));
      return;
    }
    $("mapCard").classList.add("hidden");
    ROWS = all;
    renderReview(label, formats.join(" + ") || "—", problems, enriched, {
      files: files.length, unmapped, dupes: countDupes(all),
    });
  }

  // ---------------------------------------------------------------------------
  // Manual finder: look a label up in the bundled catalog by seller SKU, SKU
  // code, style ID or VAN — no file upload at all.
  // ---------------------------------------------------------------------------
  let FIND_ROWS = [];

  function refreshFindUI() {
    if (MODE !== "find") return;
    const meta = window.LabelParse.masterMeta();
    $("findBadge").textContent = meta && meta.count
      ? meta.count.toLocaleString() + " SKUs · updated " + meta.built
      : "catalog not loaded";
  }

  function runFind() {
    const q = $("findInput").value.trim();
    const res = window.LabelParse.searchReference(q);
    FIND_ROWS = res.rows;
    ROWS = res.rows;                      // so Print all / ZIP work on the results
    const tb = $("findTbl").querySelector("tbody");
    tb.innerHTML = "";
    res.rows.forEach((r, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = '<td class="rownum">' + (i + 1) + "</td>" + actionCell(i) +
        '<td><input class="qty" type="number" min="1" value="' + (r._qty || 1) +
        '" data-i="' + i + '" style="width:52px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12.5px"></td>' +
        "<td><b>" + esc(r["seller sku code"]) + "</b></td><td>" + esc(r["sku code"]) + "</td>" +
        "<td>" + esc(r.size) + "</td><td>₹" + esc(r.mrp) + "</td><td>" + esc(r.brand) + "</td>" +
        "<td>" + esc(r["style name"]) + "</td><td>" + esc(r["style id"]) + "</td>" +
        "<td>" + esc(r._van || "") + "</td>";
      tb.appendChild(tr);
    });
    // Row actions live on this table too — bind them the same way the review
    // table does, or Preview/Print are dead links.
    tb.querySelectorAll("a.pv").forEach((a) => a.addEventListener("click", () => openPreview(+a.dataset.i)));
    tb.querySelectorAll("a.pr").forEach((a) => a.addEventListener("click", () => printRow(+a.dataset.i)));

    const notes = [];
    if (!q || q.length < 2) notes.push('<div class="toast warn">Type at least 2 characters.</div>');
    else if (!res.rows.length) notes.push('<div class="toast err">✕ Nothing matched “' + esc(q) +
      "”. Try the seller SKU, SKU code, style ID or VAN.</div>");
    else {
      const styles = new Set(res.rows.map((r) => r["style id"]).filter(Boolean));
      notes.push('<div class="toast ok-toast">✓ ' + res.rows.length + " label(s)" +
        (styles.size > 1 ? " across " + styles.size + " styles" : "") +
        (res.rows.length > 1 ? " — the full size run; print one row or all." : "") + "</div>");
      if (res.truncated) notes.push('<div class="toast warn">⚠ Showing the first ' + res.rows.length +
        " matches only — narrow the search.</div>");
    }
    $("findToast").innerHTML = notes.join("");
    $("findPrintAll").classList.toggle("hidden", !res.rows.length);
    $("findZip").classList.toggle("hidden", !res.rows.length);
    // The generate card holds the ZIP progress bar + download button, so it has
    // to be visible for results here as well.
    $("genCard").classList.toggle("hidden", !res.rows.length);
    if (res.rows.length) {
      $("genBtn").disabled = false; $("genBtn").style.display = "";
      $("prog").style.display = "none"; $("progFill").style.width = "0%";
      $("genMsg").textContent = ""; $("downloadBtn").style.display = "none";
    }
    refreshPrintButtons();
  }

  $("findBtn").addEventListener("click", runFind);
  $("findInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runFind(); } });
  $("findTbl").addEventListener("input", (e) => {
    if (!e.target.classList.contains("qty")) return;
    const i = +e.target.dataset.i, n = parseInt(e.target.value, 10);
    if (FIND_ROWS[i]) FIND_ROWS[i]._qty = isNaN(n) || n < 1 ? 1 : n;
  });
  $("findPrintAll").addEventListener("click", async () => {
    if (!FIND_ROWS.length) return;
    if (!printConnected()) { $("findToast").innerHTML =
      '<div class="toast err">✕ Printer not connected — connect it under Direct printing.</div>'; return; }
    $("findToast").innerHTML = '<div class="toast">Printing ' + FIND_ROWS.length + " label(s)…</div>";
    try { await sendPrint(FIND_ROWS); $("findToast").innerHTML = '<div class="toast ok-toast">✓ Sent to the printer.</div>'; }
    catch (e) { $("findToast").innerHTML = '<div class="toast err">✕ ' + esc(e.message) + "</div>"; }
  });
  $("findZip").addEventListener("click", () => {
    if (!FIND_ROWS.length) return;
    ROWS = FIND_ROWS;
    window._lastFile = ($("findInput").value.trim() || "found") + ".csv";
    $("genCard").classList.remove("hidden");
    $("genCard").scrollIntoView({ behavior: "smooth", block: "center" });
    $("genBtn").click();
  });

  // ---------------------------------------------------------------------------
  // Picklist -> 4x6 stickers
  // ---------------------------------------------------------------------------
  let PICK = null;
  // keep the help text honest about the real capacity
  (function () {
    const el = $("pickPerPage");
    if (el && window.Picklist) el.textContent = window.Picklist.rowsPerPage(pickSize());
  })();

  function renderPick() {
    const tb = $("pickTbl").querySelector("tbody");
    tb.innerHTML = "";
    if (!PICK) return;
    PICK.rows.forEach((r, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = '<td class="rownum">' + (i + 1) + "</td>" +
        "<td><b>" + esc(r.sku) + "</b></td><td>" + esc(r.rack) + "</td>" +
        "<td><b>" + esc(r.qty) + "</b></td><td class=\"src\">" + esc(r._src || "") + "</td>";
      tb.appendChild(tr);
    });
    const pages = Math.max(1, Math.ceil(PICK.rows.length / window.Picklist.rowsPerPage(pickSize())));
    $("pickBadge").textContent = PICK.rows.length + " lines · " + PICK.meta.units +
      " units · " + pages + " sticker" + (pages > 1 ? "s" : "");
  }

  async function handlePicklists(files) {
    const all = [], notes = [];
    let meta = null;
    for (const f of files) {
      try {
        const p = await window.Picklist.parsePicklist(f);
        if (!p.rows.length) {
          notes.push('<div class="toast err">✕ ' + esc(f.name) + " — no picklist lines found in this PDF.</div>");
          continue;
        }
        p.rows.forEach((r) => { r._src = p.meta.picklist || f.name; });
        all.push(...p.rows);
        meta = meta || p.meta;
        notes.push('<div class="toast ok-toast">✓ ' + esc(f.name) + " — " + p.rows.length +
          " lines, " + p.meta.units + " units.</div>");
      } catch (e) {
        notes.push('<div class="toast err">✕ ' + esc(f.name) + ": " + esc(e.message) + "</div>");
      }
    }
    resetDrop();
    if (!all.length) { PICK = null; renderPick(); $("pickToast").innerHTML = notes.join(""); return; }
    PICK = { meta: { ...meta, lines: all.length, units: all.reduce((n, r) => n + r.qty, 0) }, rows: all };
    if (files.length > 1) PICK.meta.picklist = (PICK.meta.picklist || "") + " +" + (files.length - 1);
    renderPick();
    $("pickToast").innerHTML = notes.join("");
  }

  $("pickPreview").addEventListener("click", () => {
    if (!PICK) return;
    const doc = window.Picklist.buildPicklistDoc(PICK, pickSize());
    $("pvFrame").src = doc.output("bloburl");
    $("modal").style.display = "flex";
  });
  $("pickZip").addEventListener("click", () => {
    if (!PICK) return;
    const doc = window.Picklist.buildPicklistDoc(PICK, pickSize());
    const a = document.createElement("a");
    a.href = URL.createObjectURL(doc.output("blob"));
    a.download = "picklist-" + (PICK.meta.picklist || "4x6") + ".pdf";
    document.body.appendChild(a); a.click(); a.remove();
  });
  $("pickPrint").addEventListener("click", async () => {
    if (!PICK) return;
    if (!printConnected()) {
      $("pickToast").innerHTML = '<div class="toast err">✕ Printer not connected — connect it under Direct printing.</div>';
      return;
    }
    const pages = window.Picklist.buildPicklistPages(PICK, pickSize());
    $("pickToast").innerHTML = '<div class="toast">Printing ' + pages.length + " sticker(s)…</div>";
    try {
      applyOffset(); applyPrinterSetup();
      await printBitmaps(pages.map((d) => d), (d) => d, pickSize(), window.TSCLabel.prod.gap);
      $("pickToast").innerHTML = '<div class="toast ok-toast">✓ Sent to the printer.</div>';
    } catch (e) {
      $("pickToast").innerHTML = '<div class="toast err">✕ ' + esc(e.message) + "</div>";
    }
  });

  // ---------------------------------------------------------------------------
  // Box stickers. One tax invoice -> one sticker per carton, carrying the
  // invoice number and the STN so a box can be tied back to its dispatch.
  let BOXES = [];

  function renderBox() {
    const tb = $("boxTbl").querySelector("tbody");
    tb.innerHTML = "";
    BOXES.forEach((inv, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = '<td class="rownum">' + (i + 1) + "</td>" +
        '<td><input class="boxN" data-i="' + i + '" type="number" min="1" step="1" value="' +
          (parseInt(inv.boxes, 10) || 1) + '" style="width:58px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px"></td>' +
        "<td><b>" + esc(inv.invoice || "—") + "</b></td>" +
        "<td><b>" + esc(inv.stn || "—") + "</b></td>" +
        "<td>" + esc(inv.date || "") + "</td>" +
        "<td>" + esc(inv.qty || "") + "</td>" +
        "<td>" + esc(inv.type || "") + "</td>" +
        "<td>" + esc(inv.status || "") + "</td>" +
        '<td class="src">' + esc(inv.src || "") + "</td>";
      tb.appendChild(tr);
    });
    tb.querySelectorAll(".boxN").forEach((el) => el.addEventListener("change", () => {
      const inv = BOXES[parseInt(el.dataset.i, 10)];
      if (inv) { inv.boxes = Math.max(1, parseInt(el.value, 10) || 1); el.value = inv.boxes; }
      updateBoxBadge();
    }));
    updateBoxBadge();
  }

  function boxTotal() {
    return BOXES.reduce((n, inv) => n + Math.max(1, parseInt(inv.boxes, 10) || 1), 0);
  }
  function updateBoxBadge() {
    const n = boxTotal();
    $("boxBadge").textContent = BOXES.length
      ? BOXES.length + " invoice" + (BOXES.length > 1 ? "s" : "") + " · " + n + " sticker" + (n > 1 ? "s" : "")
      : "no invoice loaded";
  }

  async function handleInvoices(files) {
    const notes = [];
    for (const f of files) {
      try {
        const inv = await window.BoxLabel.parseInvoice(f);
        BOXES.push(inv);
        const bits = [];
        if (inv.invoice) bits.push("Invoice " + inv.invoice);
        if (inv.stn) bits.push("STN " + inv.stn);
        notes.push('<div class="toast ok-toast">✓ ' + esc(f.name) + " — " + esc(bits.join(" · ")) + ".</div>");
        if (!inv.stn) notes.push('<div class="toast err">! ' + esc(f.name) +
          " — no STN (STR No.) on this invoice; the sticker will show the invoice number only.</div>");
      } catch (e) {
        notes.push('<div class="toast err">✕ ' + esc(f.name) + ": " + esc(e.message) + "</div>");
      }
    }
    resetDrop();
    renderBox();
    $("boxToast").innerHTML = notes.join("");
  }

  $("boxPreview").addEventListener("click", () => {
    if (!BOXES.length) return;
    const doc = window.BoxLabel.buildBoxDoc(BOXES, boxSize());
    $("pvFrame").src = doc.output("bloburl");
    $("modal").style.display = "flex";
  });
  $("boxZip").addEventListener("click", () => {
    if (!BOXES.length) return;
    const doc = window.BoxLabel.buildBoxDoc(BOXES, boxSize());
    const a = document.createElement("a");
    a.href = URL.createObjectURL(doc.output("blob"));
    a.download = "box-" + ((BOXES[0].stn || BOXES[0].invoice || "4x6").replace(/[^A-Za-z0-9._-]+/g, "-")) + ".pdf";
    document.body.appendChild(a); a.click(); a.remove();
  });
  $("boxPrint").addEventListener("click", async () => {
    if (!BOXES.length) return;
    if (!printConnected()) {
      $("boxToast").innerHTML = '<div class="toast err">✕ Printer not connected — connect it under Direct printing.</div>';
      return;
    }
    const pages = window.BoxLabel.buildBoxPages(BOXES, boxSize());
    $("boxToast").innerHTML = '<div class="toast">Printing ' + pages.length + " sticker(s)…</div>";
    try {
      applyOffset(); applyPrinterSetup();
      await printBitmaps(pages.map((d) => d), (d) => d, boxSize(), window.TSCLabel.prod.gap);
      $("boxToast").innerHTML = '<div class="toast ok-toast">✓ Sent to the printer.</div>';
    } catch (e) {
      $("boxToast").innerHTML = '<div class="toast err">✕ ' + esc(e.message) + "</div>";
    }
  });

  // ---------------------------------------------------------------------------
  // General scan station. No file needed: it resolves against the built-in
  // universe plus anything the team has uploaded here before. A failed scan says
  // exactly which of the two files would fix it, so the universe grows over time.
  // ---------------------------------------------------------------------------
  let USCANS = [], USCAN_BUSY = false;

  function showUScanCard(msg) {
    const im = window.LabelParse.itemsMeta();
    const x = window.LabelParse.extrasMeta();
    const ref = window.LabelParse.masterMeta();
    $("uscanBadge").textContent = (ref ? ref.count.toLocaleString() + " SKUs" : "catalog loading") +
      (im ? " · " + im.items.toLocaleString() + " item barcodes" : "");
    const notes = [];
    if (x.items || x.listings) {
      notes.push('<div class="toast ok-toast">➕ Added on this device: <b>' + x.items +
        "</b> item barcode(s), <b>" + x.listings + "</b> listing(s). Kept for next time.</div>");
    }
    if (!printConnected()) notes.push('<div class="toast warn">⚠ Printer not connected — ' +
      "connect it under <b>Direct printing</b> before scanning.</div>");
    if (msg) notes.push(msg);
    $("uscanState").innerHTML = notes.join("");
  }

  // Resolve a scan and, when it fails, say which upload fixes it.
  function resolveUScan(code) {
    const raw = (code || "").trim();
    const item = window.LabelParse.findItem(raw);

    if (item) {
      const row = window.LabelParse.rowFromReference(item.sku);
      if (row) return { ok: true, item, row };
      // barcode known, SKU not in the catalog -> needs a listings refresh
      return { ok: false, item, need: "listings",
        reason: "Item barcode maps to SKU " + item.sku +
                ", but that SKU isn't in the listings. Upload the updated Seller Listings Report." };
    }

    // not an item barcode — maybe a SKU code or seller SKU typed directly
    const direct = window.LabelParse.rowFromReference(raw);
    if (direct) return { ok: true, row: direct };

    if (/^IB\d+$/i.test(raw)) {
      return { ok: false, need: "items",
        reason: "Item barcode not in the item map. Upload the updated item-barcode file." };
    }
    return { ok: false, need: null,
      reason: "Not recognised as an item barcode, SKU code or seller SKU code." };
  }

  async function onUScan(code) {
    if (USCAN_BUSY) return;
    const raw = (code || "").trim();
    if (!raw) return;
    USCAN_BUSY = true;
    const res = resolveUScan(raw);
    let result;
    if (!res.ok) result = { cls: "err", text: res.reason, need: res.need };
    else if (!printConnected()) result = { cls: "err", text: "Printer not connected — connect it under Direct printing." };
    else {
      try { await sendPrint([{ ...res.row, _qty: 1 }]); result = { cls: "ok", text: "Printed" }; }
      catch (e) { result = { cls: "err", text: "Print failed: " + e.message }; }
    }
    USCANS.unshift({ code: raw, item: res.item, row: res.ok ? res.row : null, result });
    renderUScans();
    USCAN_BUSY = false;
  }

  function renderUScans() {
    const tb = $("uscanTbl").querySelector("tbody");
    tb.innerHTML = "";
    USCANS.slice(0, 60).forEach((s, i) => {
      const tr = document.createElement("tr");
      if (s.result.cls === "err") tr.classList.add("bad");
      const r = s.row || {};
      tr.innerHTML = '<td class="rownum">' + (USCANS.length - i) + "</td>" +
        "<td><b>" + esc(s.code) + "</b></td>" +
        "<td>" + esc(s.item ? s.item.sku : (r["sku code"] || "")) + "</td>" +
        "<td>" + esc(r["seller sku code"] || "") + "</td>" +
        "<td>" + esc(r.size || "") + "</td>" +
        "<td>" + esc(r.brand || "") + "</td>" +
        '<td class="' + s.result.cls + '">' + esc(s.result.text) + "</td>";
      tb.appendChild(tr);
    });
    $("uscanCount").textContent = USCANS.filter((s) => s.result.cls === "ok").length + " printed";
    const last = USCANS[0];
    $("uscanLast").innerHTML = last
      ? '<div class="toast ' + (last.result.cls === "ok" ? "ok-toast" : "err") + '">' +
        (last.result.cls === "ok" ? "✓ " : "✕ ") + esc(last.code) +
        (last.row ? " · " + esc(last.row["seller sku code"]) + " · size " + esc(last.row.size) : "") +
        " — " + esc(last.result.text) + "</div>"
      : "";
  }

  $("uscanClear").addEventListener("click", () => { USCANS = []; renderUScans(); $("uscanInput").focus(); });
  $("uscanForget").addEventListener("click", () => {
    if (!confirm("Forget every item barcode and listing uploaded on this device?")) return;
    window.LabelParse.clearExtras();
    showUScanCard('<div class="toast warn">Uploaded data cleared — back to the built-in universe.</div>');
  });
  $("uscanInput").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const v = $("uscanInput").value;
    $("uscanInput").value = "";
    onUScan(v);
  });

  // ---------------------------------------------------------------------------
  // STN scan station: scan an item barcode -> bundled item map gives its SKU ->
  // match the uploaded STN row -> print that product's 60x83 label immediately.
  // ---------------------------------------------------------------------------
  let STN_INDEX = null, SCANS = [], SCAN_BUSY = false;

  // OMS writes `3221-Beige_36`, the STN `3221-Beige-36` — same key, different
  // separator, so compare on a normalised form.
  const skuKey = (s) => (s || "").trim().toUpperCase().replace(/[\s_]+/g, "-");

  function buildStnIndex(rows) {
    const bySeller = new Map(), bySku = new Map(), byStem = new Map();
    rows.forEach((r) => {
      const ss = skuKey(r["seller sku code"]), sz = (r.size || "").trim();
      if (ss) {
        bySeller.set(ss, r);
        if (sz) bySeller.set(ss + "-" + sz.toUpperCase(), r);   // VAN + size
        // Stem = seller SKU without its trailing size, i.e. the VAN. Kept as a
        // list so a bare VAN can report which sizes this dispatch holds.
        const stem = ss.replace(/-[^-]+$/, "");
        if (stem && stem !== ss) {
          if (!byStem.has(stem)) byStem.set(stem, []);
          byStem.get(stem).push(r);
        }
      }
      const sk = skuKey(r["sku code"]);
      if (sk) bySku.set(sk, r);
    });
    return { bySeller, bySku, byStem, rows };
  }

  // Three things can be scanned or typed:
  //   ① item barcode (IB…)      → built-in item map gives the OMS SKU
  //   ② SKU code                 (ANUKHeels97088318)
  //   ③ seller SKU code          (3221-Beige-36, or the VAN 3221-Beige)
  // Every one of them must resolve to a row in the LOADED STN — the STN is
  // mandatory here, so a code outside this dispatch never prints.
  function stnRowFor(key) {
    if (!STN_INDEX) return null;
    if (STN_INDEX.bySeller.has(key)) return STN_INDEX.bySeller.get(key);
    if (STN_INDEX.bySku.has(key)) return STN_INDEX.bySku.get(key);
    // OMS key carries the size, the STN may hold only the VAN — try the stem.
    const stem = key.replace(/-[^-]+$/, "");
    if (STN_INDEX.bySeller.has(stem)) return STN_INDEX.bySeller.get(stem);
    // A bare VAN is only unambiguous when this dispatch has a single size of it.
    const group = STN_INDEX.byStem.get(key);
    if (group && group.length === 1) return group[0];
    return null;
  }

  function resolveScan(code) {
    const raw = (code || "").trim();
    if (!STN_INDEX || !STN_INDEX.rows.length) {
      return { ok: false, reason: "Upload the STN summary CSV first — this tab prints only from an STN." };
    }

    const item = window.LabelParse.findItem(raw);
    if (item) {                                    // ① item barcode
      const row = stnRowFor(skuKey(item.sku));
      if (row) return { ok: true, via: "item", item, row: { ...row, _qty: 1 } };
      return { ok: false, item, reason: "SKU " + item.sku + " is not in the loaded STN." };
    }

    // ② SKU code  /  ③ seller SKU code (or VAN)
    const row = stnRowFor(skuKey(raw));
    if (row) {
      const via = skuKey(row["sku code"]) === skuKey(raw) ? "sku" : "seller";
      return { ok: true, via, row: { ...row, _qty: 1 } };
    }

    if (/^IB\d+$/i.test(raw)) {
      return { ok: false, reason: "Unknown item barcode — not in the built-in item map." };
    }
    // A VAN on its own covers the whole size run — say which sizes are here.
    const group = STN_INDEX.byStem.get(skuKey(raw));
    if (group && group.length > 1) {
      const sizes = [...new Set(group.map((r) => r.size).filter(Boolean))]
        .sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0));
      return { ok: false, reason: "That's a VAN covering " + group.length +
        " sizes in this STN (" + sizes.join(", ") + ") — add the size, e.g. " +
        raw + "-" + (sizes[0] || "38") + "." };
    }
    // Known to the catalog but absent from this dispatch — say so precisely.
    return { ok: false, reason: window.LabelParse.rowFromReference(raw)
      ? "Found in the catalog but not in the loaded STN — it isn't part of this dispatch."
      : "Not recognised as an item barcode, SKU code or seller SKU code." };
  }

  async function onScan(code) {
    if (SCAN_BUSY) return;
    const raw = (code || "").trim();
    if (!raw) return;
    if (!STN_INDEX || !STN_INDEX.rows.length) { showScanCard("no STN loaded"); return; }
    SCAN_BUSY = true;
    const res = resolveScan(raw);
    let result;
    if (!res.ok) {
      result = { cls: "err", text: res.reason };
    } else if (!printConnected()) {
      result = { cls: "err", text: "Printer not connected — connect it under Direct printing." };
    } else {
      try { await sendPrint([res.row]); result = { cls: "ok", text: "Printed" }; }
      catch (e) { result = { cls: "err", text: "Print failed: " + e.message }; }
    }
    SCANS.unshift({ code: raw, item: res.item, via: res.via, row: res.ok ? res.row : null, result });
    renderScans();
    SCAN_BUSY = false;
  }

  function renderScans() {
    const tb = $("scanTbl").querySelector("tbody");
    tb.innerHTML = "";
    SCANS.slice(0, 60).forEach((s, i) => {
      const tr = document.createElement("tr");
      if (s.result.cls === "err") tr.classList.add("bad");
      const r = s.row || {};
      const src = s.via && s.via.indexOf("ref") > 0 ? " <span class=\"src\">(listing)</span>" : "";
      tr.innerHTML = '<td class="rownum">' + (SCANS.length - i) + "</td>" +
        "<td><b>" + esc(s.code) + "</b>" + src + "</td>" +
        "<td>" + esc(s.item ? s.item.sku : (r["sku code"] || "")) + "</td>" +
        "<td>" + esc(r["seller sku code"] || "") + "</td>" +
        "<td>" + esc(r.size || "") + "</td>" +
        "<td>" + esc(r.brand || "") + "</td>" +
        '<td class="' + s.result.cls + '">' + esc(s.result.text) + "</td>";
      tb.appendChild(tr);
    });
    const done = SCANS.filter((s) => s.result.cls === "ok").length;
    $("scanCount").textContent = done + " printed";
    const last = SCANS[0];
    $("scanLast").innerHTML = last
      ? '<div class="toast ' + (last.result.cls === "ok" ? "ok-toast" : "err") + '">' +
        (last.result.cls === "ok" ? "✓ " : "✕ ") + esc(last.code) +
        (last.row ? " · " + esc(last.row["seller sku code"]) + " · size " + esc(last.row.size) : "") +
        " — " + esc(last.result.text) + "</div>"
      : "";
  }

  function showScanCard(label) {
    $("scanCard").classList.remove("hidden");
    const im = window.LabelParse.itemsMeta();
    const ready = !!(STN_INDEX && STN_INDEX.rows.length);
    $("scanBadge").textContent = ready
      ? label + " · " + STN_INDEX.rows.length + " STN rows"
      : "waiting for an STN file";
    // No STN, no scanning — the box stays disabled so nothing can print.
    $("scanInput").disabled = !ready;
    $("scanInput").placeholder = ready
      ? "Scan item barcode · SKU code · seller SKU code"
      : "Upload the STN summary CSV above to start scanning";
    const notes = [];
    if (!ready) notes.push('<div class="toast warn">⚠ <b>STN required.</b> Upload the STN summary CSV(s) above — ' +
      "this tab prints only what's in that dispatch.</div>");
    if (im) notes.push('<div class="toast ok-toast">📡 Item map ready — ' + im.items.toLocaleString() +
      " item barcodes (built " + esc(im.built) + ").</div>");
    else notes.push('<div class="toast warn">⚠ Item map not loaded — item barcodes can\'t be resolved.</div>');
    if (ready && !printConnected()) notes.push('<div class="toast warn">⚠ Printer not connected — ' +
      "connect it under <b>Direct printing</b> before scanning.</div>");
    $("scanState").innerHTML = notes.join("");
    if (ready) setTimeout(() => $("scanInput").focus(), 50);
  }

  $("scanClear").addEventListener("click", () => { SCANS = []; renderScans(); $("scanInput").focus(); });
  // Scanners type the code then send Enter — treat Enter as "commit this scan".
  $("scanInput").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const v = $("scanInput").value;
    $("scanInput").value = "";
    onScan(v);
  });

  // Same barcode arriving from more than one file — legitimate when two STNs
  // ship the same SKU, but worth surfacing so nobody double-prints by accident.
  function countDupes(rows) {
    const seen = {}, dupes = {};
    rows.forEach((r) => {
      const k = (r["sku code"] || r["seller sku code"] || "").trim().toLowerCase();
      if (!k) return;
      if (seen[k]) dupes[k] = (dupes[k] || 1) + 1; else seen[k] = 1;
    });
    return Object.keys(dupes).length;
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

  function renderReview(filename, format, problems, enriched, batch) {
    $("reviewCard").classList.remove("hidden"); $("genCard").classList.remove("hidden");
    const kind = MODE === "item" ? "Item-code" : MODE === "rack" ? "Rack" : format;
    $("fileBadge").textContent = filename + " · " + kind + " · " + ROWS.length + " labels";

    const notes = [];
    if (batch && batch.files > 1) notes.push('<div class="toast ok-toast">📄 Combined ' +
      batch.files + " files into one batch of " + ROWS.length + " labels." +
      (batch.dupes ? " " + batch.dupes + " SKU(s) appear in more than one file — each prints separately." : "") +
      "</div>");
    if (batch && batch.unmapped && batch.unmapped.length) {
      notes.push('<div class="toast warn">⚠ Not recognised, left out: ' + esc(batch.unmapped.join(", ")) +
        ". Upload these on their own to map their columns.</div>");
    }
    if (enriched) notes.push('<div class="toast ok-toast">🔎 ' + enriched +
      " row(s) completed / corrected from the stored listings (size kept from your file).</div>");
    if (problems && problems.length) {
      const list = problems.slice(0, 8).map((p) => (p.file ? p.file + " " : "") +
        "row " + p.row + " (missing: " + p.missing.join(", ") + ")").join("; ");
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
      const multi = ROWS.some((r) => r._src) && new Set(ROWS.map((r) => r._src)).size > 1;
      thead.innerHTML = "<tr><th>#</th><th></th><th>Copies</th>" + (multi ? "<th>File</th>" : "") +
        "<th>Seller SKU</th><th>SKU Code (barcode)</th><th>Size</th>" +
        "<th>MRP</th><th>Brand</th><th>Article Type</th><th>Style Name</th><th>Style ID</th><th>Month &amp; Year</th></tr>";
      const req = ["seller sku code", "sku code", "size", "mrp"];
      ROWS.forEach((r, i) => {
        const tr = document.createElement("tr");
        if (req.some((c) => !r[c])) tr.classList.add("bad");
        tr.innerHTML =
          '<td class="rownum">' + (i + 1) + "</td>" + actionCell(i) +
          '<td><input class="qty" type="number" min="1" value="' + (r._qty || 1) + '" data-i="' + i + '" style="width:52px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12.5px"></td>' +
          (multi ? '<td class="src">' + esc(r._src || "") + "</td>" : "") +
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
    const base = (window._lastFile || "labels").replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(ZIP_BLOB);
    a.download = base + "_labels.zip";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
})();
