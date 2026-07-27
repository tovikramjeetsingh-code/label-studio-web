// Item-code labels: read a Myntra system-generated barcode PDF (one item per
// page: item code + seller SKU + description) and regenerate each as a 50x25mm
// DUAL-code sticker — a QR (2D) and a Code-128 (1D), both encoding the item code.
(function () {
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

  const SIZES = { "50x25": { w: 50, h: 25 }, "25x15": { w: 25, h: 15 } };

  // ---- 50 x 25 mm : code + item code + seller SKU + description ----
  function draw50x25(doc, rec, codeType) {
    const W = 50, H = 25, M = 1.2;
    const item = String(rec["item code"] || ""), sku = String(rec["seller sku code"] || ""), desc = String(rec["description"] || "");
    if (codeType === "qr") {
      const qrSize = 19, qrX = M, qrY = (H - qrSize) / 2;
      if (item) { try { doc.addImage(qrDataURL(item), "PNG", qrX, qrY, qrSize, qrSize); } catch (e) {} }
      const rx = qrX + qrSize + 2, rw = W - M - rx;
      let y = 6.2;
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.text(item, rx, y); y += 4.2;
      doc.setFont("helvetica", "normal"); doc.setFontSize(6.8);
      doc.splitTextToSize(sku, rw).forEach((ln) => { doc.text(ln, rx, y); y += 3.0; });
      y += 0.5; doc.setFontSize(6.5);
      doc.splitTextToSize(desc, rw).slice(0, 2).forEach((ln) => { doc.text(ln, rx, y); y += 2.8; });
    } else {
      const side = 3, bw = W - 2 * side;
      if (item) { try { doc.addImage(window.LabelRender.barcodeDataURL(item), "PNG", side, 2, bw, 8.5); } catch (e) {} }
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.text(item, side, 14.6);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.text(doc.splitTextToSize(sku, bw), side, 18.6);
      doc.setFontSize(7); doc.splitTextToSize(desc, bw).slice(0, 1).forEach((ln) => doc.text(ln, side, 22.4));
    }
  }

  // ---- 25 x 15 mm : small — code + item code + seller SKU ----
  function draw25x15(doc, rec, codeType) {
    const W = 25, H = 15, M = 1;
    const item = String(rec["item code"] || ""), sku = String(rec["seller sku code"] || "");
    if (codeType === "qr") {
      // large QR filling the sticker height on the left; item code + SKU on the right
      const qrSize = 11.8, qrX = 0.8, qrY = (H - qrSize) / 2;
      if (item) { try { doc.addImage(qrDataURL(item), "PNG", qrX, qrY, qrSize, qrSize); } catch (e) {} }
      const rx = qrX + qrSize + 0.7, rw = W - 0.5 - rx;
      // item code: shrink font until it fits the column (never clips)
      doc.setFont("helvetica", "bold");
      let fs = 5.8; doc.setFontSize(fs);
      while (doc.getTextWidth(item) > rw && fs > 3.6) { fs -= 0.2; doc.setFontSize(fs); }
      doc.text(item, rx, 5.2);
      doc.setFont("helvetica", "normal"); doc.setFontSize(4.4);
      let y = 8.4;
      doc.splitTextToSize(sku, rw).slice(0, 3).forEach((ln) => { doc.text(ln, rx, y); y += 2.3; });
    } else {
      const side = 1, bw = W - 2 * side;
      if (item) { try { doc.addImage(window.LabelRender.barcodeDataURL(item), "PNG", side, 1.5, bw, 6.5); } catch (e) {} }
      doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.text(item, W / 2, 11.3, { align: "center" });
      doc.setFont("helvetica", "normal"); doc.setFontSize(5.5);
      doc.text(doc.splitTextToSize(sku, bw).slice(0, 1), W / 2, 14.2, { align: "center" });
    }
  }

  function drawItem(doc, rec, codeType, sizeKey) {
    const ct = codeType || "barcode";
    if (sizeKey === "25x15") draw25x15(doc, rec, ct); else draw50x25(doc, rec, ct);
  }

  // ---- free-style rack label 25 x 15 mm : 1D barcode or 2D QR + code (+ caption) ----
  function drawRack(doc, rec, codeType) {
    const W = 25, H = 15, side = 1, bw = W - 2 * side;
    const code = String(rec.code || ""), sub = String(rec.sub || "");
    if (codeType === "qr") {
      const qrSize = 11.8, qrX = 0.8, qrY = (H - qrSize) / 2;
      if (code) { try { doc.addImage(qrDataURL(code), "PNG", qrX, qrY, qrSize, qrSize); } catch (e) {} }
      const rx = qrX + qrSize + 0.7, rw = W - 0.5 - rx;
      doc.setFont("helvetica", "bold");
      let fs = 7; doc.setFontSize(fs);
      while (doc.getTextWidth(code) > rw && fs > 3.6) { fs -= 0.2; doc.setFontSize(fs); }
      doc.text(code, rx, sub ? 5.5 : 8.4);
      if (sub) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(4.6);
        let y = 8.6; doc.splitTextToSize(sub, rw).slice(0, 3).forEach((ln) => { doc.text(ln, rx, y); y += 2.4; });
      }
    } else {
      if (code) { try { doc.addImage(window.LabelRender.barcodeDataURL(code), "PNG", side, 1.5, bw, 7); } catch (e) {} }
      doc.setFont("helvetica", "bold");
      let fs = sub ? 8.5 : 9.5; doc.setFontSize(fs);
      while (doc.getTextWidth(code) > bw && fs > 4) { fs -= 0.3; doc.setFontSize(fs); }
      doc.text(code, W / 2, sub ? 11.5 : 12.3, { align: "center" });
      if (sub) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(6);
        doc.text(doc.splitTextToSize(sub, bw).slice(0, 1), W / 2, 14.2, { align: "center" });
      }
    }
  }
  function buildRackDoc(rec, codeType) { const d = newDoc(25, 15); drawRack(d, rec, codeType || "barcode"); return d; }

  function newDoc(W, H) {
    const { jsPDF } = window.jspdf;
    return new jsPDF({ orientation: "landscape", unit: "mm", format: [W, H], compress: true });
  }
  function buildItemDoc(rec, codeType, sizeKey) {
    const s = SIZES[sizeKey] || SIZES["50x25"];
    const d = newDoc(s.w, s.h); drawItem(d, rec, codeType, sizeKey); return d;
  }
  function buildItemDocMulti(recs, codeType, sizeKey) {
    const s = SIZES[sizeKey] || SIZES["50x25"];
    const d = newDoc(s.w, s.h);
    recs.forEach((r, i) => { if (i > 0) d.addPage([s.w, s.h], "landscape"); drawItem(d, r, codeType, sizeKey); });
    return d;
  }

  window.ItemLabel = {
    parsePDF, qrDataURL, buildItemDoc, buildItemDocMulti, buildRackDoc,
    SIZES, sizeOf: (k) => SIZES[k] || SIZES["50x25"],
  };
})();
