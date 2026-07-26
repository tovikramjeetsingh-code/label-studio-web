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

  // ---- render one 50x25mm label with the CHOSEN code (codeType: "qr" | "barcode") ----
  function drawItem(doc, rec, codeType) {
    const item = String(rec["item code"] || "");
    const sku = String(rec["seller sku code"] || "");
    const desc = String(rec["description"] || "");

    if (codeType === "qr") {
      // QR (2D) on the left, text on the right (y advances per wrapped line)
      const qrSize = 19, qrX = M, qrY = (PAGE_H - qrSize) / 2;
      if (item) { try { doc.addImage(qrDataURL(item), "PNG", qrX, qrY, qrSize, qrSize); } catch (e) {} }
      const rx = qrX + qrSize + 2;
      const rw = PAGE_W - M - rx;
      let y = 6.2;
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
      doc.text(item, rx, y); y += 4.2;
      doc.setFont("helvetica", "normal"); doc.setFontSize(6.8);
      doc.splitTextToSize(sku, rw).forEach((ln) => { doc.text(ln, rx, y); y += 3.0; });
      y += 0.5;
      doc.setFontSize(6.5);
      doc.splitTextToSize(desc, rw).slice(0, 2).forEach((ln) => { doc.text(ln, rx, y); y += 2.8; });
    } else {
      // Linear barcode (1D) full width on top, text below (Myntra style)
      const side = 3, bw = PAGE_W - 2 * side;
      if (item) { try { doc.addImage(window.LabelRender.barcodeDataURL(item), "PNG", side, 2, bw, 8.5); } catch (e) {} }
      doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      doc.text(item, side, 14.6);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
      doc.text(doc.splitTextToSize(sku, bw), side, 18.6);
      doc.setFontSize(7);
      doc.splitTextToSize(desc, bw).slice(0, 1).forEach((ln) => doc.text(ln, side, 22.4));
    }
  }

  function newDoc() {
    const { jsPDF } = window.jspdf;
    return new jsPDF({ orientation: "landscape", unit: "mm", format: [PAGE_W, PAGE_H], compress: true });
  }
  function buildItemDoc(rec, codeType) { const d = newDoc(); drawItem(d, rec, codeType || "barcode"); return d; }
  function buildItemDocMulti(recs, codeType) {
    const d = newDoc();
    recs.forEach((r, i) => { if (i > 0) d.addPage([PAGE_W, PAGE_H], "landscape"); drawItem(d, r, codeType || "barcode"); });
    return d;
  }

  window.ItemLabel = {
    parsePDF, qrDataURL, buildItemDoc, buildItemDocMulti,
    size: { w: PAGE_W, h: PAGE_H },
  };
})();
