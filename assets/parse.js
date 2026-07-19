// Parsing + format detection — mirrors the Flask app's app.py logic, but
// everything runs in the browser (the file never leaves the machine).
(function () {
  const C = window.LABEL_CONFIG;

  function cleanCell(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") {
      return Number.isInteger(v) ? String(v) : String(v);
    }
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

  // Read a File -> { columns:[...], rows:[{header:value}] } (raw, untouched keys)
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
            const columns = rows.length
              ? Object.keys(rows[0])
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

  // header lookup: lowercased/trimmed/':'-stripped -> original column name
  function buildLookup(columns) {
    const lookup = {};
    columns.forEach((c) => {
      const key = String(c).trim().toLowerCase().replace(/:+$/, "");
      lookup[key] = c;
    });
    return lookup;
  }

  function flagProblems(row, i, problems) {
    const miss = ["seller sku code", "sku code", "size", "mrp"].filter((c) => !row[c]);
    if (miss.length) problems.push({ row: i + 2, missing: miss });
  }

  function anyVal(row) { return Object.values(row).some((v) => v !== "" && v != null); }

  // ---- format-specific parsers ----
  function parseTemplate(rows, colmap) {
    const out = [], problems = [];
    rows.forEach((r, i) => {
      const row = {};
      Object.keys(colmap).forEach((canon) => { row[canon] = cleanCell(r[colmap[canon]]); });
      if (!anyVal(row)) return;
      row._filename = row["seller sku code"];
      flagProblems(row, i, problems);
      out.push(row);
    });
    return { rows: out, problems, format: "Label Template" };
  }

  function parseStn(rows, lookup) {
    const my = currentMonthYear(), out = [], problems = [];
    rows.forEach((r, i) => {
      const row = {};
      Object.keys(C.STN_COLUMNS).forEach((canon) => {
        row[canon] = cleanCell(r[lookup[C.STN_COLUMNS[canon]]]);
      });
      if (!anyVal(row)) return;
      row["month & year of manufacture"] = my;
      row._filename = row.size ? row["seller sku code"] + "-" + row.size : row["seller sku code"];
      flagProblems(row, i, problems);
      out.push(row);
    });
    return { rows: out, problems, format: "Myntra STN Summary" };
  }

  function parseListings(rows, lookup) {
    const my = currentMonthYear(), out = [], problems = [];
    const colmap = {};
    Object.keys(C.REQUIRED_COLUMNS).forEach((canon) => {
      if (canon === "month & year of manufacture") return;
      for (const a of C.REQUIRED_COLUMNS[canon]) if (lookup[a]) { colmap[canon] = lookup[a]; break; }
    });
    rows.forEach((r, i) => {
      const row = {};
      Object.keys(colmap).forEach((canon) => { row[canon] = cleanCell(r[colmap[canon]]); });
      if (!anyVal(row)) return;
      row["month & year of manufacture"] = my;
      row._filename = row["seller sku code"];
      flagProblems(row, i, problems);
      out.push(row);
    });
    return { rows: out, problems, format: "Seller Listings Report" };
  }

  // Main entry — returns either {rows,problems,format} or {needsMapping,...}
  async function parseUpload(file) {
    const { columns, rows } = await readFile(file);
    if (!rows.length) throw new Error("The file has no data rows.");
    const lookup = buildLookup(columns);
    const has = (sig) => sig.every((s) => s in lookup);

    if (has(C.STN_SIGNATURE)) return parseStn(rows, lookup);
    if (has(C.LISTINGS_SIGNATURE)) return parseListings(rows, lookup);

    // Try the original template (alias-match every required column)
    const colmap = {}; let missing = false;
    Object.keys(C.REQUIRED_COLUMNS).forEach((canon) => {
      let found = null;
      for (const a of C.REQUIRED_COLUMNS[canon]) if (lookup[a]) { found = lookup[a]; break; }
      if (found) colmap[canon] = found; else missing = true;
    });
    if (!missing) return parseTemplate(rows, colmap);

    // Unknown format -> gather info for the manual mapping step
    const cols = columns.map(String).filter((c) => c.trim() && !c.startsWith("__EMPTY"));
    const samples = {};
    cols.forEach((c) => {
      const vals = [];
      for (let i = 0; i < Math.min(rows.length, 20) && vals.length < 3; i++) {
        const v = cleanCell(rows[i][c]);
        if (v) vals.push(v);
      }
      samples[c] = vals;
    });
    const guess = {};
    C.MAPPABLE_FIELDS.forEach((fs) => {
      const aliases = C.REQUIRED_COLUMNS[fs.field];
      let g = null;
      for (const a of aliases) if (lookup[a]) { g = lookup[a]; break; }
      if (!g) {
        for (const key in lookup) {
          if (aliases.some((a) => key.includes(a) || a.includes(key))) { g = lookup[key]; break; }
        }
      }
      guess[fs.field] = g;
    });
    return {
      needsMapping: true, columns: cols, samples, guess,
      rawRows: rows, currentMonth: currentMonthYear(),
    };
  }

  // Apply a user-chosen column mapping to the stashed raw rows.
  function applyMapping(rawRows, mapping) {
    const my = currentMonthYear(), out = [], problems = [];
    rawRows.forEach((r, i) => {
      const row = {};
      C.MAPPABLE_FIELDS.forEach((fs) => {
        const chosen = mapping[fs.field];
        row[fs.field] = (chosen && chosen !== "__current__") ? cleanCell(r[chosen]) : "";
      });
      if (!anyVal(row)) return;
      if (!row["month & year of manufacture"]) row["month & year of manufacture"] = my;
      row._filename = row["seller sku code"];
      flagProblems(row, i, problems);
      out.push(row);
    });
    return { rows: out, problems, format: "Custom mapping" };
  }

  window.LabelParse = { parseUpload, applyMapping, cleanCell };
})();
