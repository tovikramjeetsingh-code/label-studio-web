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
    density: 13,             // darkness 0..15 (tune if too light/dark)
    speed: 4,                // ips
    direction: 1,            // 0 or 1 — flip if labels print upside down
    barNarrow: 2, barWide: 4, barHeight: 64,   // Code-128 (dots)
    qrCell: 5,               // QR module size (dots)
  };

  // Printer setup is per-machine: a different printer needs its own darkness,
  // speed, feed direction and gap. These override the defaults above and are
  // sent in the header of every job.
  // media: "gap" die-cut labels | "continuous" plain roll | "bline" black mark
  G.media = "gap";
  G.tear = false;      // tear-off advances the label after printing — that extra
                       // feed reads as a blank band after the content
  function setPrinter(o) {
    if (!o) return;
    if (o.density !== undefined && o.density !== "") G.density = Math.max(0, Math.min(15, parseInt(o.density, 10) || 0));
    if (o.speed !== undefined && o.speed !== "") G.speed = Math.max(1, parseInt(o.speed, 10) || 4);
    if (o.direction !== undefined && o.direction !== "") G.direction = parseInt(o.direction, 10) ? 1 : 0;
    if (o.gap !== undefined && o.gap !== "") PROD.gap = Math.max(0, parseFloat(o.gap) || 0);
    if (o.media) G.media = o.media;
    if (o.tear !== undefined) G.tear = !!o.tear;
  }
  const printerSetup = () => ({ density: G.density, speed: G.speed, direction: G.direction,
                                gap: PROD.gap, media: G.media, tear: G.tear });

  // The media line the printer needs. Continuous stock must be told GAP 0 or the
  // printer keeps feeding while it hunts for a gap that does not exist.
  function mediaLine(gapMm) {
    const g = gapMm == null ? PROD.gap : gapMm;
    if (G.media === "continuous") return "GAP 0 mm,0 mm";
    if (G.media === "bline") return `BLINE ${g} mm,0 mm`;
    return `GAP ${g} mm,0 mm`;
  }

  // Everything that configures the printer, ahead of the label content.
  function setupLines(sizeMm, gapMm) {
    return `SIZE ${sizeMm.w} mm,${sizeMm.h} mm\r\n${mediaLine(gapMm)}\r\n` +
      `DIRECTION ${G.direction}\r\nREFERENCE 0,0\r\nSHIFT 0\r\n` +
      `SET TEAR ${G.tear ? "ON" : "OFF"}\r\nSET PEEL OFF\r\nSET CUTTER OFF\r\n` +
      `DENSITY ${G.density}\r\nSPEED ${G.speed}\r\n`;
  }

  // One-off media calibration for a printer that has never seen this stock.
  function calibrationJob(sizeMm) {
    const cmd = `SIZE ${sizeMm.w} mm,${sizeMm.h} mm\r\n${mediaLine()}\r\n` +
      (G.media === "bline" ? "BLINEDETECT\r\n" : G.media === "continuous" ? "" : "GAPDETECT\r\n");
    return enc(cmd);
  }

  const D = (mm) => Math.round(mm * G.dpi / 25.4);   // mm -> dots
  const clean = (s) => String(s == null ? "" : s).replace(/["\\\r\n]/g, " ").trim();

  // user alignment nudge (mm): +X moves content right, +Y moves it down
  const OFFSET = { x: 0, y: 0 };
  function setOffset(x, y) { OFFSET.x = parseFloat(x) || 0; OFFSET.y = parseFloat(y) || 0; }
  const offX = () => Math.max(0, D(OFFSET.x));   // REFERENCE/BITMAP x must be >= 0
  const offY = () => D(OFFSET.y);                // SHIFT accepts negative (up)

  // Redraw a label canvas with the alignment nudge applied in pixels.
  // Asking the printer to do it does not work for bitmap jobs: the image is
  // byte-padded to the full media width, so BITMAP x=n overruns the label and
  // TSPL firmware drops or clips it instead of shifting; SHIFT is a setup-level
  // command that several firmwares ignore once the CLS/PRINT loop is running.
  // Moving the pixels ourselves always works. Content pushed past an edge is
  // clipped, which is what a nudge should do anyway.
  function nudged(cv) {
    const dx = D(OFFSET.x), dy = D(OFFSET.y);
    if (!dx && !dy) return cv;
    const out = document.createElement("canvas");
    out.width = cv.width; out.height = cv.height;
    const cx = out.getContext("2d");
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, out.width, out.height);
    cx.drawImage(cv, dx, dy);
    return out;
  }

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
      `REFERENCE ${offX()},0`,
      `SHIFT ${offY()}`,
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

  // --- product label (60x83) as a raw TSPL BITMAP, rendered at 203 dpi ---
  const PROD = { gap: 3, invert: false };   // row gap (mm); flip bits if label prints inverted

  // Pack a rendered canvas into a 1-bit TSPL bitmap. Returns {wbytes,h,bytes}.
  function canvasToBitmap(canvas) {
    const w = canvas.width, h = canvas.height, wbytes = Math.ceil(w / 8);
    const img = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    const bytes = new Uint8Array(wbytes * h);
    for (let y = 0; y < h; y++) {
      for (let bx = 0; bx < wbytes; bx++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = bx * 8 + bit;
          let white = 1;
          if (x < w) {
            const i = (y * w + x) * 4;
            const a = img[i + 3];
            const lum = a === 0 ? 255 : img[i] * 0.299 + img[i + 1] * 0.587 + img[i + 2] * 0.114;
            white = lum < 128 ? 0 : 1;          // dark pixel -> print (bit 0)
          }
          if (PROD.invert) white = white ? 0 : 1;
          byte = (byte << 1) | white;
        }
        bytes[y * wbytes + bx] = byte;
      }
    }
    return { wbytes, h, bytes };
  }

  const enc = (s) => new TextEncoder().encode(s);
  function concat(parts) {
    const len = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(len);
    let o = 0; parts.forEach((p) => { out.set(p, o); o += p.length; });
    return out;
  }

  // Build a raw TSPL job (bytes) that prints the given canvases at sizeMm.
  // `copies` is a number (same for all) OR an array of per-canvas copy counts.
  function buildBitmapTSPL(canvases, sizeMm, copies, gapMm) {
    const nOf = (i) => { const c = Array.isArray(copies) ? copies[i] : copies; return Math.max(1, c || 1); };
    const gap = gapMm == null ? PROD.gap : gapMm;
    const parts = [enc(setupLines(sizeMm, gap))];
    canvases.forEach((cv, i) => {
      const { wbytes, h, bytes } = canvasToBitmap(nudged(cv));
      parts.push(enc(`CLS\r\nBITMAP 0,0,${wbytes},${h},0,`));
      parts.push(bytes);
      parts.push(enc(`\r\nPRINT 1,${nOf(i)}\r\n`));
    });
    return concat(parts);
  }

  // --- multi-up bitmap rolls (composite N labels per row, then BITMAP the row) ---
  // Geometry per size (edit to calibrate). up = labels across; mm.
  const ROLLS = {
    // 4-up butted (no gap between columns). Media stays 104mm, but the margins
    // are asymmetric: the row was landing too far right and clipping the last
    // column, so it starts 1.5mm earlier and the slack moves to the right side.
    "25x15": { up: 4, labelW: 25, labelH: 15, sideL: 0.5, sideR: 3.5, mid: 0, rowGap: 3 },
    // 3-up butted product stock, 104mm liner. sideL/sideR are asymmetric: the
    // printer loses the first few mm on the left, so the row starts further in
    // and the slack is taken off the right. Raise sideL if the first label is
    // still clipped, or use the X alignment nudge for a per-machine tweak.
    "30x60": { up: 3, labelW: 30, labelH: 60, sideL: 11, sideR: 3, mid: 0, rowGap: 3 },
  };

  // labelCanvases: one 203-dpi canvas per label (rendered at labelW wide).
  function buildMultiUpBitmapTSPL(labelCanvases, rollKey, copies) {
    const g = ROLLS[rollKey];
    const dot = (mm) => Math.round(mm * G.dpi / 25.4);
    const mediaW = mediaWidth(rollKey);
    const rowW = dot(mediaW), rowH = dot(g.labelH);
    const rows = [];
    for (let i = 0; i < labelCanvases.length; i += g.up) {
      const cv = document.createElement("canvas");
      cv.width = rowW; cv.height = rowH;
      const cx = cv.getContext("2d");
      cx.fillStyle = "#fff"; cx.fillRect(0, 0, rowW, rowH);
      for (let j = 0; j < g.up && i + j < labelCanvases.length; j++) {
        cx.drawImage(labelCanvases[i + j], dot(sideL(g) + j * (g.labelW + g.mid)), 0, dot(g.labelW), rowH);
      }
      rows.push(cv);
    }
    return buildBitmapTSPL(rows, { w: mediaW, h: g.labelH }, copies, g.rowGap);
  }

  // --- streaming primitives: build ONE raw job for a whole batch (one QZ prompt) ---
  function bitmapHeader(sizeMm, gapMm) {
    const gap = gapMm == null ? PROD.gap : gapMm;
    return enc(setupLines(sizeMm, gap));
  }
  function bitmapLabel(canvas, copies) {
    const { wbytes, h, bytes } = canvasToBitmap(nudged(canvas));
    return concat([enc(`CLS\r\nBITMAP 0,0,${wbytes},${h},0,`), bytes,
      enc(`\r\nPRINT 1,${Math.max(1, copies || 1)}\r\n`)]);
  }
  const sideL = (g) => (g.sideL == null ? g.side : g.sideL);
  const sideR = (g) => (g.sideR == null ? g.side : g.sideR);
  function mediaWidth(rollKey) {
    const g = ROLLS[rollKey];
    return sideL(g) + sideR(g) + g.up * g.labelW + (g.up - 1) * g.mid;
  }
  // Composite up to `up` label canvases into one row canvas (203 dpi).
  function compositeRow(upCanvases, rollKey) {
    const g = ROLLS[rollKey], dot = (mm) => Math.round(mm * G.dpi / 25.4);
    const cv = document.createElement("canvas");
    cv.width = dot(mediaWidth(rollKey)); cv.height = dot(g.labelH);
    const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
    upCanvases.forEach((c, j) => cx.drawImage(c, dot(sideL(g) + j * (g.labelW + g.mid)), 0, dot(g.labelW), cv.height));
    return cv;
  }

  window.TSCLabel = {
    geom: G, prod: PROD, rolls: ROLLS, setOffset, offset: OFFSET,
    setPrinter, printerSetup, setupLines, calibrationJob,
    buildItemTSPL, buildBitmapTSPL, buildMultiUpBitmapTSPL,
    bitmapHeader, bitmapLabel, compositeRow, mediaWidth, concat,
  };
})();
