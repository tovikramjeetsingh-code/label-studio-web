# Label Studio — browser-only label generator

Generates individual **60 × 83 mm Myntra product sticker PDFs** (one per SKU-size)
from a CSV/Excel upload. Runs **entirely in the browser** — no server, no upload:
the file is read, parsed, and turned into PDFs locally, then downloaded as a ZIP.
Hostable free on GitHub Pages under your own domain.

## Use

Open the site, drop a `.csv`/`.xlsx`, review, **Generate**, **Download ZIP**.

Three formats auto-detected (same as the original app):
- **Label Template** — brand, article type, style name, style id, size, seller sku code, sku code, mrp, month & year of manufacture
- **Myntra STN Summary** — portal export; Seller SKU = Vendor Article No, filename = `VendorArticleNo-Size`, Month & Year = current month
- **Seller Listings Report** — portal listings export; Month & Year = current month
- **Anything else** → a "Map columns" step lets you match its columns to the label fields.

## Stored SKU reference (auto-fill missing fields) — private

The catalog is **never bundled or published** (it would be world-readable on
Pages). Instead each user loads their Seller Listings Report(s) via
**"Load / update reference"** on the page. The app builds a lookup table and
keeps it **only in that browser** (`localStorage`) — nothing is uploaded.

On upload, any **blank** label field is filled from this reference by matching
seller-sku-code / sku-code. You can even upload a bare list of SKU codes and get
full labels ("SKU lookup" format). A value the file *does* provide is never
overwritten; SKUs not found are flagged.

- **Per browser/device**: each machine loads the reference once (persists across
  visits). New listings? Click "Load / update reference" again.
- **Clear** removes it from that browser.

## Fixed values

The two statutory addresses and Country of Origin = INDIA live in
[`assets/config.js`](assets/config.js). Edit there, commit, push — GitHub Pages
redeploys automatically.

## How it renders

- **jsPDF** places vector text (Helvetica — metric twin of Arial) at exact mm
  positions matching the original WeasyPrint layout.
- **JsBarcode** draws the Code-128 barcode (rasterized, like the original).
- The ₹ glyph is drawn from the browser font as a small image (jsPDF's built-in
  fonts don't include it).
- **SheetJS** reads Excel, **PapaParse** reads CSV, **JSZip** bundles the PDFs.
- All five libraries are vendored in [`vendor/`](vendor/) — nothing loads from a
  third party at runtime.

## Files

| File | Role |
|------|------|
| `index.html` | Page + script includes |
| `style.css` | Styling |
| `assets/config.js` | Fixed values + format signatures + column aliases |
| `assets/parse.js` | Read file, detect format, produce canonical rows |
| `assets/label.js` | Render one 60×83 mm label to a jsPDF doc |
| `assets/app.js` | UI: upload → map → review → generate → download |
| `vendor/` | jsPDF, JsBarcode, PapaParse, SheetJS, JSZip |

## Local preview

```bash
cd label-web && python3 -m http.server 7790
# open http://localhost:7790
```

## Hosting (GitHub Pages + your domain)

Pushed to a GitHub repo with Pages enabled on `main` / root. To attach a custom
domain: add a `CNAME` file (one line: your domain) and point the domain's DNS at
GitHub Pages (CNAME → `<user>.github.io`, or A records to GitHub's IPs).
