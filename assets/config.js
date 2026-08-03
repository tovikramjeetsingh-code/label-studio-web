// ---------------------------------------------------------------------------
// FIXED VALUES — never come from the uploaded file. Edit here if an address
// ever changes (then commit + push; GitHub Pages redeploys automatically).
// ---------------------------------------------------------------------------
window.LABEL_CONFIG = {
  DESIGNED_BY:
    "Myntra Jabong India Pvt Ltd, Building Alyssa, Begonla & Clover, " +
    "Embassy Tech Village, Outer ring road, Devarabeesanahalli Village, " +
    "Varthur Hobli, Bengalore-560103 Karnataka, India",

  MANUFACTURED_BY:
    "Sapphire Wolf Fashion Private Limited, 48, PVT SHOP NO-4, GROUND FLOOR, " +
    "EAST GURUANGAD NAGAR, EAST DELHI-110092",

  COUNTRY_OF_ORIGIN: "INDIA",

  // Key that unlocks the bundled listings + item-barcode data. It lives here so
  // the team never types a password — the app opens ready to use.
  // NOTE: this is convenience, not security. Anyone who views the page source can
  // read this key and decrypt the bundles, so treat the catalog as public.
  // Set to "" to bring the password prompt back.
  REFERENCE_KEY: "ku3y-US94-M2PD-TbD3",

  // Canonical label field -> accepted header aliases (matched case-insensitively,
  // trailing ':' ignored). Used for the original "Label Template" format.
  REQUIRED_COLUMNS: {
    "brand": ["brand"],
    "article type": ["article type", "article_type", "articletype"],
    "style name": ["style name", "style_name", "stylename"],
    "style id": ["style id", "style_id", "styleid"],
    "size": ["size"],
    "seller sku code": ["seller sku code", "seller_sku_code", "seller sku", "sellersku"],
    "sku code": ["sku code", "sku_code", "skucode", "sku id", "sku"],
    "mrp": ["mrp"],
    "month & year of manufacture": [
      "month & year of manufacture", "month and year of manufacture",
      "month & year", "month year", "mfg month & year", "manufacture date",
    ],
  },

  // Format 2 — Myntra STN/SJIT summary export.
  STN_COLUMNS: {
    "brand": "brand name",
    "article type": "article type name",
    "style name": "vendor article name",
    "style id": "style id",
    "size": "size",
    "seller sku code": "vendor article no",   // label prints Vendor Article No only
    "sku code": "sku code",
    "mrp": "mrp",
  },
  STN_SIGNATURE: ["vendor article no", "brand name", "article type name"],

  // Format 3 — Myntra Seller Listings Report.
  LISTINGS_SIGNATURE: ["seller sku code", "sku code", "van", "listing status"],

  // Fields offered in the manual-mapping step (unknown formats), in order.
  MAPPABLE_FIELDS: [
    { field: "brand", label: "Brand", required: true },
    { field: "article type", label: "Article Type", required: true },
    { field: "style name", label: "Style Name", required: true },
    { field: "style id", label: "Style ID", required: true },
    { field: "size", label: "Size (SIZE box)", required: true },
    { field: "seller sku code", label: "Seller SKU (also the filename)", required: true },
    { field: "sku code", label: "SKU Code (barcode)", required: true },
    { field: "mrp", label: "MRP", required: true },
    { field: "month & year of manufacture", label: "Month & Year", required: false },
  ],
};
