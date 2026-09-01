# Choose your Genius plan

A pixel-faithful rebuild of the ET Money Genius **plan chooser** screen, as a
standalone browser page. No build step, no dependencies, no network calls —
three files (`index.html`, `style.css`, `app.js`) served straight from GitHub
Pages at `/genius/`.

## What it does

- **Three plan cards** — Genius *Mutual Funds* (₹499 → ₹299), *Stocks & SIF*
  (₹799 → ₹599) and the *2-in-One* lightning deal (₹1,298 → ₹599). Tap to
  select; the green ring, pointer and the scalloped savings band follow the
  selection. Savings are computed, not typed: `(mrp − price) × 12`.
- **Feature list follows the plan** — MUTUAL FUNDS / STOCKS & SIFS / INVESTING
  TOOLS sections are rendered from the selected plan's `sections`, so the
  Mutual Funds plan drops the stocks group and vice versa. Every row expands
  (`+` → `×`) to a one-line explanation.
- **Pay bar** stays pinned to the bottom with the offer price, the post-offer
  fee, and the gold **Proceed** button. It re-prices on every plan change, and
  the scroll padding tracks the bar's real height so nothing hides underneath.
- **Consent gate** — Proceed is blocked while the advisory-agreement checkbox is
  off; the card nudges, scrolls into view and a toast explains why.
- **Bottom sheets** for *See how?* (how the 0.05% p.m. fee compares with the
  flat fee, with the crossover corpus worked out per plan), the advisory
  agreement, and the order summary on Proceed.
- The chosen plan is remembered in `localStorage` (`genius.plan`).

Nothing is submitted anywhere — Proceed ends at a summary sheet.

## Editing the content

All copy and pricing lives at the top of [`app.js`](app.js):

- `FEATURES` — the three groups and their `[name, description]` rows.
- `PLANS` — per plan: `mrp`, `price`, the post-offer `then` fee, the tagline,
  which feature groups it shows, and `deal: true` for the lightning ribbon.

Prices, savings, quarterly billing and the fee crossover are all derived from
those numbers, so changing a price is a one-line edit.
