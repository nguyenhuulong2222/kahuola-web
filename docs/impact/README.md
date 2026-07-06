# Kahu Ola — Impact Records

This folder is the append-only record for the 501(c)(3) application (2029–2030)
and future grant reviews. **JSON is the source of truth. `METRICS.md` is
generated — never edit it by hand.** Every number carries a source and a date,
and nothing is fabricated: a value we don't yet have is left as `null` and
renders as `⚠ TBD — cần điền`.

> **Git history — with each commit signed by a human — is the chain-of-custody
> of this record.** That an IRS or grant reviewer can trace every figure back to
> the commit that added it, and see it was never silently rewritten, is the whole
> point of keeping this append-only in git.

## The files

| File | What it records | Schema (per entry) |
|------|-----------------|--------------------|
| `metrics.json` | Monthly usage from Cloudflare Web Analytics (Zero-PII: aggregates, country-level max). Collected by the script. | `month, visits, page_views, top_pages[], countries{}, collected_at, source, notes[]` |
| `events.json` | Hand-editable product/hazard/media milestones, merged into the monthly detail. | `date, type ∈ {product, hazard, media}, title, source` |
| `finances.json` | Real operating expenses ("chi phí gần 0 có chứng minh" is a strength). | `date, item, amount_usd (number \| null), category ∈ {infra, services, hardware}, recurring (bool \| "monthly" \| "yearly" \| null), note` |
| `contributions.json` | Founder / volunteer in-kind hours (professional services). | `month, hours_estimate (number \| null), category ∈ {engineering, outreach, ops, governance}, note, estimate: true` |
| `engagement.json` | Evidence of external reach and community. | `date (string \| null), type ∈ {media, community-review, user-feedback, partnership, milestone}, description, source_link, note` |

**Honesty rules baked into the schema:**
- **Money and hours are `number` or `null` only** — never a guess. `null` means
  "fill from the actual invoice / receipt", and it renders loudly as `⚠ TBD`.
- **Contributed hours are estimates.** Mark every contribution row with
  `"estimate": true` (and say so in the note). The founder owns and confirms
  every figure.
- **Never fabricate a date.** If the exact day is unknown, use the month and add
  a note saying `approximate`; if unknown entirely, use `null` + a note.

## The 1st-of-the-month ritual (nghi thức mùng 1)

1. **Collect.** Run the collector for last month:
   ```sh
   node scripts/impact/collect-metrics.mjs           # previous month (default)
   node scripts/impact/collect-metrics.mjs --month=2026-07
   ```
   It appends one immutable month to `metrics.json` and regenerates `METRICS.md`.
   It is **fail-closed**: any API error or schema mismatch writes *nothing* and
   exits non-zero — a missing month is better than a wrong number.
2. **Fill new rows if there are any.** Add expenses to `finances.json`, hours to
   `contributions.json`, reach to `engagement.json`. Replace any `⚠ TBD` you can
   now confirm. **Append new entries — never rewrite an old one.**
3. **Re-render** (offline, no token needed) after hand-editing the JSON:
   ```sh
   node scripts/impact/collect-metrics.mjs --render-only
   ```
4. **Review, then commit** `docs/impact/` yourself. The signed commit *is* the
   record.

## Guarantees enforced by code (`scripts/impact/collect-metrics.mjs`)

- **Append-only merge** for `metrics.json`: a finalized month is immutable; only
  the current partial month may be refreshed until it closes.
- **Schema validation, fail-closed** for `finances` / `contributions` /
  `engagement`: a malformed entry (bad category/type, a guessed string amount, a
  bad month) makes the collector refuse to write.
- **Secret guard:** the writer refuses to emit any file containing the API token.
- **Tests:** `node scripts/impact/collect-metrics.mjs --test` (no network) covers
  the build, append-only, validators, and the fail-closed guard.

## Zero-PII

`metrics.json` records aggregates only — visits (cookie-free sessions, not
individuals) and page views, with **country** as the deepest geographic level.
No IPs, no user-level data.
