// Item-code labels: read a Myntra system-generated barcode PDF (one item per
// page: item code + seller SKU + description) and regenerate each as a 50x25mm
// DUAL-code sticker — a QR (2D) and a Code-128 (1D), both encoding the item code.
(function () {
  const PT = 0.352777778;
  const PAGE_W = 50, PAGE_H = 25, M = 1.2;

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  }

  // ---- parse the uploaded PDF into [{item, sku, desc}] ----
  function linesFrom(textContent) {
    const rows = {};
    textContent.items.forEach((it) => {
      const s = (it.str || "").trim();
      if (!s) return;
      const y = Math.round(it.transform[5]);      // vertical position
      (rows[y] = rows[y] || []).push({ x: it.transform[4], s });
    });
    return Object.keys(rows)
      .sort((a, b) => b - a)                        // top of page first
      .map((y) => rows[y].sort((a, b) => a.x - b.x).map((o) => o.s).join(" ").trim())
      .filter(Boolean);
  }

  function recordFromLines(lines) {
    if (!lines.length) return null;
    const itemIdx = Math.max(0, lines.findIndex((l) => /^IB\w*\d/i.test(l)));
    const item = lines[itemIdx];
    const rest = lines.filter((_, i) => i !== itemIdx);
    return {
      "item code": item || "",
      "seller sku code": rest[0] || "",
      "description": rest.slice(1).join(" ") || "",
      _filename: (item || "item").replace(/[\\/:*?"<>|]/g, "_"),
    };
  }

  async function parsePDF(file) {
    if (!window.pdfjsLib) throw new Error("PDF reader failed to load.");
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const out = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const rec = recordFromLines(linesFrom(await page.getTextContent()));
      if (rec && rec["item code"]) out.push(rec);
    }
    if (!out.length) throw new Error("No item codes found in this PDF — is it a Myntra barcode sheet?");
    // enrich description/sku from the stored listing when the seller SKU matches
    const m = window.LABEL_MASTER;
    out.forEach((r) => {
      if (!m) return;
      const key = (r["seller sku code"] || "").trim().toLowerCase();
      const idx = key && key in m.bySeller ? m.bySeller[key] : undefined;
      if (idx === undefined) return;
      const rec = m.records[idx];
      if (!r["description"] && rec.sn) r["description"] = rec.sn;   // fill only if blank
    });
    return out;
  }

  // ---- codes ----
  function qrDataURL(text) {
    const qr = qrcode(0, "M");
    qr.addData(String(text));
    qr.make();
    const n = qr.getModuleCount(), cell = 8, margin = 2;
    const size = (n + margin * 2) * cell;
    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
    }
    return cv.toDataURL("image/png");
  }

  // ---- render one 50x25mm dual-code label ----
  function drawItem(doc, rec) {
    const item = String(rec["item code"] || "");
    const sku = String(rec["seller sku code"] || "");
    const desc = String(rec["description"] || "");

    // QR on the left (square, ~20mm)
    const qrSize = 20, qrX = M, qrY = (PAGE_H - qrSize) / 2;
    if (item) { try { doc.addImage(qrDataURL(item), "PNG", qrX, qrY, qrSize, qrSize); } catch (e) {} }

    // right column
    const rx = qrX + qrSize + 1.5;
    const rw = PAGE_W - M - rx;

    // 1D barcode on top of the right column
    if (item) {
      try { doc.addImage(window.LabelRender.barcodeDataURL(item), "PNG", rx, 1.8, rw, 6.5); } catch (e) {}
    }
    // item code (human readable), bold
    doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    doc.text(item, rx, 11.6);
    // seller sku
    doc.setFont("helvetica", "normal"); doc.setFontSize(7);
    doc.text(doc.splitTextToSize(sku, rw), rx, 15.4);
    // description (wraps)
    doc.setFontSize(6.2);
    const dLines = doc.splitTextToSize(desc, rw).slice(0, 2);
    dLines.forEach((ln, i) => doc.text(ln, rx, 19.2 + i * 2.4));
  }

  function newDoc() {
    const { jsPDF } = window.jspdf;
    return new jsPDF({ orientation: "landscape", unit: "mm", format: [PAGE_W, PAGE_H], compress: true });
  }
  function buildItemDoc(rec) { const d = newDoc(); drawItem(d, rec); return d; }
  function buildItemDocMulti(recs) {
    const d = newDoc();
    recs.forEach((r, i) => { if (i > 0) d.addPage([PAGE_W, PAGE_H], "landscape"); drawItem(d, r); });
    return d;
  }

  window.ItemLabel = {
    parsePDF, qrDataURL, buildItemDoc, buildItemDocMulti,
    size: { w: PAGE_W, h: PAGE_H },
  };
})();
