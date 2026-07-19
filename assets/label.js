// Renders one 60x83mm label to a jsPDF document — vector text (Helvetica, the
// metric twin of Arial), a raster Code-128 barcode, and the ₹ glyph drawn from
// the browser font. Mirrors the layout of the original WeasyPrint Label.py.
(function () {
  const C = window.LABEL_CONFIG;
  const PT = 0.352777778;               // 1pt in mm
  const PAGE_W = 60, PAGE_H = 83, M = 1; // page + margin (mm)

  let _rupeeCache = null;                // dataURL, cached across labels

  // Draw "₹" once to a high-res transparent canvas -> dataURL + aspect ratio.
  function rupeeImage() {
    if (_rupeeCache) return _rupeeCache;
    const px = 160;
    const cv = document.createElement("canvas");
    cv.width = px; cv.height = px;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "700 120px Arial, Helvetica, sans-serif";
    const baseline = 130;
    ctx.fillText("₹", 8, baseline);
    const w = Math.max(1, Math.ceil(ctx.measureText("₹").width)) + 12;
    // crop to actual width for tight placement
    const out = document.createElement("canvas");
    out.width = w; out.height = px;
    out.getContext("2d").drawImage(cv, 0, 0);
    _rupeeCache = { url: out.toDataURL("image/png"), ratio: w / px, capTop: 20, baseline };
    return _rupeeCache;
  }

  function barcodeDataURL(value) {
    const cv = document.createElement("canvas");
    JsBarcode(cv, String(value), {
      format: "CODE128", displayValue: false,
      width: 2, height: 90, margin: 4, background: "#ffffff", lineColor: "#000000",
    });
    return cv.toDataURL("image/png");
  }

  // "Bold label: normal value" on one baseline, value wraps within maxW.
  // Returns the y AFTER the block.
  function labelValue(doc, x, y, maxW, sizePt, label, value) {
    const lh = sizePt * 1.15 * PT;
    doc.setFont("helvetica", "bold"); doc.setFontSize(sizePt);
    const labW = doc.getTextWidth(label + " ");
    doc.text(label, x, y);
    doc.setFont("helvetica", "normal");
    const firstW = maxW - labW;
    const val = String(value == null ? "" : value);
    // wrap: first line shortened by the label width, rest full width
    const words = val.split(/\s+/).filter(Boolean);
    const lines = []; let cur = "", curMax = firstW, isFirst = true;
    words.forEach((w) => {
      const trial = cur ? cur + " " + w : w;
      if (doc.getTextWidth(trial) > curMax && cur) {
        lines.push(cur); cur = w; isFirst = false; curMax = maxW;
      } else { cur = trial; }
    });
    if (cur) lines.push(cur);
    if (!lines.length) lines.push("");
    lines.forEach((ln, i) => {
      doc.text(ln, i === 0 ? x + labW : x, y + i * lh);
    });
    return y + lines.length * lh;
  }

  // plain wrapped text; returns y after
  function wrapped(doc, x, y, maxW, sizePt, style, text, color) {
    doc.setFont("helvetica", style); doc.setFontSize(sizePt);
    if (color) doc.setTextColor(color); else doc.setTextColor(0);
    const lh = sizePt * 1.15 * PT;
    const lines = doc.splitTextToSize(String(text || ""), maxW);
    lines.forEach((ln, i) => doc.text(ln, x, y + i * lh));
    doc.setTextColor(0);
    return y + lines.length * lh;
  }

  function buildLabelDoc(row) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: [PAGE_W, PAGE_H], compress: true });

    const left = M + 0.6;
    const rightEdge = PAGE_W - M - 0.6;
    const fullW = rightEdge - left;
    const headW = 40;                     // left column width (SIZE box sits right of it)

    // ---------- header: left text column ----------
    let y = 3.9;
    const g = (k) => (row[k] == null ? "" : row[k]);
    y = labelValue(doc, left, y, headW, 8, "Brand:", g("brand"));
    y = labelValue(doc, left, y, headW, 8, "Article Type:", g("article type"));
    y = labelValue(doc, left, y, headW, 8, "Style Name:", g("style name"));
    y = labelValue(doc, left, y, headW, 8, "Style ID:", g("style id"));
    y = labelValue(doc, left, y, headW, 8, "Month & Year:", g("month & year of manufacture"));
    y = labelValue(doc, left, y, headW, 8, "Country of Origin:", C.COUNTRY_OF_ORIGIN);

    // ---------- header: SIZE box (top-right) ----------
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9); doc.text("SIZE", rightEdge, 4.4, { align: "right" });
    doc.setFontSize(18); doc.text(String(g("size")), rightEdge, 11.6, { align: "right" });

    let cy = Math.max(y, 13) + 1.2;

    // ---------- seller sku ----------
    cy = labelValue(doc, left, cy, fullW, 8, "Seller SKU:", g("seller sku code")) + 1.0;

    // ---------- MRP ----------
    const mrpBaseline = cy + 3.2;
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text("MRP:", left, mrpBaseline);
    let mx = left + doc.getTextWidth("MRP: ");
    const valSize = 13;
    const rp = rupeeImage();
    const rpH = valSize * PT * 1.02;       // ~ cap height of the value
    const rpW = rpH * rp.ratio;
    doc.addImage(rp.url, "PNG", mx, mrpBaseline - rpH * 0.82, rpW, rpH);
    mx += rpW + 0.3;
    doc.setFontSize(valSize);
    doc.text(String(g("mrp")), mx, mrpBaseline);
    doc.setFont("helvetica", "normal"); doc.setFontSize(6);
    doc.text("(Incl. of all Taxes)", left, mrpBaseline + 2.4);
    cy = mrpBaseline + 6.0;

    // ---------- addresses ----------
    doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    doc.text("Designed & Marketed By:", left, cy); cy += 8 * 1.15 * PT + 0.6;
    cy = wrapped(doc, left, cy, fullW, 5.5, "normal", C.DESIGNED_BY) + 1.4;
    doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    doc.text("Manufactured & Packed By:", left, cy); cy += 8 * 1.15 * PT + 0.6;
    cy = wrapped(doc, left, cy, fullW, 5.5, "normal", C.MANUFACTURED_BY);

    // ---------- barcode (anchored at bottom) ----------
    const sku = String(g("sku code"));
    if (sku) {
      const bcW = fullW, bcH = 11.5;
      const bcX = left, bcY = PAGE_H - M - 1.5 - 4.2 - bcH;
      try {
        doc.addImage(barcodeDataURL(sku), "PNG", bcX, bcY, bcW, bcH);
      } catch (e) { /* invalid barcode chars — skip image, keep number */ }
      doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      doc.text(sku, PAGE_W / 2, PAGE_H - M - 1.8, { align: "center" });
    }
    return doc;
  }

  window.LabelRender = { buildLabelDoc, barcodeDataURL };
})();
