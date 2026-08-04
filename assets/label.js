// Renders one 60x83mm label to a jsPDF document — vector text (Helvetica, the
// metric twin of Arial), a raster Code-128 barcode, and the ₹ glyph drawn from
// the browser font. Mirrors the layout of the original WeasyPrint Label.py.
(function () {
  const C = window.LABEL_CONFIG;
  const PT = 0.352777778;               // 1pt in mm

  // Two product-label sizes. `base` scales every font so the same field set fits
  // the narrower stock; `headW` is the wrap width of the label:value column.
  // bcPad = gap between the barcode and the SKU text printed under it.
  const SIZES = {
    "60x83": { w: 60, h: 83, m: 1.0, base: 1,    startY: 3.9, bcH: 11.5, bcPad: 5.7,
               sizeCap: 9, sizeVal: 18, headW: 40, skuPt: 9, tag: "60 × 83 mm" },
    // Barcode runs vertically down the right edge (see barcodeDataURLRot).
    // bcW = width of that strip; the text column gets what's left.
    "30x60": { w: 30, h: 60, m: 0.8, base: 0.58, startY: 2.4, bcH: 8.0,  bcPad: 3.6,
               sizeCap: 5, sizeVal: 11, headW: 18.2, skuPt: 4.4, tag: "30 × 60 mm",
               vert: true, bcW: 8.2 },
  };
  let SZ = SIZES["60x83"];              // current size spec

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

  function barcodeCanvas(value, withText) {
    const cv = document.createElement("canvas");
    JsBarcode(cv, String(value), {
      format: "CODE128", displayValue: !!withText,
      fontSize: 15, textMargin: 1, font: "Helvetica", fontOptions: "bold",
      width: 2, height: 90, margin: 4, background: "#ffffff", lineColor: "#000000",
    });
    return cv;
  }

  function barcodeDataURL(value) { return barcodeCanvas(value).toDataURL("image/png"); }

  // Quarter-turn copy, so the bars can run along the label's LONG axis. On
  // 30mm-wide stock a 17-char SKU needs ~189 modules; across 27mm that is under
  // one dot at 203dpi and will not scan, but down 60mm it clears 2 dots.
  // The human-readable code is baked in BEFORE rotating, so it can never drift
  // out of the strip the way a separately-rotated text run can.
  function barcodeDataURLRot(value) {
    const src = barcodeCanvas(value, true);
    const out = document.createElement("canvas");
    out.width = src.height; out.height = src.width;
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, out.width, out.height);
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    return out.toDataURL("image/png");
  }

  // "Bold label: normal value" on one baseline, value wraps within maxW.
  // Returns the y AFTER the block.
  function labelValue(doc, x, y, maxW, sizePt, label, value, draw) {
    const lh = sizePt * 1.15 * PT;
    doc.setFont("helvetica", "bold"); doc.setFontSize(sizePt);
    const labW = doc.getTextWidth(label + " ");
    if (draw !== false) doc.text(label, x, y);
    doc.setFont("helvetica", "normal");
    // On narrow stock the bold label can eat the whole column; when too little
    // room is left the value starts on its own line instead of running off.
    const inline = labW < maxW * 0.72;
    const firstW = inline ? maxW - labW : maxW;
    const val = String(value == null ? "" : value);
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
    // A single unbreakable token (a seller SKU) can still be wider than the
    // column; split it on characters so it can never run past the text area.
    for (let i = 0; i < lines.length; i++) {
      const lim = (inline && i === 0) ? firstW : maxW;
      if (doc.getTextWidth(lines[i]) <= lim) continue;
      const parts = doc.splitTextToSize(lines[i], lim);
      lines.splice(i, 1, ...parts);
      i += parts.length - 1;
    }
    if (draw !== false) {
      lines.forEach((ln, i) => {
        const lx = (inline && i === 0) ? x + labW : x;
        const ly = y + (inline ? i : i + 1) * lh;
        doc.text(ln, lx, ly);
      });
    }
    return y + (inline ? lines.length : lines.length + 1) * lh;
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

  const barTop = () => SZ.h - SZ.m - SZ.bcPad - SZ.bcH;   // barcode top (fixed)

  // Lay out the flowing left-column content at scale `s`. Returns the bottom y.
  // When draw is false it only measures (no ink) — used to compute the fit scale.
  function layoutContent(doc, row, s, draw) {
    const b = SZ.base * s;                       // size scale x fit scale
    const left = SZ.m + 0.6;
    // A vertical barcode eats a strip off the right, so the text column narrows.
    const rightEdge = SZ.w - SZ.m - 0.6 - (SZ.vert ? SZ.bcW + 0.8 : 0);
    const fullW = rightEdge - left;
    const headW = Math.min(SZ.headW, fullW);
    const g = (k) => (row[k] == null ? "" : row[k]);
    let y = SZ.startY;

    // Narrow stock has no room for a top-right SIZE box beside the text, so the
    // size leads the flow instead — nothing can collide with it.
    if (SZ.vert) {
      const cap = SZ.sizeCap * s, val = SZ.sizeVal * s;
      const baseline = y + val * PT;
      if (draw) {
        doc.setFont("helvetica", "bold"); doc.setFontSize(cap);
        doc.text("SIZE", left, baseline);
        const capW = doc.getTextWidth("SIZE ");
        doc.setFontSize(val);
        doc.text(String(g("size")), left + capW, baseline);
      }
      y = baseline + 8 * b * 1.15 * PT;      // clear the big digit's descender
    }

    y = labelValue(doc, left, y, headW, 8 * b, "Brand:", g("brand"), draw);
    y = labelValue(doc, left, y, headW, 8 * b, "Article Type:", g("article type"), draw);
    y = labelValue(doc, left, y, headW, 8 * b, "Style Name:", g("style name"), draw);
    y = labelValue(doc, left, y, headW, 8 * b, "Style ID:", g("style id"), draw);
    y = labelValue(doc, left, y, headW, 8 * b, "Month & Year:", g("month & year of manufacture"), draw);
    y = labelValue(doc, left, y, headW, 8 * b, "Country of Origin:", C.COUNTRY_OF_ORIGIN, draw);

    let cy = Math.max(y, 13 * SZ.base) + 1.2 * b;
    cy = labelValue(doc, left, cy, fullW, 8 * b, "Seller SKU:", g("seller sku code"), draw) + 1.0 * b;

    // MRP
    const mrpBaseline = cy + 3.2 * b;
    if (draw) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(9 * b);
      doc.text("MRP:", left, mrpBaseline);
      let mx = left + doc.getTextWidth("MRP: ");
      const valSize = 13 * b, rp = rupeeImage(), rpH = valSize * PT * 1.02, rpW = rpH * rp.ratio;
      doc.addImage(rp.url, "PNG", mx, mrpBaseline - rpH * 0.82, rpW, rpH);
      mx += rpW + 0.3;
      doc.setFontSize(valSize); doc.text(String(g("mrp")), mx, mrpBaseline);
      doc.setFont("helvetica", "normal"); doc.setFontSize(6 * b);
      doc.text("(Incl. of all Taxes)", left, mrpBaseline + 2.4 * b);
    }
    cy = mrpBaseline + 6.0 * b;

    // addresses — headings wrap too, or they run into the barcode strip
    cy = wrapped(doc, left, cy, fullW, 8 * b, "bold", "Designed & Marketed By:", 0, draw) + 0.6 * b;
    cy = wrapped(doc, left, cy, fullW, 5.5 * b, "normal", C.DESIGNED_BY, 0, draw) + 1.4 * b;
    cy = wrapped(doc, left, cy, fullW, 8 * b, "bold", "Manufactured & Packed By:", 0, draw) + 0.6 * b;
    cy = wrapped(doc, left, cy, fullW, 5.5 * b, "normal", C.MANUFACTURED_BY, 0, draw);
    return cy;
  }

  function drawLabel(doc, row) {
    const g = (k) => (row[k] == null ? "" : row[k]);
    const sku = String(g("sku code"));
    // Vertical-barcode stock has the full page height for text; on the wide
    // stock the text must stop above the horizontal barcode.
    const BC_TOP = barTop();
    const textFloor = SZ.vert ? SZ.h - SZ.m : BC_TOP;
    // fit: measure at s=1, shrink if content would overrun the space available
    const used = layoutContent(doc, row, 1, false) - SZ.startY;
    const avail = textFloor - SZ.startY - 0.6;
    const s = used > avail ? Math.max(0.6, avail / used) : 1;
    layoutContent(doc, row, s, true);

    // Wide stock keeps the top-right SIZE box; the narrow one draws SIZE inline
    // at the head of the flow (see layoutContent).
    if (!SZ.vert) {
      const rightEdge = SZ.w - SZ.m - 0.6;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(SZ.sizeCap); doc.text("SIZE", rightEdge, SZ.startY + 0.5, { align: "right" });
      doc.setFontSize(SZ.sizeVal);
      doc.text(String(g("size")), rightEdge, SZ.startY + SZ.sizeVal * PT * 1.15 + 1.0, { align: "right" });
    }

    if (!sku) return;
    if (SZ.vert) {
      // Bars run down the right edge; the SKU text is rotated to sit beside them.
      const bx = SZ.w - SZ.m - SZ.bcW, by = SZ.m + 1.0;
      const bh = SZ.h - by - SZ.m - 1.0;
      try { doc.addImage(barcodeDataURLRot(sku), "PNG", bx, by, SZ.bcW, bh); } catch (e) {}
    } else {
      const left = SZ.m + 0.6, fullW = SZ.w - SZ.m - 0.6 - left;
      try { doc.addImage(barcodeDataURL(sku), "PNG", left, BC_TOP, fullW, SZ.bcH); } catch (e) {}
      doc.setFont("helvetica", "bold"); doc.setFontSize(SZ.skuPt);
      doc.text(sku, SZ.w / 2, SZ.h - SZ.m - SZ.bcPad * 0.32, { align: "center" });
    }
  }

  const sizeKeys = () => Object.keys(SIZES);
  const sizeOf = (key) => { const s = SIZES[key] || SIZES["60x83"]; return { w: s.w, h: s.h, tag: s.tag }; };
  function useSize(key) { SZ = SIZES[key] || SIZES["60x83"]; return SZ; }

  function newDoc() {
    const { jsPDF } = window.jspdf;
    return new jsPDF({ unit: "mm", format: [SZ.w, SZ.h], compress: true });
  }

  // One label -> one-page doc.
  function buildLabelDoc(row, sizeKey) {
    if (sizeKey) useSize(sizeKey);
    const doc = newDoc();
    drawLabel(doc, row);
    return doc;
  }

  // Many labels -> one multi-page doc (one page per row) for a single print job.
  function buildLabelDocMulti(rows, sizeKey) {
    if (sizeKey) useSize(sizeKey);
    const doc = newDoc();
    rows.forEach((row, i) => {
      if (i > 0) doc.addPage([SZ.w, SZ.h], "portrait");
      drawLabel(doc, row);
    });
    return doc;
  }

  window.LabelRender = { buildLabelDoc, buildLabelDocMulti, barcodeDataURL, useSize, sizeOf, sizeKeys };
})();
