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

  // Match a row to the reference by SKU code (barcode) first, then seller sku code.
  function masterFind(row) {
    const m = master(); if (!m) return null;
    const sk = (row["sku code"] || "").trim().toLowerCase();
    const ss = (row["seller sku code"] || "").trim().toLowerCase();
    let idx = (sk && sk in m.bySku) ? m.bySku[sk]
            : (ss && ss in m.bySeller) ? m.bySeller[ss] : undefined;
    return idx === undefined ? null : m.records[idx];
  }

  // Reconcile each row against the stored reference: the listing is the source
  // of truth, so any field that differs is corrected to the listing's value —
  // EXCEPT size, which is always kept from the upload (only filled if blank).
  function finalize(rows, format) {
    let corrected = 0;
    rows.forEach((row) => {
      const rec = masterFind(row);
      if (rec) {
        let did = false;
        for (const short in CANON_FROM_SHORT) {
          const canon = CANON_FROM_SHORT[short];
          if (canon === "size") {
            if (!row[canon] && rec[short]) { row[canon] = rec[short]; did = true; }  // fill only
          } else if (rec[short] && row[canon] !== rec[short]) {
            row[canon] = rec[short]; did = true;                                      // correct/override
          }
        }
        row._filename = row["seller sku code"];   // follow the corrected seller sku
        if (did) corrected++;
      } else if (!row._filename) {
        row._filename = row["seller sku code"];
      }
      if (!row["month & year of manufacture"]) row["month & year of manufacture"] = currentMonthYear();
    });
    const problems = [];
    rows.forEach((row) => flagProblems(row, problems));
    return { rows, problems, format, enriched: corrected };
  }

  // ---- canonical row builders ----
  function blankRow() {
    const row = {};
    for (const s in CANON_FROM_SHORT) row[CANON_FROM_SHORT[s]] = "";
    row["month & year of manufacture"] = "";
    return row;
  }

  const QTY_ALIASES = ["quantity", "qty", "copies", "count", "print qty", "print quantity", "qnty"];
  function findQtyCol(lookup) {
    for (const a of QTY_ALIASES) if (lookup[a]) return lookup[a];
    return null;
  }
  function parseQty(v) {
    const n = parseInt(cleanCell(v), 10);
    return (isNaN(n) || n < 1) ? 1 : n;
  }

  function rowsFromColmap(rawRows, colmap, monthMode, qtyCol) {
    const out = [];
    rawRows.forEach((r, i) => {
      const row = blankRow();
      for (const canon in colmap) row[canon] = cleanCell(r[colmap[canon]]);
      if (!anyVal(row)) return;
      row._srcrow = i + 2;
      row._qty = qtyCol ? parseQty(r[qtyCol]) : 1;
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
    const qtyCol = findQtyCol(lookup);   // per-label copies (Quantity/Qty/Copies…)

    // 1. Myntra STN Summary
    if (hasAll(C.STN_SIGNATURE)) {
      const cm = {};
      for (const canon in C.STN_COLUMNS) cm[canon] = lookup[C.STN_COLUMNS[canon]];
      const built = rowsFromColmap(rows, cm, "current", qtyCol);
      built.forEach((row) => { row._filename = row.size ? row["seller sku code"] + "-" + row.size : row["seller sku code"]; });
      return finalize(built, "Myntra STN Summary");
    }

    // 2. Seller Listings Report
    if (hasAll(C.LISTINGS_SIGNATURE)) {
      const cm = partialColmap(lookup); delete cm["month & year of manufacture"];
      return finalize(rowsFromColmap(rows, cm, "current", qtyCol), "Seller Listings Report");
    }

    // 3. Original Label Template (every required column present)
    const full = partialColmap(lookup);
    if (Object.keys(full).length === Object.keys(C.REQUIRED_COLUMNS).length) {
      return finalize(rowsFromColmap(rows, full, "file", qtyCol), "Label Template");
    }

    // 4. Stored-reference lookup — file has a SKU key column; fill the rest.
    const keyCol = C.REQUIRED_COLUMNS["seller sku code"].find((a) => lookup[a])
                || C.REQUIRED_COLUMNS["sku code"].find((a) => lookup[a]);
    if (master() && master().meta.count && keyCol) {
      return finalize(rowsFromColmap(rows, partialColmap(lookup), "file", qtyCol), "SKU lookup");
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
    const qtyCol = rawRows.length ? findQtyCol(buildLookup(Object.keys(rawRows[0]))) : null;
    return finalize(rowsFromColmap(rawRows, colmap, "file", qtyCol), "Custom mapping");
  }

  function masterMeta() { const m = master(); return m ? m.meta : null; }

  // ---- free-style rack labels: CSV/Excel, first column = barcode + text ----
  async function parseRack(file) {
    const { columns, rows } = await readFile(file);
    const cols = columns.map(String).filter((c) => String(c).trim());
    if (!cols.length) throw new Error("The file has no columns.");
    const out = [];
    rows.forEach((r) => {
      const code = cleanCell(r[cols[0]]);
      if (!code) return;
      const sub = cols[1] ? cleanCell(r[cols[1]]) : "";
      out.push({ code, sub, _filename: code.replace(/[\\/:*?"<>|]/g, "_") });
    });
    if (!out.length) throw new Error("No codes found — put the rack code in the first column.");
    return { rows: out, count: out.length };
  }

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

  // ---- encrypted bundled reference: unlock with the shared team password ----
  const PASS_KEY = "labelStudioRefPass_v1";
  const b64bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function decryptReference(passphrase) {
    const enc = window.LABEL_ENC;
    if (!enc) throw new Error("No reference is bundled with this site yet.");
    const salt = b64bytes(enc.salt), iv = b64bytes(enc.iv), ct = b64bytes(enc.ct);
    const keyMat = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: enc.iters, hash: "SHA-256" },
      keyMat, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    let plain;
    try { plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct); }
    catch (e) { throw new Error("Wrong password."); }
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // ---- bundled item-barcode map (STN scan tab) ----
  // Payload is run-length encoded (see tools/build_items.py): item barcodes are
  // issued in contiguous runs, so ~292k entries ship as ~14k/27k runs.
  function expandRuns(str) {
    const out = [];
    if (!str) return out;
    for (const part of str.split(",")) {
      const star = part.indexOf("*");
      if (star < 0) { out.push(parseInt(part, 36)); continue; }
      const v = parseInt(part.slice(0, star), 36);
      let n = parseInt(part.slice(star + 1), 36);
      while (n-- > 0) out.push(v);
    }
    return out;
  }

  function buildItemIndex(data) {
    const deltas = expandRuns(data.d), skuIdx = expandRuns(data.s);
    const map = new Map();
    let n = data.n0;
    map.set(n, skuIdx[0]);
    for (let i = 0; i < deltas.length; i++) {
      n += deltas[i];
      map.set(n, skuIdx[i + 1]);
    }
    return {
      meta: data.meta, prefix: data.prefix, skus: data.skus, names: data.names || {},
      map,
      find(barcode) {
        const raw = (barcode || "").trim().toUpperCase();
        const digits = raw.replace(/^[A-Z]+/, "");
        if (!digits || !/^\d+$/.test(digits)) return null;
        const i = this.map.get(parseInt(digits, 10));
        if (i === undefined) return null;
        return { itemCode: raw, sku: this.skus[i], name: this.names[String(i)] || "" };
      },
    };
  }

  async function decryptWith(enc, passphrase) {
    const salt = b64bytes(enc.salt), iv = b64bytes(enc.iv), ct = b64bytes(enc.ct);
    const keyMat = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: enc.iters, hash: "SHA-256" },
      keyMat, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    let plain;
    try { plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct); }
    catch (e) { throw new Error("Wrong password."); }
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // Same password as the listings reference, so one unlock covers both bundles.
  async function unlockItems(passphrase) {
    if (!window.ITEM_ENC) return null;
    try {
      window.LABEL_ITEMS = buildItemIndex(await decryptWith(window.ITEM_ENC, passphrase));
      return window.LABEL_ITEMS.meta;
    } catch (e) { return null; }
  }
  // ---- extras: item barcodes and listings added by the team after the build ----
  // The bundled map and catalog are a snapshot. Anything uploaded on the Scan &
  // print tab is merged over them and kept in this browser, so a barcode or SKU
  // only has to be supplied once.
  const XITEMS_KEY = "labelStudioExtraItems_v1";
  const XLIST_KEY  = "labelStudioExtraListings_v1";
  const loadJSON = (k, dflt) => {
    try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v || dflt; }
    catch (e) { return dflt; }
  };
  let XITEMS = loadJSON(XITEMS_KEY, {});     // { "IB123": "SKU-CODE" }
  let XLIST  = loadJSON(XLIST_KEY, []);      // [ {b,a,sn,si,sz,ss,sk,m,v}, … ]

  function saveExtras() {
    try {
      localStorage.setItem(XITEMS_KEY, JSON.stringify(XITEMS));
      localStorage.setItem(XLIST_KEY, JSON.stringify(XLIST));
      return true;
    } catch (e) { return false; }   // quota — caller reports it
  }
  function extrasMeta() {
    return { items: Object.keys(XITEMS).length, listings: XLIST.length };
  }
  function clearExtras() { XITEMS = {}; XLIST = []; saveExtras(); }

  const itemsMeta = () => (window.LABEL_ITEMS ? window.LABEL_ITEMS.meta : null);

  // Uploaded barcodes win over the bundled map — they are newer by definition.
  function findItem(bc) {
    const raw = (bc || "").trim().toUpperCase();
    if (XITEMS[raw]) return { itemCode: raw, sku: XITEMS[raw], name: "", from: "upload" };
    const hit = window.LABEL_ITEMS ? window.LABEL_ITEMS.find(raw) : null;
    return hit ? { ...hit, from: "built-in" } : null;
  }

  // Merge an OMS item-barcode export. Returns what changed.
  async function addItemBarcodes(file) {
    const { columns, rows } = await readFile(file);
    const lut = buildLookup(columns);
    const bcCol  = ["itembarcode", "item barcode", "item_barcode"].map((a) => lut[a]).find(Boolean);
    const skuCol = ["sku code", "sku_code", "skucode"].map((a) => lut[a]).find(Boolean);
    if (!bcCol || !skuCol) throw new Error("no item-barcode / sku-code columns in this file");
    let added = 0, already = 0;
    rows.forEach((r) => {
      const bc = cleanCell(r[bcCol]).toUpperCase(), sku = cleanCell(r[skuCol]);
      if (!bc || !sku) return;
      if (XITEMS[bc] === sku || (findItem(bc) || {}).sku === sku) { already++; return; }
      XITEMS[bc] = sku; added++;
    });
    const saved = saveExtras();
    return { kind: "items", added, already, saved, total: Object.keys(XITEMS).length };
  }

  // Merge a Seller Listings Report so new SKUs resolve from now on.
  async function addListings(file) {
    const { columns, rows } = await readFile(file);
    const lut = buildLookup(columns);
    const pick = (names) => names.map((a) => lut[a]).find(Boolean);
    const cols = {
      b: pick(["brand"]), a: pick(["article type"]), sn: pick(["style name"]),
      si: pick(["style id"]), sz: pick(["size"]),
      ss: pick(["seller sku code", "seller sku"]), sk: pick(["sku code", "sku_code"]),
      m: pick(["mrp"]), v: pick(["van", "vendor article no"]),
    };
    if (!cols.sk || !cols.ss) throw new Error("no seller sku code / sku code columns in this file");
    let added = 0, already = 0;
    rows.forEach((r) => {
      const rec = {};
      for (const k in cols) rec[k] = cols[k] ? cleanCell(r[cols[k]]) : "";
      if (!rec.sk && !rec.ss) return;
      // a listing that names itself carries no information — skip it
      if (rec.sk && rec.ss.toLowerCase() === rec.sk.toLowerCase()) return;
      if (rowFromReference(rec.sk) || rowFromReference(rec.ss)) { already++; return; }
      XLIST.push(rec); added++;
    });
    const saved = saveExtras();
    return { kind: "listings", added, already, saved, total: XLIST.length };
  }

  // Which kind of file is this? Used by the Scan & print uploader.
  async function sniffUpload(file) {
    const { columns } = await readFile(file);
    const lut = buildLookup(columns);
    const hasItem = ["itembarcode", "item barcode", "item_barcode"].some((a) => lut[a]);
    const hasList = (lut["seller sku code"] || lut["seller sku"]) && (lut["sku code"] || lut["sku_code"]);
    if (hasItem) return "items";
    if (hasList) return "listings";
    return null;
  }

  // Build a complete label row straight from the listings reference. A SKU code
  // (the Myntra barcode) is unique per brand, so this needs no disambiguation.
  function rowFromReference(code) {
    const key0 = (code || "").trim().toLowerCase();
    const alt0 = key0.replace(/[\s_]+/g, "-");
    for (const rec of XLIST) {
      const ss = (rec.ss || "").toLowerCase(), sk = (rec.sk || "").toLowerCase();
      const ssA = ss.replace(/[\s_]+/g, "-"), skA = sk.replace(/[\s_]+/g, "-");
      if (ss === key0 || sk === key0 || ssA === alt0 || skA === alt0) return rowFromRecord(rec);
    }
    const m = master(); if (!m) return null;
    const key = key0;
    // OMS writes `aedbh-0106-golden_36`, the listing `…-36` — same key, so try both.
    const alt = key.replace(/[\s_]+/g, "-");
    const tryKeys = alt === key ? [key] : [key, alt];
    let idx;
    for (const k of tryKeys) {
      if (idx === undefined) idx = m.bySku[k];
      if (idx === undefined) idx = m.bySeller[k];
      if (idx === undefined && m.bySkuId) idx = m.bySkuId[k];
    }
    if (idx === undefined) return null;
    return rowFromRecord(m.records[idx]);
  }

  function rowFromRecord(rec) {
    const row = blankRow();
    for (const short in CANON_FROM_SHORT) row[CANON_FROM_SHORT[short]] = rec[short] || "";
    row["month & year of manufacture"] = currentMonthYear();
    row._filename = row["seller sku code"];
    row._qty = 1;
    row._van = rec.v || "";
    return row;
  }

  // Manual finder: match a query against seller sku code, sku code, style id or
  // VAN. Style id and VAN are shared across a style's sizes, so those queries
  // naturally return the whole size run.
  const SIZE_ORDER = (v) => { const n = parseFloat(v); return isNaN(n) ? 999 : n; };

  function searchReference(query, limit) {
    const m = master(); if (!m) return { rows: [], truncated: false };
    const q = (query || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
    if (q.length < 2) return { rows: [], truncated: false };
    const cap = limit || 400;
    const exact = [], partial = [];
    for (const rec of m.records) {
      const ss = (rec.ss || "").toLowerCase().replace(/[\s_]+/g, "-");
      const sk = (rec.sk || "").toLowerCase();
      const si = (rec.si || "").toLowerCase();
      const van = (rec.v || "").toLowerCase().replace(/[\s_]+/g, "-");
      if (ss === q || sk === q || si === q || van === q) exact.push(rec);
      else if (ss.includes(q) || sk.includes(q) || si.includes(q) || van.includes(q)) partial.push(rec);
      if (exact.length + partial.length > cap * 3) break;
    }
    // An exact style-id / VAN hit is the whole size run — show it on its own.
    const hits = exact.length ? exact : partial;
    const rows = hits.slice(0, cap).map(rowFromRecord);
    rows.sort((a, b) => (a["style id"] || "").localeCompare(b["style id"] || "") ||
                        SIZE_ORDER(a.size) - SIZE_ORDER(b.size));
    return { rows, truncated: hits.length > cap, exact: exact.length > 0 };
  }

  // unlock + remember the password on this browser
  async function unlockReference(passphrase) {
    const m = await decryptReference(passphrase);
    window.LABEL_MASTER = m;
    try { localStorage.setItem(PASS_KEY, passphrase); } catch (e) {}
    unlockItems(passphrase);      // best-effort; scan tab works once it lands
    return m.meta;
  }

  // Silent unlock on load. The key normally ships in config.js so nobody has to
  // type anything; a previously-entered password still works if it's blanked out.
  async function tryAutoUnlock() {
    if (!window.LABEL_ENC) return null;
    let pass = (C.REFERENCE_KEY || "").trim();
    if (!pass) { try { pass = localStorage.getItem(PASS_KEY); } catch (e) {} }
    if (!pass) return null;
    try {
      const m = await decryptReference(pass);
      window.LABEL_MASTER = m;
      unlockItems(pass);
      return m.meta;
    } catch (e) { try { localStorage.removeItem(PASS_KEY); } catch (_) {} return null; }  // password rotated
  }

  const hasEncrypted = () => !!window.LABEL_ENC;
  function forgetPassword() { window.LABEL_MASTER = null; try { localStorage.removeItem(PASS_KEY); } catch (e) {} }

  window.LabelParse = {
    parseUpload, applyMapping, cleanCell, masterMeta,
    buildMasterFromFiles, saveMaster, loadMasterFromStorage, clearMaster,
    unlockReference, tryAutoUnlock, hasEncrypted, forgetPassword,
    parseRack, itemsMeta, findItem, rowFromReference, searchReference,
    addItemBarcodes, addListings, sniffUpload, extrasMeta, clearExtras,
    finalizeRows: finalize,
  };
})();
