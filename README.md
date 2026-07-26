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

## Stored SKU reference (auto-fill missing fields) — encrypted, team password

The catalog ships **encrypted** in the site (`assets/reference.enc.js`). It's
public ciphertext — unreadable without the shared **team password**. Each user
enters that password **once per browser** ("Unlock reference"); the app decrypts
it locally (Web Crypto, AES-256-GCM) and remembers it, so from then on missing
label fields are filled automatically in the background. Upload a bare list of
SKU codes and get full labels ("SKU lookup"); values the file provides are never
overwritten; unknown SKUs are flagged.

### Building / updating the encrypted reference

Raw catalogs live in `private_source/` (git-ignored — never committed).

1. Put the Seller Listings Report(s) in `private_source/` (.csv or .xlsx).
2. `pip install cryptography` (once), then
   `python3 tools/build_reference.py --password "THE TEAM PASSWORD"`
3. `git add assets/reference.enc.js && git commit -m "update reference" && git push`

Rotating the password = re-run step 2 with a new password and push (users re-enter
it once). Only the encrypted `reference.enc.js` is committed; the plaintext
catalog never leaves your machine.


## Direct printing (QZ Tray)

Print stickers straight to a label printer — no PDF, no print dialog — via
[QZ Tray](https://qz.io/download/), a small free app installed on each printing
machine. The page talks to it over a secure localhost WebSocket and sends each
label as a 60×83 mm PDF.

- **Per machine, once:** install QZ Tray and leave it running (menu-bar/tray). On
  the site click **Connect printer**, pick the printer (remembered per browser).
- **Signing:** this is a static site with no backend, so QZ runs *unsigned* — on
  first print QZ shows an **Allow** dialog; tick **Remember** and printing is
  silent from then on. (A signing key can't be shipped in a public page.)
- **Buttons:** per-row **Print**, or **🖨 Print all** (sent as one multi-page job).
  **Copies** selector applies to both. The ZIP download still works as a fallback.
- Code: [`assets/print.js`](assets/print.js) + vendored `vendor/qz-tray.js`.
  Uses PDF *pixel* printing so it works with any OS-installed printer; a Zebra/ZPL
  raw path can be added if crisper thermal output is wanted.

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
