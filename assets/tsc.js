// TSPL generator for the TSC TE244 (203 dpi) — 2-up 50x25mm item-code roll.
// Sends raw printer commands via QZ Tray: the printer self-configures label
// SIZE/GAP, so no per-machine driver setup. Two labels are placed per physical
// row; the printer advances one row (25mm + 3mm gap) per PRINT.
(function () {
  // --- roll geometry (edit here to calibrate after a test print) ---
  const G = {
    dpi: 203,
    labelW: 50, labelH: 25,   // one label, mm
    sideOffset: 3,            // left/right margin, mm
    midGap: 1,                // gap between the two columns, mm
    rowGap: 3,                // gap between rows, mm
    mediaW: 107,              // 3 + 50 + 1 + 50 + 3
    density: 10,             // darkness 0..15 (tune if too light/dark)
    speed: 4,                // ips
    direction: 1,            // 0 or 1 — flip if labels print upside down
    barNarrow: 2, barWide: 4, barHeight: 64,   // Code-128 (dots)
    qrCell: 5,               // QR module size (dots)
  };

  const D = (mm) => Math.round(mm * G.dpi / 25.4);   // mm -> dots
  const clean = (s) => String(s == null ? "" : s).replace(/["\\\r\n]/g, " ").trim();

  // Commands for ONE label whose left edge is at `lx` dots.
  function labelCmds(lx, rec, codeType) {
    const item = clean(rec["item code"]);
    const sku = clean(rec["seller sku code"]);
    const desc = clean(rec["description"]);
    const pad = D(2);
    const out = [];
    if (codeType === "qr") {
      out.push(`QRCODE ${lx + pad},${D(3.5)},M,${G.qrCell},A,0,"${item}"`);
      const tx = lx + pad + D(17);
      out.push(`TEXT ${tx},${D(3)},"3",0,1,1,"${item}"`);
      out.push(`TEXT ${tx},${D(9)},"2",0,1,1,"${sku}"`);
      out.push(`TEXT ${tx},${D(13)},"2",0,1,1,"${desc}"`);
    } else {
      const bx = lx + pad;
      out.push(`BARCODE ${bx},${D(2)},"128",${G.barHeight},0,0,${G.barNarrow},${G.barWide},"${item}"`);
      out.push(`TEXT ${bx},${D(11.5)},"3",0,1,1,"${item}"`);
      out.push(`TEXT ${bx},${D(15.2)},"2",0,1,1,"${sku}"`);
      out.push(`TEXT ${bx},${D(18.6)},"2",0,1,1,"${desc}"`);
    }
    return out;
  }

  // Full TSPL job printing all records 2-up.
  function buildItemTSPL(records, codeType, copies) {
    const n = Math.max(1, copies || 1);
    const leftX = D(G.sideOffset);                       // 3mm
    const rightX = D(G.sideOffset + G.labelW + G.midGap); // 54mm
    const lines = [
      `SIZE ${G.mediaW} mm,${G.labelH} mm`,
      `GAP ${G.rowGap} mm,0 mm`,
      `DIRECTION ${G.direction}`,
      `REFERENCE 0,0`,
      `DENSITY ${G.density}`,
      `SPEED ${G.speed}`,
      `CODEPAGE 1252`,
    ];
    for (let i = 0; i < records.length; i += 2) {
      lines.push("CLS");
      lines.push(...labelCmds(leftX, records[i], codeType));
      if (records[i + 1]) lines.push(...labelCmds(rightX, records[i + 1], codeType));
      lines.push(`PRINT 1,${n}`);
    }
    return lines.join("\r\n") + "\r\n";
  }

  window.TSCLabel = { geom: G, buildItemTSPL };
})();
