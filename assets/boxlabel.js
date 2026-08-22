// Invoice PDF -> 4x6" box stickers. Reads the SAP tax invoice with PDF.js and
// puts the two numbers the warehouse actually needs on the carton — the
// invoice number and the STN (the invoice prints it as "STR No.") — big and
// barcoded, with the dispatch details underneath.
//
// One sticker per box: the box count on the tab is how many copies print.
(function () {
  const DEF = { w: 101.6, h: 152.4 };   // 4 x 6 inches
  const M = 5;

  // ---- parse -------------------------------------------------------------
  // The header is a two-column block, so a visual line carries both fields
  // ("Invoice No. : SAP-12/2026-27   STR No. : STNOPWJGN090826-00"). Rebuild
  // the lines from PDF.js text items, then read each field off the joined text.
  const VAL = "([A-Za-z0-9][A-Za-z0-9./_-]*)";

  // Each visual line keeps its text items and their x, because the invoice is
  // laid out in two columns (billed-to | shipped-to) that a joined string
  // cannot be separated back into.
  async function pdfLines(file) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const out = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const rows = new Map();
      tc.items.forEach((it) => {
        const s = String(it.str || "").trim();
        if (!s) return;
        const y = Math.round(it.transform[5]);
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y).push({ x: it.transform[4], s });
      });
      [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, items]) => {
        const its = items.sort((a, b) => a.x - b.x);
        out.push({ items: its, text: its.map((i) => i.s).join(" ").replace(/\s+/g, " ").trim() });
      });
    }
    return out;
  }

  // Fields sit on shared lines ("Place of Supply : Haryana (06)  STR Type : INWARD"),
  // so a value runs until the next "Label :" starts.
  const UNTIL = "(.+?)(?=\\s+[A-Z][A-Za-z./ ]*\\s*:|$)";

  async function parseInvoice(file) {
    const lines = await pdfLines(file);
    const all = lines.map((l) => l.text).join("\n");
    const one = (re) => (all.match(re) || [])[1] || "";
    const inv = {
      invoice:   one(new RegExp("Invoice\\s*No\\.?\\s*:?\\s*" + VAL, "i")),
      // the SAP invoice labels it "STR No."; the team calls it the STN
      stn:       one(new RegExp("ST[RN]\\s*No\\.?\\s*:?\\s*" + VAL, "i")),
      date:      one(/Dated\s*:?\s*([0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4})/i),
      status:    one(new RegExp("ST[RN]\\s*Status\\s*:?\\s*" + UNTIL, "im")),
      type:      one(new RegExp("ST[RN]\\s*Type\\s*:?\\s*" + UNTIL, "im")),
      place:     one(new RegExp("Place of Supply\\s*:?\\s*" + UNTIL, "im")),
      qty:       one(/Grand\s*Total\s*([\d,]+(?:\.\d+)?)\s*Units/i),
      seller:    (lines.map((l) => l.text).find((t) => /Pvt\.?\s*Ltd|Private Limited/i.test(t)) || "").trim(),
      shipTo:    shipTo(lines),
      src:       file.name,
      packing:   "",
      boxes:     1,
    };
    if (!inv.invoice && !inv.stn) throw new Error("no invoice number or STN found in this PDF");
    return inv;
  }

  // "Shipped to" is the right-hand column of the address block. Take only the
  // items at or right of where its heading starts, so the billed-to column on
  // the same visual line is left behind.
  function shipTo(lines) {
    const i = lines.findIndex((l) => /Shipped\s*to\s*:/i.test(l.text));
    if (i < 0) return [];
    const head = lines[i].items.find((t) => /Shipped/i.test(t.s));
    const x0 = head ? head.x - 4 : 0;
    const out = [];
    for (let k = i + 1; k < lines.length && out.length < 8; k++) {
      if (/Description of Goods|HSN\s*\/\s*SAC|Grand\s*Total|Terms\s*&/i.test(lines[k].text)) break;
      const t = lines[k].items.filter((it) => it.x >= x0).map((it) => it.s)
        .join(" ").replace(/\s+/g, " ").trim();
      // a tax id is not an address, and the block ends with a stray "Rs."
      if (!t || /GSTIN|UIN/i.test(t)) continue;
      if (/^(Rs\.?|Amount|Code)$/i.test(t)) break;
      out.push(t);
    }
    return out;
  }

  // ---- render ------------------------------------------------------------
  function fit(doc, text, maxW, startPt, minPt) {
    let pt = startPt;
    doc.setFontSize(pt);
    while (pt > minPt && doc.getTextWidth(text) > maxW) { pt -= 0.5; doc.setFontSize(pt); }
    return pt;
  }

  function barcode(value) {
    const cv = document.createElement("canvas");
    JsBarcode(cv, String(value), {
      format: "CODE128", displayValue: false, width: 2, height: 90,
      margin: 4, background: "#ffffff", lineColor: "#000000",
    });
    return cv.toDataURL("image/png");
  }

  // A caption, the value as large as it will go, and a barcode of the same
  // string so it can be scanned off the carton. Returns the y below the block.
  function numberBlock(doc, left, right, y, caption, value, bcH) {
    const full = right - left;
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text(caption, left, y);
    y += 10.5;
    doc.setFont("helvetica", "bold");
    fit(doc, value, full, 30, 11);
    doc.text(value, left, y);
    y += 3.2;
    try { doc.addImage(barcode(value), "PNG", left, y, full, bcH); } catch (e) {}
    return y + bcH;
  }

  function drawBox(doc, inv, size) {
    const W = size.w, H = size.h;
    const left = M, right = W - M, full = right - left;

    let y = M + 5.5;
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text("BOX LABEL", left, y);
    y += 2.5;
    doc.setDrawColor(0); doc.setLineWidth(0.6);
    doc.line(left, y, right, y);

    y += 6;
    if (inv.seller) {
      doc.setFont("helvetica", "bold");
      fit(doc, inv.seller, full, 12.5, 8);
      doc.text(inv.seller, left, y);
      y += 4.6;
    }
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    const head = [];
    if (inv.date) head.push("Dated " + inv.date);
    if (inv.place) head.push(inv.place);
    doc.text(head.join("  ·  "), left, y);

    y += 9;
    if (inv.invoice) y = numberBlock(doc, left, right, y, "INVOICE NO.", inv.invoice, 12.5) + 10;
    if (inv.stn) y = numberBlock(doc, left, right, y, "STN / STR NO.", inv.stn, 12.5) + 6;

    // Typed on the tab, not on the invoice: the portal's packing list number.
    if (inv.packing) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      doc.text("PACKING LIST NO.", left, y);
      y += 9;
      doc.setFont("helvetica", "bold");
      fit(doc, inv.packing, full, 22, 9);
      doc.text(inv.packing, left, y);
      y += 6;
    }

    // dispatch details
    doc.setLineWidth(0.4); doc.line(left, y, right, y);
    y += 5.5;
    const cells = [];
    if (inv.type) cells.push(["TYPE", inv.type]);
    if (inv.status) cells.push(["STATUS", inv.status]);
    const cw = full / Math.max(1, cells.length);
    cells.forEach((c, i) => {
      const x = left + i * cw;
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
      doc.text(c[0], x, y);
      doc.setFont("helvetica", "bold");
      fit(doc, c[1], cw - 2, 10.5, 7);
      doc.text(c[1], x, y + 4.6);
    });
    y += 8;

    // shipped-to, bottom-anchored so every sticker's address sits in one place
    if (inv.shipTo.length) {
      doc.setLineWidth(0.4); doc.line(left, y, right, y);
      let ty = y + 5;
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
      doc.text("SHIPPED TO", left, ty);
      ty += 4.4;
      // Wrap rather than shrink to nothing: a Khasra-number address is one very
      // long line, and only what fits above the label edge is printed.
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
      const wrapped = [];
      inv.shipTo.forEach((l) => doc.splitTextToSize(l, full).forEach((w) => wrapped.push(w)));
      const room = Math.max(1, Math.floor((H - M - ty) / 3.7) + 1);
      // Short of room, keep the name and the delivering end of the address
      // (village / city / state) and drop the survey-number lines in between —
      // those are the part a courier does not read.
      const show = wrapped.length <= room ? wrapped
        : [wrapped[0]].concat(wrapped.slice(wrapped.length - (room - 1)));
      show.forEach((l) => { doc.text(l, left, ty); ty += 3.7; });
    }
  }

  // one single-page doc per box, in invoice order
  function buildBoxPages(list, size) {
    const s = size || DEF;
    const { jsPDF } = window.jspdf;
    const out = [];
    list.forEach((inv) => {
      const n = Math.max(1, parseInt(inv.boxes, 10) || 1);
      for (let b = 1; b <= n; b++) {
        const doc = new jsPDF({ unit: "mm", format: [s.w, s.h], orientation: "portrait", compress: true });
        drawBox(doc, inv, s);
        out.push(doc);
      }
    });
    return out;
  }

  function buildBoxDoc(list, size) {
    const s = size || DEF;
    const { jsPDF } = window.jspdf;
    let doc = null;
    list.forEach((inv) => {
      const n = Math.max(1, parseInt(inv.boxes, 10) || 1);
      for (let b = 1; b <= n; b++) {
        if (!doc) doc = new jsPDF({ unit: "mm", format: [s.w, s.h], orientation: "portrait", compress: true });
        else doc.addPage([s.w, s.h], "portrait");
        drawBox(doc, inv, s);
      }
    });
    return doc;
  }

  window.BoxLabel = { parseInvoice, buildBoxDoc, buildBoxPages, size: DEF };
})();
