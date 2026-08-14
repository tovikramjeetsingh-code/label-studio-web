// Picklist PDF -> 4x6" pick stickers. Reads the OMS "Picklist" export with
// PDF.js, keeps SkuCode / RackSpace / quantity, and lays them out as a compact
// list the picker carries instead of an A4 sheet.
//
// Quantity is the report's "Good" column: it sums exactly to the footer Total on
// every sample checked, so it is the amount to pick (Bad/Picked/Not Found are
// outcome columns, not demand).
(function () {
  const PT = 0.352777778;
  const DEF = { w: 101.6, h: 152.4 };  // 4 x 6 inches
  const M = 4;

  // ---- parse -------------------------------------------------------------
  // Rebuild visual rows from PDF.js text items: group by y, order by x.
  async function parsePicklist(file) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const rows = [];
    const meta = {};
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const lines = new Map();
      tc.items.forEach((it) => {
        const s = String(it.str || "").trim();
        if (!s) return;
        const x = it.transform[4], y = Math.round(it.transform[5]);
        if (!lines.has(y)) lines.set(y, []);
        lines.get(y).push({ x, s });
      });
      [...lines.entries()]
        .sort((a, b) => b[0] - a[0])                       // top of page first
        .forEach(([, items]) => {
          const toks = items.sort((a, b) => a.x - b.x).map((i) => i.s);
          const line = toks.join(" ");
          if (!meta.picklist) {
            const m = line.match(/\((\s*\d{6,}\s*)\)/);     // "( 24796509 )"
            if (m) meta.picklist = m[1].trim();
          }
          if (/PackLog\s*#/i.test(line)) meta.packlog = (line.match(/PackLog\s*#\s*(\S+)/i) || [])[1] || "";
          if (/^Warehouse:/i.test(line)) meta.warehouse = line.replace(/^Warehouse:\s*/i, "").trim();
          if (/^Total\b/i.test(toks[0] || "")) return;      // footer totals row

          // a data row ends in four integers: Good, Bad, Picked, Not Found
          if (toks.length >= 6) {
            const tail = toks.slice(-4);
            if (tail.every((t) => /^\d+$/.test(t))) {
              const sku = toks[0], rack = toks.slice(1, toks.length - 4).join(" ");
              if (sku && rack && !/^SkuCode$/i.test(sku)) {
                rows.push({ sku, rack, qty: parseInt(tail[0], 10) || 0 });
              }
            }
          }
        });
    }
    meta.lines = rows.length;
    meta.units = rows.reduce((n, r) => n + r.qty, 0);
    return { meta, rows };
  }

  // ---- render ------------------------------------------------------------
  // Everything is derived from the sticker size so a different stock lays out
  // correctly instead of being scaled to fit: rows per page follow the height,
  // and the columns follow the width.
  const FIRST_ROW_Y = 29.9;      // baseline of row 1
  const LH = 4.35;               // row pitch
  const footerRule = (h) => h - M - 8.5;
  function rowsPerPage(size) {
    const s = size || DEF;
    return Math.max(1, Math.floor((footerRule(s.h) - 2.0 - FIRST_ROW_Y) / LH) + 1);
  }

  function drawPage(doc, meta, rows, pageNo, pageCount, size) {
    const W = size.w, H = size.h;
    const left = M, right = W - M, full = right - left;
    const FOOTER_RULE = footerRule(H);
    let y = M + 5;

    doc.setFont("helvetica", "bold"); doc.setFontSize(15);
    doc.text("PICKLIST", left, y);
    if (meta.picklist) {
      doc.setFontSize(13);
      doc.text("#" + meta.picklist, right, y, { align: "right" });
    }
    y += 5.5;

    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    const bits = [];
    if (meta.packlog) bits.push("PackLog " + meta.packlog);
    if (meta.warehouse) bits.push(meta.warehouse);
    doc.text(bits.join("  ·  "), left, y);
    if (pageCount > 1) doc.text("Page " + pageNo + " of " + pageCount, right, y, { align: "right" });
    y += 4.5;

    doc.setDrawColor(0); doc.setLineWidth(0.5);
    doc.line(left, y, right, y);
    y += 4.5;

    // column heads
    // columns scale with the label width (46/32 of a 4in sticker)
    const skuW = full * 0.50, rackW = full * 0.34;
    const xSku = left, xRack = left + skuW + 2, xQty = right;
    doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    doc.text("SKU", xSku, y);
    doc.text("RACK", xRack, y);
    doc.text("QTY", xQty, y, { align: "right" });
    y += 1.8;
    doc.setLineWidth(0.3); doc.line(left, y, right, y);
    y = FIRST_ROW_Y;

    const lh = LH;
    rows.forEach((r) => {
      doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
      let sku = r.sku, fs = 9.5;
      while (doc.getTextWidth(sku) > skuW && fs > 6.5) { fs -= 0.3; doc.setFontSize(fs); }
      doc.text(sku, xSku, y);

      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
      let rack = r.rack, rf = 8.5;
      while (doc.getTextWidth(rack) > rackW && rf > 6) { rf -= 0.3; doc.setFontSize(rf); }
      doc.text(rack, xRack, y);

      doc.setFont("helvetica", "bold"); doc.setFontSize(11);
      doc.text(String(r.qty), xQty, y, { align: "right" });

      doc.setDrawColor(200); doc.setLineWidth(0.2);
      doc.line(left, y + 1.3, right, y + 1.3);
      y += lh;
    });

    // footer
    const fy = H - M - 3;
    doc.setDrawColor(0); doc.setLineWidth(0.5);
    doc.line(left, FOOTER_RULE, right, FOOTER_RULE);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text(meta.lines + " lines", left, fy);
    doc.text(meta.units + " units", right, fy, { align: "right" });
  }

  function buildPicklistDoc(parsed, size) {
    const s = size || DEF, n = rowsPerPage(s);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: [s.w, s.h], orientation: "portrait", compress: true });
    const pages = Math.max(1, Math.ceil(parsed.rows.length / n));
    for (let p = 0; p < pages; p++) {
      if (p > 0) doc.addPage([s.w, s.h], "portrait");
      drawPage(doc, parsed.meta, parsed.rows.slice(p * n, (p + 1) * n), p + 1, pages, s);
    }
    return doc;
  }

  // one single-page doc per sticker, for printing page by page
  function buildPicklistPages(parsed, size) {
    const s = size || DEF, n = rowsPerPage(s);
    const { jsPDF } = window.jspdf;
    const pages = Math.max(1, Math.ceil(parsed.rows.length / n));
    const out = [];
    for (let p = 0; p < pages; p++) {
      const doc = new jsPDF({ unit: "mm", format: [s.w, s.h], orientation: "portrait", compress: true });
      drawPage(doc, parsed.meta, parsed.rows.slice(p * n, (p + 1) * n), p + 1, pages, s);
      out.push(doc);
    }
    return out;
  }

  window.Picklist = { parsePicklist, buildPicklistDoc, buildPicklistPages, rowsPerPage, size: DEF };
})();
