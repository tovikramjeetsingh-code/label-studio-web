// UI wiring — upload -> (map) -> review -> generate ZIP, all client-side.
(function () {
  const C = window.LABEL_CONFIG;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let ROWS = [];          // canonical rows ready to render
  let MAP_CTX = null;     // stash for the mapping step

  // fixed-values panel
  $("fxDesigned").textContent = C.DESIGNED_BY;
  $("fxMfg").textContent = C.MANUFACTURED_BY;
  $("fxCountry").textContent = C.COUNTRY_OF_ORIGIN;

  // ---- upload ----
  const drop = $("drop"), fileInput = $("fileInput");
  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault(); drop.classList.remove("drag");
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", () => { if (fileInput.files.length) handleFile(fileInput.files[0]); });

  async function handleFile(file) {
    $("uploadToast").innerHTML = "";
    drop.querySelector(".big").textContent = 'Reading "' + file.name + '"…';
    let res;
    try { res = await window.LabelParse.parseUpload(file); }
    catch (e) {
      drop.querySelector(".big").textContent = "Drop file here or click to browse";
      $("uploadToast").innerHTML = '<div class="toast err">✕ ' + esc(e.message) + "</div>";
      $("mapCard").classList.add("hidden"); $("reviewCard").classList.add("hidden"); $("genCard").classList.add("hidden");
      return;
    }
    drop.querySelector(".big").textContent = "Drop file here or click to browse";
    fileInput.value = "";
    window._lastFile = file.name;
    if (res.needsMapping) { renderMapping(file.name, res); return; }
    $("mapCard").classList.add("hidden");
    ROWS = res.rows;
    renderReview(file.name, res.format, res.problems);
  }

  // ---- mapping step ----
  function renderMapping(filename, data) {
    MAP_CTX = data;
    $("reviewCard").classList.add("hidden"); $("genCard").classList.add("hidden");
    $("mapToast").innerHTML = ""; $("mapBadge").textContent = filename;
    const grid = $("mapGrid"); grid.innerHTML = "";
    C.MAPPABLE_FIELDS.forEach((f) => {
      const rowEl = document.createElement("div"); rowEl.className = "map-row";
      const opts = [];
      if (!f.required) opts.push('<option value="__current__">Auto — current month (' + esc(data.currentMonth) + ")</option>");
      else opts.push('<option value="">— choose column —</option>');
      data.columns.forEach((c) => {
        const sel = data.guess[f.field] === c ? " selected" : "";
        opts.push('<option value="' + esc(c) + '"' + sel + ">" + esc(c) + "</option>");
      });
      rowEl.innerHTML =
        '<div class="map-field">' + esc(f.label) +
          (f.required ? ' <span class="req">*</span>' : ' <span class="opt">(optional)</span>') + "</div>" +
        '<select data-field="' + esc(f.field) + '">' + opts.join("") + "</select>" +
        '<div class="map-sample"></div>';
      grid.appendChild(rowEl);
    });
    const update = (sel) => {
      const s = sel.nextElementSibling;
      if (sel.value === "__current__") s.textContent = "e.g. " + MAP_CTX.currentMonth;
      else if (sel.value) { const v = MAP_CTX.samples[sel.value] || []; s.textContent = v.length ? "e.g. " + v.join(" · ") : "(no sample values)"; }
      else s.textContent = "";
      sel.classList.toggle("unset", !sel.value);
    };
    grid.querySelectorAll("select").forEach((sel) => { update(sel); sel.addEventListener("change", () => update(sel)); });
    $("mapCard").classList.remove("hidden");
    $("mapCard").scrollIntoView({ behavior: "smooth" });
  }

  $("mapBtn").addEventListener("click", () => {
    const mapping = {}; let missing = false;
    $("mapGrid").querySelectorAll("select").forEach((sel) => { mapping[sel.dataset.field] = sel.value; if (!sel.value) missing = true; });
    if (missing) { $("mapToast").innerHTML = '<div class="toast err">✕ Choose a column for every required field.</div>'; return; }
    const res = window.LabelParse.applyMapping(MAP_CTX.rawRows, mapping);
    if (!res.rows.length) { $("mapToast").innerHTML = '<div class="toast err">✕ No data rows after mapping.</div>'; return; }
    $("mapCard").classList.add("hidden");
    ROWS = res.rows;
    renderReview(window._lastFile, res.format, res.problems);
  });

  // ---- review ----
  function renderReview(filename, format, problems) {
    $("reviewCard").classList.remove("hidden"); $("genCard").classList.remove("hidden");
    $("fileBadge").textContent = filename + " · " + format + " · " + ROWS.length + " labels";
    const bad = new Set((problems || []).map((p) => p.row));
    if (problems && problems.length) {
      const list = problems.slice(0, 8).map((p) => "row " + p.row + " (missing: " + p.missing.join(", ") + ")").join("; ");
      $("problemToast").innerHTML = '<div class="toast warn">⚠ ' + problems.length +
        " row(s) have blank required fields — they will still print, check them: " + esc(list) +
        (problems.length > 8 ? " …" : "") + "</div>";
    } else $("problemToast").innerHTML = "";

    const tb = $("tbl").querySelector("tbody"); tb.innerHTML = "";
    ROWS.forEach((r, i) => {
      const tr = document.createElement("tr");
      if (bad.has(i + 2)) tr.classList.add("bad");
      tr.innerHTML =
        '<td class="rownum">' + (i + 1) + "</td>" +
        '<td><a class="pv" data-i="' + i + '">Preview</a></td>' +
        "<td><b>" + esc(r["seller sku code"]) + "</b></td>" +
        "<td>" + esc(r["sku code"]) + "</td><td>" + esc(r.size) + "</td>" +
        "<td>₹" + esc(r.mrp) + "</td><td>" + esc(r.brand) + "</td>" +
        "<td>" + esc(r["article type"]) + "</td><td>" + esc(r["style name"]) + "</td>" +
        "<td>" + esc(r["style id"]) + "</td><td>" + esc(r["month & year of manufacture"]) + "</td>";
      tb.appendChild(tr);
    });
    tb.querySelectorAll("a.pv").forEach((a) => a.addEventListener("click", () => openPreview(+a.dataset.i)));

    $("genBtn").disabled = false; $("genBtn").style.display = "";
    $("prog").style.display = "none"; $("progFill").style.width = "0%";
    $("genMsg").textContent = ""; $("downloadBtn").style.display = "none";
  }

  // ---- preview ----
  function openPreview(i) {
    const doc = window.LabelRender.buildLabelDoc(ROWS[i]);
    $("pvFrame").src = doc.output("bloburl");
    $("modal").style.display = "flex";
  }
  $("pvClose").addEventListener("click", closeModal);
  $("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeModal(); });
  function closeModal() { $("modal").style.display = "none"; $("pvFrame").src = "about:blank"; }

  // ---- generate ZIP ----
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let ZIP_BLOB = null;

  $("genBtn").addEventListener("click", async () => {
    $("genBtn").disabled = true; $("prog").style.display = "block";
    $("downloadBtn").style.display = "none"; ZIP_BLOB = null;
    const zip = new JSZip(), used = {};
    for (let i = 0; i < ROWS.length; i++) {
      const r = ROWS[i];
      let base = (r._filename || r["seller sku code"] || ("label_" + (i + 1))).replace(/[\\/:*?"<>|]/g, "_");
      let name = base, n = 2;
      while (used[name]) { name = base + "_" + n; n++; }
      used[name] = 1;
      const doc = window.LabelRender.buildLabelDoc(r);
      zip.file(name + ".pdf", doc.output("blob"));
      $("progFill").style.width = Math.round(100 * (i + 1) / ROWS.length) + "%";
      $("genMsg").textContent = (i + 1) + " / " + ROWS.length + " labels…";
      if (i % 15 === 0) await sleep(0);   // let the UI paint
    }
    $("genMsg").textContent = "Zipping…";
    ZIP_BLOB = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    $("prog").style.display = "none";
    $("genMsg").textContent = "✅ " + ROWS.length + " labels ready.";
    $("genBtn").style.display = "none";
    $("downloadBtn").style.display = "inline-block";
  });

  $("downloadBtn").addEventListener("click", () => {
    if (!ZIP_BLOB) return;
    const base = (window._lastFile || "labels").replace(/\.[^.]+$/, "");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(ZIP_BLOB);
    a.download = base + "_labels.zip";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
})();
