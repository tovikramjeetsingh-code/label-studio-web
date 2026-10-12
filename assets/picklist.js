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
          if (!meta.created) { const mcd = line.match(/Created on:\s*(.+)/i); if (mcd) meta.created = mcd[1].replace(/\s{2,}.*$/, "").trim(); }
          if (!meta.channel) { const mc = line.match(/(Myntra[\w .\-/]*Account)/i); if (mc) meta.channel = mc[1].trim(); }
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

  // ---- split by floor: one full-page A4 picklist per floor --------------
  // Rack formats seen in the OMS export all encode the floor somewhere:
  // FL-04-Zone-…, SW-FL-01-…, Floor_2-…, or plain "Ground".
  function floorOf(rack) {
    const s = String(rack || "");
    const m = s.match(/FL[-_ ]?0*(\d+)/i) || s.match(/Floor[-_ ]?0*(\d+)/i);
    if (m) return "FL-" + String(parseInt(m[1], 10)).padStart(2, "0");
    if (/ground/i.test(s)) return "Ground";
    return "Other";
  }
  // natural sort so a rack run walks 006 < 016 < 023 … not lexically
  const natKey = (s) => String(s).split(/(\d+)/)
    .map((x) => (/^\d+$/.test(x) ? x.padStart(6, "0") : x.toLowerCase())).join("");
  function groupByFloor(rows) {
    const g = {};
    rows.forEach((r) => { const f = floorOf(r.rack); (g[f] = g[f] || []).push(r); });
    Object.values(g).forEach((list) => list.sort((a, b) => natKey(a.rack) < natKey(b.rack) ? -1 : natKey(a.rack) > natKey(b.rack) ? 1 : 0));
    const rank = (k) => k === "Ground" ? 900 : k === "Other" ? 999 : parseInt(k.replace("FL-", ""), 10);
    return Object.keys(g).sort((a, b) => rank(a) - rank(b)).map((k) => ({ floor: k, rows: g[k] }));
  }

  // Draw one floor's A4 picklist (header + Sr/SkuCode/Rack/Qty/Picked/Not-Found
  // table) into `doc`, starting on its current page; paginates and repeats the
  // column header. Used for both a single-floor doc and the combined doc.
  function drawFloorInto(doc, meta, floorLabel, rows) {
    const PW = 210, PH = 297, m = 12, right = PW - m;
    const cols = [
      { k: "sr", t: "Sr", w: 12, c: true }, { k: "sku", t: "SkuCode", w: 60 },
      { k: "rack", t: "Rack Space", w: 60 }, { k: "qty", t: "Qty", w: 16, c: true },
      { k: "pk", t: "Picked", w: 19, c: true }, { k: "nf", t: "Not Found", w: 19, c: true },
    ];
    let xx = m; cols.forEach((c) => { c.x = xx; xx += c.w; });
    const units = rows.reduce((n, r) => n + (r.qty || 0), 0);
    const rowH = 6.4, headH = 7.5;

    function titleBlock() {
      let y = m + 7;
      doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(0);
      doc.text("PICKLIST — " + floorLabel, m, y); y += 6.5;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(70);
      const l1 = [meta.packlog ? "PackLog #" + meta.packlog : "", meta.warehouse, meta.channel].filter(Boolean).join("   ·   ");
      if (l1) { doc.text(l1, m, y); y += 4.3; }
      const l2 = [meta.created ? "Created " + meta.created : "", rows.length + " lines · " + units + " units", "Picker: ______________"].filter(Boolean).join("   ·   ");
      doc.text(l2, m, y); doc.setTextColor(0); return y + 4.5;
    }
    function colHead(y) {
      doc.setFillColor(34, 34, 34); doc.rect(m, y, right - m, headH, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(255);
      cols.forEach((c) => doc.text(c.t, c.c ? c.x + c.w / 2 : c.x + 1.8, y + headH / 2 + 1.4, c.c ? { align: "center" } : undefined));
      doc.setTextColor(0); return y + headH;
    }
    let y = colHead(titleBlock());
    rows.forEach((r, i) => {
      if (y + rowH > PH - m) { doc.addPage("a4", "portrait"); y = colHead(m + 2); }
      if (i % 2) { doc.setFillColor(244, 244, 244); doc.rect(m, y, right - m, rowH, "F"); }
      const v = { sr: String(i + 1), sku: r.sku, rack: r.rack, qty: String(r.qty), pk: "", nf: "" };
      cols.forEach((c) => {
        let txt = v[c.k] || "";
        doc.setFont("helvetica", c.k === "sku" ? "bold" : "normal");
        let fs = c.k === "qty" ? 10.5 : (c.k === "sku" ? 9.5 : 9); doc.setFontSize(fs);
        while (txt && doc.getTextWidth(txt) > c.w - 3 && fs > 6) { fs -= 0.3; doc.setFontSize(fs); }
        const ty = y + rowH / 2 + 1.3;
        if (c.c) doc.text(txt, c.x + c.w / 2, ty, { align: "center" }); else doc.text(txt, c.x + 1.8, ty);
      });
      doc.setDrawColor(180); doc.setLineWidth(0.2); doc.rect(m, y, right - m, rowH);
      cols.forEach((c) => { if (c.x > m) doc.line(c.x, y, c.x, y + rowH); });
      y += rowH;
    });
  }
  const newA4 = () => new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  function buildFloorPicklistDoc(meta, floorLabel, rows) {
    const doc = newA4(); drawFloorInto(doc, meta, floorLabel, rows); return doc;
  }
  // All floors in ONE doc, each starting on a new page — for in-app preview and
  // printing the whole set in one go.
  function buildFloorPicklistCombined(meta, groups) {
    const doc = newA4();
    groups.forEach((g, i) => { if (i > 0) doc.addPage("a4", "portrait"); drawFloorInto(doc, meta, g.floor, g.rows); });
    return doc;
  }

  window.Picklist = {
    parsePicklist, buildPicklistDoc, buildPicklistPages, rowsPerPage, size: DEF,
    floorOf, groupByFloor, buildFloorPicklistDoc, buildFloorPicklistCombined,
  };
})();
