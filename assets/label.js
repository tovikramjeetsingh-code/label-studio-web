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
  function labelValue(doc, x, y, maxW, sizePt, label, value, draw) {
    const lh = sizePt * 1.15 * PT;
    doc.setFont("helvetica", "bold"); doc.setFontSize(sizePt);
    const labW = doc.getTextWidth(label + " ");
    if (draw !== false) doc.text(label, x, y);
    doc.setFont("helvetica", "normal");
    const firstW = maxW - labW;
    const val = String(value == null ? "" : value);
    // wrap: first line shortened by the label width, rest full width
    const words = val.split(/\s+/).filter(Boolean);
    const lines = []; let cur = "", curMax = firstW;
    words.forEach((w) => {
      const trial = cur ? cur + " " + w : w;
      if (doc.getTextWidth(trial) > curMax && cur) {
        lines.push(cur); cur = w; curMax = maxW;
      } else { cur = trial; }
    });
    if (cur) lines.push(cur);
    if (!lines.length) lines.push("");
    if (draw !== false) lines.forEach((ln, i) => doc.text(ln, i === 0 ? x + labW : x, y + i * lh));
    return y + lines.length * lh;
  }

  // plain wrapped text; returns y after
  function wrapped(doc, x, y, maxW, sizePt, style, text, color, draw) {
    doc.setFont("helvetica", style); doc.setFontSize(sizePt);
    if (color) doc.setTextColor(color); else doc.setTextColor(0);
    const lh = sizePt * 1.15 * PT;
    const lines = doc.splitTextToSize(String(text || ""), maxW);
    if (draw !== false) lines.forEach((ln, i) => doc.text(ln, x, y + i * lh));
    doc.setTextColor(0);
    return y + lines.length * lh;
  }

  const START_Y = 3.9;
  const BC_H = 11.5;
  const BC_TOP = PAGE_H - M - 1.5 - 4.2 - BC_H;   // barcode top (fixed, ~64.8mm)

  // Lay out the flowing left-column content at scale `s`. Returns the bottom y.
  // When draw is false it only measures (no ink) — used to compute the fit scale.
  function layoutContent(doc, row, s, draw) {
    const left = M + 0.6, rightEdge = PAGE_W - M - 0.6, fullW = rightEdge - left, headW = 40;
    const g = (k) => (row[k] == null ? "" : row[k]);
    let y = START_Y;
    y = labelValue(doc, left, y, headW, 8 * s, "Brand:", g("brand"), draw);
    y = labelValue(doc, left, y, headW, 8 * s, "Article Type:", g("article type"), draw);
    y = labelValue(doc, left, y, headW, 8 * s, "Style Name:", g("style name"), draw);
    y = labelValue(doc, left, y, headW, 8 * s, "Style ID:", g("style id"), draw);
    y = labelValue(doc, left, y, headW, 8 * s, "Month & Year:", g("month & year of manufacture"), draw);
    y = labelValue(doc, left, y, headW, 8 * s, "Country of Origin:", C.COUNTRY_OF_ORIGIN, draw);

    let cy = Math.max(y, 13) + 1.2 * s;
    cy = labelValue(doc, left, cy, fullW, 8 * s, "Seller SKU:", g("seller sku code"), draw) + 1.0 * s;

    // MRP
    const mrpBaseline = cy + 3.2 * s;
    if (draw) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(9 * s);
      doc.text("MRP:", left, mrpBaseline);
      let mx = left + doc.getTextWidth("MRP: ");
      const valSize = 13 * s, rp = rupeeImage(), rpH = valSize * PT * 1.02, rpW = rpH * rp.ratio;
      doc.addImage(rp.url, "PNG", mx, mrpBaseline - rpH * 0.82, rpW, rpH);
      mx += rpW + 0.3;
      doc.setFontSize(valSize); doc.text(String(g("mrp")), mx, mrpBaseline);
      doc.setFont("helvetica", "normal"); doc.setFontSize(6 * s);
      doc.text("(Incl. of all Taxes)", left, mrpBaseline + 2.4 * s);
    }
    cy = mrpBaseline + 6.0 * s;

    // addresses
    if (draw) { doc.setFont("helvetica", "bold"); doc.setFontSize(8 * s); doc.text("Designed & Marketed By:", left, cy); }
    cy += 8 * s * 1.15 * PT + 0.6 * s;
    cy = wrapped(doc, left, cy, fullW, 5.5 * s, "normal", C.DESIGNED_BY, 0, draw) + 1.4 * s;
    if (draw) { doc.setFont("helvetica", "bold"); doc.setFontSize(8 * s); doc.text("Manufactured & Packed By:", left, cy); }
    cy += 8 * s * 1.15 * PT + 0.6 * s;
    cy = wrapped(doc, left, cy, fullW, 5.5 * s, "normal", C.MANUFACTURED_BY, 0, draw);
    return cy;
  }

  function drawLabel(doc, row) {
    const g = (k) => (row[k] == null ? "" : row[k]);
    // fit: measure at s=1, shrink if content would collide with the barcode
    const used = layoutContent(doc, row, 1, false) - START_Y;
    const avail = BC_TOP - START_Y - 0.6;
    const s = used > avail ? Math.max(0.6, avail / used) : 1;
    layoutContent(doc, row, s, true);

    // SIZE box (top-right, unscaled)
    const rightEdge = PAGE_W - M - 0.6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9); doc.text("SIZE", rightEdge, 4.4, { align: "right" });
    doc.setFontSize(18); doc.text(String(g("size")), rightEdge, 11.6, { align: "right" });

    // barcode (fixed at bottom)
    const sku = String(g("sku code"));
    if (sku) {
      const left = M + 0.6, fullW = PAGE_W - M - 0.6 - left;
      try { doc.addImage(barcodeDataURL(sku), "PNG", left, BC_TOP, fullW, BC_H); } catch (e) {}
      doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      doc.text(sku, PAGE_W / 2, PAGE_H - M - 1.8, { align: "center" });
    }
  }

  function newDoc() {
    const { jsPDF } = window.jspdf;
    return new jsPDF({ unit: "mm", format: [PAGE_W, PAGE_H], compress: true });
  }

  // One label -> one-page doc.
  function buildLabelDoc(row) {
    const doc = newDoc();
    drawLabel(doc, row);
    return doc;
  }

  // Many labels -> one multi-page doc (one 60x83mm page per row) for a single print job.
  function buildLabelDocMulti(rows) {
    const doc = newDoc();
    rows.forEach((row, i) => {
      if (i > 0) doc.addPage([PAGE_W, PAGE_H], "portrait");
      drawLabel(doc, row);
    });
    return doc;
  }

  window.LabelRender = { buildLabelDoc, buildLabelDocMulti, barcodeDataURL };
})();
