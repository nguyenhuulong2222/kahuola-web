# Kahu Ola — Impact Metrics

> Auto-generated from `metrics.json` + the sibling records (`events`, `finances`,
> `contributions`, `engagement`) by `scripts/impact/collect-metrics.mjs`. **Do not
> edit by hand** — edit the JSON and regenerate (`node scripts/impact/collect-metrics.mjs
> --render-only`). Every figure carries source + collection date. `⚠ TBD — cần điền` = a
> placeholder awaiting a real, human-confirmed value (never fabricated).

**Source:** Cloudflare Web Analytics (RUM), dataset `rumPageloadEventsAdaptiveGroups`, bots excluded.
**visits** = visits (sessions — cookie-free measurement; not unique individuals).
**page views** = page views = count of pageload events; bots excluded by Cloudflare RUM.
**Geography:** country is the deepest geographic level collected (Zero-PII: no IP, no user-level data).

## Monthly time series

| Month | Visits | Page views | Top page | Countries | Note |
|-------|-------:|-----------:|----------|----------:|------|
| 2026-07 | 29 | 57 | / (39) | 1 | partial month (collected 2026-07-05; month not yet complete) |

## Monthly detail

### 2026-07
- Visits: **29** · Page views: **57** · collected 2026-07-05T23:44:44Z
- Note: partial month (collected 2026-07-05; month not yet complete)
- Events:
  - 2026-07-03 · [product] Live-map summary API ported to monolith (cross-colo) (PR #14/#15)
  - 2026-07-04 · [product] Homepage Hawaiʻi Hazard Snapshot card launched (PR #18)
  - 2026-07-04 · [product] Summary read-through warming (cross-colo consistency) (PR #17)
  - 2026-07-05 · [product] Volcanic zone classification — FIRMS thermal tagging (Layer A) (PR #19)
  - 2026-07-05 · [product] Honest FIRMS wording + volcanic advisory switching, 6-locale i18n (Layer B) (PR #20/#21)
  - 2026-07-05 · [product] Morning brief generator (Layer-A template + gated Gemma) (PR #22)
- Top pages:
  - / — 39 page views
  - /live-map — 11 page views
  - /privacy — 4 page views
  - /support — 2 page views
  - /about — 1 page views
- Countries (Zero-PII, country-level only): United States (US): 57 pv / 29 visits

## Finances (expenses)

| Date | Item | Amount (USD) | Category | Recurring | Note |
|------|------|-------------:|----------|-----------|------|
| 2026 | Apple Developer Program | $99 | services | yes | Annual membership — standard public price; confirm exact charge date/amount from the Apple receipt. |
| 2026 | Domain: kahuola.org | ⚠ TBD — cần điền | infra | yes | Annual registration — fill actual amount from the registrar invoice. |
| 2026 | Cloudflare (Pages / Workers / Web Analytics) | $0 | infra | yes | Free tier as of 2026-07; update if a paid plan is added. |
| 2026 | MapTiler (map tiles / basemaps API) | ⚠ TBD — cần điền | services | yes | Plan/tier TBD — fill actual amount and cadence (monthly/yearly) from the MapTiler invoice; may still be on the free tier. |
| 2026 | Mac Mini (self-hosted infra) | ⚠ TBD — cần điền | hardware | no | One-time hardware for self-hosted tooling (n8n, collectors). Ongoing electricity is minor/self-absorbed — treat as in-kind unless separately claimed. Fill purchase price from the receipt if capitalizing. |

_Confirmed total: **$99** (excludes rows with amount not yet confirmed — filled from invoices)._

## Contributed hours (estimates)

| Month | Hours (est.) | Category | Note |
|-------|-------------:|----------|------|
| 2026-07 | 40 | engineering | ESTIMATE (rough placeholder — founder to confirm). Hazard-platform development: summary read-through, homepage insights card, volcanic-zone classification + advisory, 6-locale i18n, morning-brief generator, impact-metrics tooling (PRs #14–#23). |

_Total (rough estimate): **40 hours**. Founder-owned figures — refine with actuals._

## Engagement & reach

- ⚠ TBD — cần điền · [partnership] iOS app live on the Apple App Store _(Fill the actual approval/live date from App Store Connect.)_
- 2026-07-05 · [community-review] ʻŌlelo Hawaiʻi + Ilocano translation review requested (AI-drafted volcanic/VOG strings; awaiting native/community confirmation) — PR #20 _(Pending — track resolution and add a follow-up entry when reviewed.)_
- 2026-07-05 · [milestone] Volcanic-zone classification + honest FIRMS advisory wording shipped (thermal tagging, advisory switching) — PR #19/#20 _(Dates from events.json (product history); PR-linked.)_
- 2026-07-05 · [milestone] 6-locale internationalization complete across the hazard UI (incl. ʻŌlelo Hawaiʻi and Ilocano) — PR #20/#21 _(Dates from events.json (product history); PR-linked.)_
- 2026-07-05 · [milestone] Morning Brief generation pipeline built (Layer-A template + gated Gemma summarizer) — PR #22 _(Dates from events.json (product history); PR-linked.)_
