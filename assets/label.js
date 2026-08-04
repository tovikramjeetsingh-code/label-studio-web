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
    // 30x60 stock, PORTRAIT and QR-only. A Code-128 of the full 16-18 char SKU
    // needs ~50mm of run, which is why this size was rotated while it carried
    // one; a QR of the same string is 25 modules square and fits the 30mm width
    // with room to spare, so the label stands upright again and the text keeps
    // the full 60mm of height.
    "30x60": { w: 30, h: 60, m: 0.8, base: 0.62, startY: 2.6, tag: "30 × 60 mm",
               sizeCap: 7, sizeVal: 20, headW: 27, mrpScale: 1.35, sellerScale: 1.3,
               sizeLead: true, noMfg: true, noStyleName: true,
               qrOnly: true, qrSize: 16, qrPad: 1.2,
               maxFit: 3.0 },
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

  // What actually goes INTO the barcode on narrow stock: the trailing digits of
  // the SKU code, which are the Myntra sku id (verified a strict suffix on all
  // 8,837 catalog SKUs). Code-128 packs digit pairs into one codeword in subset
  // C, so this fits at a scannable module width where the full string cannot.
  function codeValue(sku) {
    const m = String(sku).match(/(\d+)$/);
    return m ? m[1] : String(sku);
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

  // top of the code block at the foot of the label (QR square, or 1D barcode)
  const barTop = () => SZ.qrOnly
    ? SZ.h - SZ.m - SZ.qrPad - SZ.qrSize
    : SZ.h - SZ.m - SZ.bcPad - SZ.bcH;

  // Lay out the flowing left-column content at scale `s`. Returns the bottom y.
  // When draw is false it only measures (no ink) — used to compute the fit scale.
  // Two-column layout for the wide (rotated) stock. Font size there is limited
  // by LINE COUNT, not width: ~14 single-field lines in 21mm forces ~3.7pt no
  // matter how wide the label is. Pairing short fields — and standing the two
  // addresses side by side — cuts that to ~10 lines and buys back the size.
  function layoutContent(doc, row, s, draw) {
    const b = SZ.base * s;                       // size scale x fit scale
    const left = SZ.m + 0.6;
    const rightEdge = SZ.w - SZ.m - 0.6;
    const fullW = rightEdge - left;
    const headW = Math.min(SZ.headW, fullW);
    const g = (k) => (row[k] == null ? "" : row[k]);
    let y = SZ.startY;

    // Narrow stock has no room for a top-right SIZE box beside the text, so the
    // size leads the flow instead — nothing can collide with it.
    if (SZ.sizeLead) {
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
    if (!SZ.noStyleName) {
      y = labelValue(doc, left, y, headW, 8 * b, "Style Name:", g("style name"), draw);
    }
    y = labelValue(doc, left, y, headW, 8 * b, "Style ID:", g("style id"), draw);
    y = labelValue(doc, left, y, headW, 8 * b, "Month & Year:", g("month & year of manufacture"), draw);
    y = labelValue(doc, left, y, headW, 8 * b, "Country of Origin:", C.COUNTRY_OF_ORIGIN, draw);

    let cy = Math.max(y, 13 * SZ.base) + 1.2 * b;
    const ss = SZ.sellerScale || 1;
    cy = labelValue(doc, left, cy, fullW, 8 * b * ss, "Seller SKU:", g("seller sku code"), draw) + 1.0 * b;

    // MRP
    const ms = SZ.mrpScale || 1;
    const mrpBaseline = cy + 3.2 * b;
    if (draw) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(9 * b * ms);
      doc.text("MRP:", left, mrpBaseline);
      let mx = left + doc.getTextWidth("MRP: ");
      const valSize = 13 * b * ms, rp = rupeeImage(), rpH = valSize * PT * 1.02, rpW = rpH * rp.ratio;
      doc.addImage(rp.url, "PNG", mx, mrpBaseline - rpH * 0.82, rpW, rpH);
      mx += rpW + 0.3;
      doc.setFont("helvetica", "bold");   // keep the amount bold, explicitly
      doc.setFontSize(valSize); doc.text(String(g("mrp")), mx, mrpBaseline);
      doc.setFont("helvetica", "normal"); doc.setFontSize(6 * b);
      doc.text("(Incl. of all Taxes)", left, mrpBaseline + 2.4 * b);
    }
    cy = mrpBaseline + 6.0 * b * ms;

    // addresses — headings wrap too, or they run into the barcode strip
    cy = wrapped(doc, left, cy, fullW, 8 * b, "bold", "Designed & Marketed By:", 0, draw) + 0.6 * b;
    cy = wrapped(doc, left, cy, fullW, 5.5 * b, "normal", C.DESIGNED_BY, 0, draw) + 1.4 * b;
    if (!SZ.noMfg) {
      cy = wrapped(doc, left, cy, fullW, 8 * b, "bold", "Manufactured & Packed By:", 0, draw) + 0.6 * b;
      cy = wrapped(doc, left, cy, fullW, 5.5 * b, "normal", C.MANUFACTURED_BY, 0, draw);
    }
    return cy;
  }

  function drawLabel(doc, row) {
    const g = (k) => (row[k] == null ? "" : row[k]);
    const sku = String(g("sku code"));
    const BC_TOP = barTop();
    const textFloor = BC_TOP;
    // Fit by searching for the largest scale that genuinely fits, re-measuring
    // at each candidate. Height is NOT linear in the scale: smaller text wraps
    // into fewer lines, so a single measurement at s=1 over-estimates badly and
    // over-shrinks (raising the base font then made the print SMALLER, not
    // bigger). maxFit lets narrow stock grow into leftover space; the 60x83
    // keeps maxFit 1 so its long-standing layout is untouched.
    const avail = textFloor - SZ.startY - 0.6;
    const fits = (k) => layoutContent(doc, row, k, false) - SZ.startY <= avail;
    const top = SZ.maxFit || 1;
    let s = top;
    if (!fits(top)) {
      let lo = 0.45, hi = top;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid; else hi = mid;
      }
      s = lo;
    }
    layoutContent(doc, row, s, true);

    // Wide stock keeps the top-right SIZE box; the narrow one draws SIZE inline
    // at the head of the flow (see layoutContent).
    if (!SZ.sizeLead) {
      const rightEdge = SZ.w - SZ.m - 0.6;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(SZ.sizeCap); doc.text("SIZE", rightEdge, SZ.startY + 0.5, { align: "right" });
      doc.setFontSize(SZ.sizeVal);
      doc.text(String(g("size")), rightEdge, SZ.startY + SZ.sizeVal * PT * 1.15 + 1.0, { align: "right" });
    }

    if (!sku) return;
    if (SZ.qrOnly) {
      const q = SZ.qrSize, qx = (SZ.w - q) / 2, qy = BC_TOP;
      try { doc.addImage(window.ItemLabel.qrDataURL(sku), "PNG", qx, qy, q, q); } catch (e) {}
      return;
    }
    const encoded = SZ.numericCode ? codeValue(sku) : sku;
    const left = SZ.m + 0.6, fullW = SZ.w - SZ.m - 0.6 - left;
    // 2/3 of the catalog has a 9-digit sku id = 101 Code-128 modules, which needs
    // >=25.3mm to clear 2 dots per module at 203dpi (below that it stops
    // decoding). So the bars use the label's whole width, not the text column.
    // The quiet zone is thin against the die-cut, but the neighbouring label's
    // own margin keeps ~2mm of white before any adjacent ink.
    const bx = SZ.bcFull ? SZ.m : left;
    const bw = SZ.bcFull ? SZ.w - 2 * SZ.m : fullW;
    try { doc.addImage(barcodeDataURL(encoded), "PNG", bx, BC_TOP, bw, SZ.bcH); } catch (e) {}
    if (SZ.skuText !== false) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(SZ.skuPt);
      doc.text(sku, SZ.w / 2, SZ.h - SZ.m - SZ.bcPad * 0.32, { align: "center" });
    }
  }

  const sizeKeys = () => Object.keys(SIZES);
  const specOf = (key) => SIZES[key] || SIZES["60x83"];
  // Physical label as it sits on the roll (rotated stock reports the roll size).
  const sizeOf = (key) => {
    const s = specOf(key);
    return { w: s.physW || s.w, h: s.physH || s.h, tag: s.tag, rotate: !!s.rotate };
  };
  function useSize(key) { SZ = SIZES[key] || SIZES["60x83"]; return SZ; }

  function newDoc() {
    const { jsPDF } = window.jspdf;
    // jsPDF swaps a wider-than-tall format back to portrait unless told otherwise.
    const orientation = SZ.w > SZ.h ? "landscape" : "portrait";
    return new jsPDF({ unit: "mm", format: [SZ.w, SZ.h], orientation, compress: true });
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
      if (i > 0) doc.addPage([SZ.w, SZ.h], SZ.w > SZ.h ? "landscape" : "portrait");
      drawLabel(doc, row);
    });
    return doc;
  }

  window.LabelRender = { buildLabelDoc, buildLabelDocMulti, barcodeDataURL, useSize, sizeOf, specOf, sizeKeys };
})();
