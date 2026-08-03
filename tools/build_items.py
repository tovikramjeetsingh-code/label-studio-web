#!/usr/bin/env python3
"""Build assets/items.enc.js — the ENCRYPTED item-barcode map — from the OMS
item-barcode export(s) in private_source_items/.

Maps every item barcode (IB…) to its OMS SKU code, so the STN scan tab can turn
a scanned item barcode into a product and print its 60x83 label.

Same crypto as build_reference.py (AES-256-GCM, PBKDF2-HMAC-SHA256, 200k iters)
and the SAME team password, so one unlock covers both bundles.

Accepts either shape of OMS export:
  * full export      — ItemBarcode, Sku Code, Product Name, …
  * per-batch export — item_barcode, sku_code, product_name, po_number, grn_number

Usage:
    python3 tools/build_items.py --password "the team password"
    # or set REF_PASSWORD in the environment

private_source_items/ is git-ignored — raw item data is never committed.
"""
import argparse, base64, csv, glob, json, os, datetime, sys

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
except ImportError:
    sys.exit("Missing dependency: pip install cryptography")

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "private_source_items")
OUT = os.path.join(HERE, "..", "assets", "items.enc.js")
ITERS = 200_000

BARCODE_ALIASES = ["itembarcode", "item barcode", "item_barcode"]
SKU_ALIASES = ["sku code", "sku_code", "skucode"]
NAME_ALIASES = ["product name", "product_name", "productname"]


def pick(lut, aliases):
    for a in aliases:
        if a in lut:
            return lut[a]
    return None


def clean(v):
    s = ("" if v is None else str(v)).strip()
    return "" if s.lower() == "nan" else s


B36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def b36(n):
    if n == 0:
        return "0"
    s = ""
    while n:
        n, r = divmod(n, 36)
        s = B36[r] + s
    return s


def rle(values):
    """[a,a,a,b] -> [(a,3),(b,1)] — item barcodes are issued in contiguous runs,
    so this collapses ~292k entries into ~14k/27k runs."""
    out, cur, n = [], values[0], 1
    for v in values[1:]:
        if v == cur:
            n += 1
        else:
            out.append((cur, n))
            cur, n = v, 1
    out.append((cur, n))
    return out


def encode_runs(runs):
    return ",".join(b36(v) + ("" if n == 1 else "*" + b36(n)) for v, n in runs)


def build_map():
    files = sorted(glob.glob(os.path.join(SRC, "*.csv")))
    if not files:
        sys.exit(f"No item-barcode CSVs in {os.path.abspath(SRC)} — put the OMS export(s) there first.")

    skus, sku_idx, names, sources = [], {}, {}, []
    pairs = set()          # (barcode number, sku index)
    prefix = None
    for path in files:
        with open(path, newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            lut = {(c or "").strip().lower().rstrip(":"): c for c in (reader.fieldnames or [])}
            bc_col, sku_col = pick(lut, BARCODE_ALIASES), pick(lut, SKU_ALIASES)
            name_col = pick(lut, NAME_ALIASES)
            if not bc_col or not sku_col:
                print(f"  ! skipped {os.path.basename(path)} (no item-barcode / sku-code columns)")
                continue
            n = 0
            for r in reader:
                bc, sku = clean(r.get(bc_col)).upper(), clean(r.get(sku_col))
                if not bc or not sku or not bc[2:].isdigit():
                    continue
                if prefix is None:
                    prefix = bc[:2]
                elif bc[:2] != prefix:
                    sys.exit(f"Mixed item-barcode prefixes ({prefix} vs {bc[:2]}) — the encoder assumes one.")
                key = sku.lower()
                if key not in sku_idx:
                    sku_idx[key] = len(skus)
                    skus.append(sku)
                    if name_col:
                        names[str(sku_idx[key])] = clean(r.get(name_col))
                pairs.add((int(bc[2:]), sku_idx[key]))
                n += 1
        sources.append(f"{os.path.basename(path)} ({n})")

    if not pairs:
        sys.exit("No usable item-barcode rows found.")
    ordered = sorted(pairs)
    deltas = [ordered[i][0] - ordered[i - 1][0] for i in range(1, len(ordered))]
    return {
        "meta": {"items": len(ordered), "skus": len(skus),
                 "built": datetime.date.today().isoformat(), "sources": sources},
        "prefix": prefix,
        "n0": ordered[0][0],
        "d": encode_runs(rle(deltas)) if deltas else "",
        "s": encode_runs(rle([p[1] for p in ordered])),
        "skus": skus, "names": names,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--password", default=os.environ.get("REF_PASSWORD", ""))
    args = ap.parse_args()
    if not args.password:
        sys.exit("Provide the team password via --password or REF_PASSWORD env var.")

    data = build_map()
    plaintext = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

    salt, iv = os.urandom(16), os.urandom(12)
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERS)
    key = kdf.derive(args.password.encode("utf-8"))
    ct = AESGCM(key).encrypt(iv, plaintext, None)

    enc = {"v": 1, "iters": ITERS,
           "salt": base64.b64encode(salt).decode(),
           "iv": base64.b64encode(iv).decode(),
           "ct": base64.b64encode(ct).decode()}
    with open(OUT, "w", encoding="utf-8") as out:
        out.write("// Encrypted item-barcode map — generated by tools/build_items.py.\n")
        out.write("// Public ciphertext; unreadable without the team password.\n")
        out.write("window.ITEM_ENC = ")
        json.dump(enc, out, separators=(",", ":"))
        out.write(";\n")
    print(f"Wrote {OUT}")
    print(f"  {data['meta']['items']} item barcodes -> {data['meta']['skus']} SKUs")
    print(f"  from {', '.join(data['meta']['sources'])}")
    print(f"  encrypted {len(plaintext)} bytes -> {len(enc['ct'])} b64 chars")


if __name__ == "__main__":
    main()
