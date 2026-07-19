// Parsing + format detection + stored-reference enrichment — all in the browser.
(function () {
  const C = window.LABEL_CONFIG;
  const CANON_FROM_SHORT = {
    b: "brand", a: "article type", sn: "style name", si: "style id",
    sz: "size", ss: "seller sku code", sk: "sku code", m: "mrp",
  };

  function cleanCell(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return String(v);
    let s = String(v).trim();
    if (s.toLowerCase() === "nan") return "";
    if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, "");
    return s;
  }

  function currentMonthYear() {
    const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const d = new Date();
    return m[d.getMonth()] + "-" + String(d.getFullYear()).slice(-2);
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const name = (file.name || "").toLowerCase();
      if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".xlsm")) {
        const fr = new FileReader();
        fr.onload = (e) => {
          try {
            const wb = XLSX.read(e.target.result, { type: "array" });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true, blankrows: false });
            const columns = rows.length ? Object.keys(rows[0])
              : (XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || []).map(String);
            resolve({ columns, rows });
          } catch (err) { reject(new Error("Could not read the Excel file: " + err.message)); }
        };
        fr.onerror = () => reject(new Error("Could not read the file."));
        fr.readAsArrayBuffer(file);
      } else if (name.endsWith(".csv")) {
        Papa.parse(file, {
          header: true, skipEmptyLines: "greedy",
          complete: (res) => resolve({ columns: res.meta.fields || [], rows: res.data }),
          error: (err) => reject(new Error("Could not read the CSV: " + err.message)),
        });
      } else {
        reject(new Error("Unsupported file type — upload a .csv or .xlsx file."));
      }
    });
  }

  function buildLookup(columns) {
    const lookup = {};
    columns.forEach((c) => { lookup[String(c).trim().toLowerCase().replace(/:+$/, "")] = c; });
    return lookup;
  }

  const anyVal = (row) => Object.keys(CANON_FROM_SHORT)
    .some((s) => { const c = CANON_FROM_SHORT[s]; return row[c] !== "" && row[c] != null; });

  function flagProblems(row, problems) {
    const miss = ["seller sku code", "sku code", "size", "mrp"].filter((c) => !row[c]);
    if (miss.length) problems.push({ row: row._srcrow, missing: miss });
  }

  // ---- stored reference (master) ----
  const master = () => window.LABEL_MASTER || null;

  function masterFind(row) {
    const m = master(); if (!m) return null;
    const ss = (row["seller sku code"] || "").trim().toLowerCase();
    const sk = (row["sku code"] || "").trim().toLowerCase();
    let idx = (ss && ss in m.bySeller) ? m.bySeller[ss]
            : (sk && sk in m.bySku) ? m.bySku[sk] : undefined;
    return idx === undefined ? null : m.records[idx];
  }

  // Fill blank canonical fields from the stored reference; recompute problems.
  function finalize(rows, format) {
    let enriched = 0;
    rows.forEach((row) => {
      const rec = masterFind(row);
      if (rec) {
        let did = false;
        for (const short in CANON_FROM_SHORT) {
          const canon = CANON_FROM_SHORT[short];
          if (!row[canon] && rec[short]) { row[canon] = rec[short]; did = true; }
        }
        if (did) enriched++;
      }
      if (!row["month & year of manufacture"]) row["month & year of manufacture"] = currentMonthYear();
      if (!row._filename) row._filename = row["seller sku code"];
    });
    const problems = [];
    rows.forEach((row) => flagProblems(row, problems));
    return { rows, problems, format, enriched };
  }

  // ---- canonical row builders ----
  function blankRow() {
    const row = {};
    for (const s in CANON_FROM_SHORT) row[CANON_FROM_SHORT[s]] = "";
    row["month & year of manufacture"] = "";
    return row;
  }

  function rowsFromColmap(rawRows, colmap, monthMode) {
    const out = [];
    rawRows.forEach((r, i) => {
      const row = blankRow();
      for (const canon in colmap) row[canon] = cleanCell(r[colmap[canon]]);
      if (!anyVal(row)) return;
      row._srcrow = i + 2;
      if (monthMode === "current") row["month & year of manufacture"] = currentMonthYear();
      out.push(row);
    });
    return out;
  }

  // alias-match whatever canonical columns the file happens to have
  function partialColmap(lookup) {
    const colmap = {};
    for (const canon in C.REQUIRED_COLUMNS) {
      for (const a of C.REQUIRED_COLUMNS[canon]) if (lookup[a]) { colmap[canon] = lookup[a]; break; }
    }
    return colmap;
  }

  async function parseUpload(file) {
    const { columns, rows } = await readFile(file);
    if (!rows.length) throw new Error("The file has no data rows.");
    const lookup = buildLookup(columns);
    const hasAll = (sig) => sig.every((s) => s in lookup);

    // 1. Myntra STN Summary
    if (hasAll(C.STN_SIGNATURE)) {
      const cm = {};
      for (const canon in C.STN_COLUMNS) cm[canon] = lookup[C.STN_COLUMNS[canon]];
      const built = rowsFromColmap(rows, cm, "current");
      built.forEach((row) => { row._filename = row.size ? row["seller sku code"] + "-" + row.size : row["seller sku code"]; });
      return finalize(built, "Myntra STN Summary");
    }

    // 2. Seller Listings Report
    if (hasAll(C.LISTINGS_SIGNATURE)) {
      const cm = partialColmap(lookup); delete cm["month & year of manufacture"];
      return finalize(rowsFromColmap(rows, cm, "current"), "Seller Listings Report");
    }

    // 3. Original Label Template (every required column present)
    const full = partialColmap(lookup);
    if (Object.keys(full).length === Object.keys(C.REQUIRED_COLUMNS).length) {
      return finalize(rowsFromColmap(rows, full, "file"), "Label Template");
    }

    // 4. Stored-reference lookup — file has a SKU key column; fill the rest.
    const keyCol = C.REQUIRED_COLUMNS["seller sku code"].find((a) => lookup[a])
                || C.REQUIRED_COLUMNS["sku code"].find((a) => lookup[a]);
    if (master() && master().meta.count && keyCol) {
      return finalize(rowsFromColmap(rows, partialColmap(lookup), "file"), "SKU lookup");
    }

    // 5. Unknown -> manual column mapping
    const cols = columns.map(String).filter((c) => c.trim() && !c.startsWith("__EMPTY"));
    const samples = {};
    cols.forEach((c) => {
      const vals = [];
      for (let i = 0; i < Math.min(rows.length, 20) && vals.length < 3; i++) {
        const v = cleanCell(rows[i][c]); if (v) vals.push(v);
      }
      samples[c] = vals;
    });
    const guess = {};
    C.MAPPABLE_FIELDS.forEach((fs) => {
      let g = null;
      for (const a of C.REQUIRED_COLUMNS[fs.field]) if (lookup[a]) { g = lookup[a]; break; }
      if (!g) for (const key in lookup) {
        if (C.REQUIRED_COLUMNS[fs.field].some((a) => key.includes(a) || a.includes(key))) { g = lookup[key]; break; }
      }
      guess[fs.field] = g;
    });
    return { needsMapping: true, columns: cols, samples, guess, rawRows: rows, currentMonth: currentMonthYear() };
  }

  function applyMapping(rawRows, mapping) {
    const colmap = {};
    C.MAPPABLE_FIELDS.forEach((fs) => {
      const chosen = mapping[fs.field];
      if (chosen && chosen !== "__current__") colmap[fs.field] = chosen;
    });
    return finalize(rowsFromColmap(rawRows, colmap, "file"), "Custom mapping");
  }

  function masterMeta() { const m = master(); return m ? m.meta : null; }

  // ---- stored reference: build from listing file(s), persist in this browser ----
  const LS_KEY = "labelStudioMaster_v1";

  async function buildMasterFromFiles(fileList) {
    const records = [], bySeller = {}, bySku = {}, bySkuId = {}, sources = [];
    const shortOf = { b: "brand", a: "article type", sn: "style name", si: "style id",
                      sz: "size", ss: "seller sku code", sk: "sku code", m: "mrp" };
    for (const file of fileList) {
      const { columns, rows } = await readFile(file);
      const lookup = buildLookup(columns);
      const cm = partialColmap(lookup);
      const skuIdCol = lookup["sku id"];
      let n = 0;
      rows.forEach((r) => {
        const rec = {};
        for (const short in shortOf) { const col = cm[shortOf[short]]; rec[short] = col ? cleanCell(r[col]) : ""; }
        if (!rec.ss && !rec.sk) return;
        const idx = records.length; records.push(rec); n++;
        if (rec.ss) bySeller[rec.ss.toLowerCase()] = idx;
        if (rec.sk) bySku[rec.sk.toLowerCase()] = idx;
        const sid = skuIdCol ? cleanCell(r[skuIdCol]).toLowerCase() : "";
        if (sid) bySkuId[sid] = idx;
      });
      sources.push(file.name.replace(/\.[^.]+$/, "") + " (" + n + ")");
    }
    if (!records.length) throw new Error("No SKUs found — is this a Seller Listings Report?");
    const built = new Date().toISOString().slice(0, 10);
    return { meta: { count: records.length, built, sources }, records, bySeller, bySku, bySkuId };
  }

  function saveMaster(m) {
    window.LABEL_MASTER = m;
    try { localStorage.setItem(LS_KEY, JSON.stringify(m)); return true; }
    catch (e) { return false; }   // quota exceeded — kept in memory for this session
  }
  function loadMasterFromStorage() {
    try { const s = localStorage.getItem(LS_KEY); if (s) { window.LABEL_MASTER = JSON.parse(s); return window.LABEL_MASTER; } }
    catch (e) { /* corrupt */ }
    return null;
  }
  function clearMaster() { window.LABEL_MASTER = null; try { localStorage.removeItem(LS_KEY); } catch (e) {} }

  window.LabelParse = {
    parseUpload, applyMapping, cleanCell, masterMeta,
    buildMasterFromFiles, saveMaster, loadMasterFromStorage, clearMaster,
  };
})();
