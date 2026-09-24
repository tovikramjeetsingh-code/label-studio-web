// Vendor sub-portal: unlock with the vendor password, search the catalog, and
// print / download the 60x83 product label. Reuses the main app's search
// (LabelParse over window.LABEL_MASTER), render (LabelRender) and print
// (LabelPrint + TSCLabel) engines — no upload, no other label types.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const SIZE = "60x83";
  const PASS_KEY = "labelStudioVendorPass_v1";
  const OFF_KEY = "labelStudioOffset_v1";
  let ROWS = [];

  // ---- decrypt the vendor catalog and hand it to the shared search engine ----
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function vendorDecrypt(passphrase) {
    const enc = window.LABEL_ENC_VENDOR;
    if (!enc) throw new Error("vendor catalog file not loaded");
    const keyMat = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64(enc.salt), iterations: enc.iters, hash: "SHA-256" },
      keyMat, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(enc.iv) }, key, b64(enc.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  async function unlock(passphrase, remember) {
    const master = await vendorDecrypt(passphrase);   // throws on wrong password
    window.LABEL_MASTER = master;                      // the shared engine reads this
    if (remember) { try { localStorage.setItem(PASS_KEY, passphrase); } catch (e) {} }
    $("lockCard").classList.add("hidden");
    $("searchCard").classList.remove("hidden");
    $("printCard").classList.remove("hidden");
    const m = master.meta || {};
    $("catBadge").textContent = (m.count ? m.count.toLocaleString() + " SKUs" : "catalog") +
      (m.built ? " · " + m.built : "");
    setTimeout(() => $("q").focus(), 50);
  }

  $("vunlock").addEventListener("click", async () => {
    const p = $("vpass").value.trim();
    if (!p) return;
    $("lockMsg").textContent = "Unlocking…";
    try { await unlock(p, true); }
    catch (e) { $("lockMsg").innerHTML = '<span style="color:var(--err)">Wrong password — try again.</span>'; }
  });
  $("vpass").addEventListener("keydown", (e) => { if (e.key === "Enter") $("vunlock").click(); });

  // auto-unlock if this device already has the password
  (async () => {
    let saved = null;
    try { saved = localStorage.getItem(PASS_KEY); } catch (e) {}
    if (saved) { try { await unlock(saved, false); } catch (e) { try { localStorage.removeItem(PASS_KEY); } catch (e2) {} } }
  })();

  // ---- search ----
  function runSearch() {
    const q = $("q").value.trim();
    if (!q) return;
    const res = window.LabelParse.searchReference(q, 400);
    ROWS = res.rows || [];
    ROWS.forEach((r) => { if (!r._qty) r._qty = 1; });
    renderRows(res.truncated);
  }
  $("qbtn").addEventListener("click", runSearch);
  $("q").addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });

  function renderRows(truncated) {
    const tb = $("tbl").querySelector("tbody"); tb.innerHTML = "";
    $("toast").innerHTML = ROWS.length
      ? (truncated ? '<div class="toast warn">Showing the first ' + ROWS.length + " matches — narrow the search for the rest.</div>" : "")
      : '<div class="toast warn">No match. Check the seller SKU / SKU code / style ID / VAN.</div>';
    ROWS.forEach((r, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td class="rownum">' + (i + 1) + "</td>" +
        '<td><a class="pv" data-i="' + i + '" style="cursor:pointer;color:var(--accent);font-weight:600">Preview</a> · ' +
        '<a class="pr" data-i="' + i + '" style="cursor:pointer;color:var(--accent);font-weight:600">Print</a> · ' +
        '<a class="dl" data-i="' + i + '" style="cursor:pointer;color:var(--accent);font-weight:600">PDF</a></td>' +
        '<td><input class="qty" type="number" min="1" value="' + (r._qty || 1) + '" data-i="' + i +
        '" style="width:52px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12.5px"></td>' +
        "<td><b>" + esc(r["seller sku code"]) + "</b></td><td>" + esc(r["sku code"]) + "</td>" +
        "<td>" + esc(r.size) + "</td><td>₹" + esc(r.mrp) + "</td><td>" + esc(r.brand) + "</td>" +
        "<td>" + esc(r["style name"]) + "</td><td>" + esc(r["style id"]) + "</td><td>" + esc(r._van || "") + "</td>";
      tb.appendChild(tr);
    });
    tb.querySelectorAll("a.pv").forEach((a) => a.addEventListener("click", () => preview(+a.dataset.i)));
    tb.querySelectorAll("a.pr").forEach((a) => a.addEventListener("click", () => printRows([ROWS[+a.dataset.i]])));
    tb.querySelectorAll("a.dl").forEach((a) => a.addEventListener("click", () => downloadOne(+a.dataset.i)));
    tb.querySelectorAll("input.qty").forEach((inp) => inp.addEventListener("change", () => {
      const v = Math.max(1, parseInt(inp.value, 10) || 1); inp.value = v; ROWS[+inp.dataset.i]._qty = v;
    }));
    $("zipBtn").classList.toggle("hidden", !ROWS.length);
    $("printAllBtn").classList.toggle("hidden", !ROWS.length);
    refreshPrintBtn();
  }

  const buildDoc = (r) => window.LabelRender.buildLabelDoc(r, SIZE);

  // ---- preview / download ----
  function preview(i) {
    $("pvFrame").src = buildDoc(ROWS[i]).output("bloburl");
    $("modal").style.display = "flex";
  }
  $("pvClose").addEventListener("click", closeModal);
  $("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeModal(); });
  function closeModal() { $("modal").style.display = "none"; $("pvFrame").src = "about:blank"; }

  function downloadOne(i) {
    const r = ROWS[i];
    const name = (r["seller sku code"] || "label").replace(/[\\/:*?"<>|]/g, "_") + ".pdf";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(buildDoc(r).output("blob"));
    a.download = name; a.click();
  }

  $("zipBtn").addEventListener("click", async () => {
    if (!ROWS.length) return;
    $("genMsg").textContent = "Building ZIP…";
    const zip = new JSZip(), used = {};
    for (let i = 0; i < ROWS.length; i++) {
      const r = ROWS[i], qty = Math.max(1, parseInt(r._qty, 10) || 1);
      const blob = buildDoc(r).output("blob");
      const base0 = (r["seller sku code"] || ("label_" + (i + 1))).replace(/[\\/:*?"<>|]/g, "_");
      for (let c = 0; c < qty; c++) {
        let base = qty > 1 ? base0 + "-" + (c + 1) : base0, name = base, n = 2;
        while (used[name]) { name = base + "_" + n; n++; }
        used[name] = 1; zip.file(name + ".pdf", blob);
      }
      if (i % 15 === 0) await new Promise((r2) => setTimeout(r2, 0));
    }
    const out = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(out); a.download = "vendor_labels.zip"; a.click();
    $("genMsg").textContent = "✅ ZIP ready.";
  });

  // ---- direct printing via QZ ----
  const LP = window.LabelPrint;
  function applyOffset() {
    let o = { x: 0, y: 0 };
    try { o = JSON.parse(localStorage.getItem(OFF_KEY)) || o; } catch (e) {}
    $("offX").value = o.x || 0; $("offY").value = o.y || 0;
    window.TSCLabel.setOffset(o.x || 0, o.y || 0);
  }
  ["offX", "offY"].forEach((id) => $(id) && $(id).addEventListener("change", () => {
    const o = { x: parseFloat($("offX").value) || 0, y: parseFloat($("offY").value) || 0 };
    try { localStorage.setItem(OFF_KEY, JSON.stringify(o)); } catch (e) {}
    window.TSCLabel.setOffset(o.x, o.y);
  }));

  function refreshPrintBtn() {
    const ready = LP && LP.isConnected() && ROWS.length > 0;
    $("printAllBtn").disabled = !ready;
    $("printAllBtn").title = (LP && LP.isConnected()) ? "" : "Connect a printer first";
  }

  $("qzConnect").addEventListener("click", async () => {
    $("qzInfo").textContent = "Connecting to QZ Tray…";
    try {
      await LP.connect();
      const printers = await LP.listPrinters();
      const sel = $("qzPrinter"); sel.innerHTML = "";
      printers.forEach((p) => { const o = document.createElement("option"); o.value = o.textContent = p; sel.appendChild(o); });
      const saved = LP.savedPrinter(); if (saved && printers.includes(saved)) sel.value = saved;
      sel.classList.remove("hidden");
      sel.addEventListener("change", () => LP.savePrinter(sel.value));
      if (sel.value) LP.savePrinter(sel.value);
      $("qzInfo").innerHTML = "✅ Connected — " + printers.length + " printer(s).";
      refreshPrintBtn();
    } catch (e) {
      $("qzInfo").innerHTML = '<span style="color:var(--err)">Could not connect to QZ Tray. Is it running?</span>';
    }
  });

  // Rasterize a jsPDF doc to a 203-dpi canvas (PDF.js), same as the main app.
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

  async function printRows(rows) {
    if (!LP || !LP.isConnected()) { $("qzInfo").innerHTML = '<span style="color:var(--warn)">Click “Connect printer” first.</span>'; $("printCard").scrollIntoView({ behavior: "smooth" }); return; }
    applyOffset();
    const printer = $("qzPrinter").value || LP.savedPrinter();
    const T = window.TSCLabel, sizeMm = window.LabelRender.sizeOf(SIZE);
    $("genMsg").textContent = "Preparing " + rows.length + " label(s)…";
    try {
      const parts = [T.bitmapHeader(sizeMm, T.prod.gap)];
      for (let i = 0; i < rows.length; i++) {
        const cv = await docToCanvas(buildDoc(rows[i]), sizeMm.w);
        parts.push(T.bitmapLabel(cv, Math.max(1, parseInt(rows[i]._qty, 10) || 1)));
        if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      await LP.printRawBytes(T.concat(parts), printer);
      $("genMsg").innerHTML = "✅ Sent " + rows.length + " label(s) to <b>" + esc(printer) + "</b>.";
    } catch (e) {
      $("genMsg").innerHTML = '<span style="color:var(--err)">Print failed: ' + esc(e.message || e) + "</span>";
    }
  }

  $("printAllBtn").addEventListener("click", () => printRows(ROWS));

  applyOffset();
})();
