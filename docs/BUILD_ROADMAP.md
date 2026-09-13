# KAHU OLA — BUILD ROADMAP (Claude Code Prompts)

**Last updated:** 2026-09-12
**Owner:** Long Nguyen · kahuola.org
**Purpose:** Single source of truth for what gets built, in what order, and what is
done vs not. Each numbered item = one Claude Code prompt = one increment
(branch → PR → deploy → verify). **No "merge everything at once."**

## How to use

- `- [x]` = shipped & verified live · `- [ ]` = not yet shipped
- Status tag gives the nuance below.
- When an item ships: flip the checkbox, set status to `DONE`, add date to the log
  at the bottom.

**Status tags:**
`PROMPT-READY` · `NOT-STARTED` · `PLANNING` · `IN-PROGRESS` · `BLOCKED` ·
`FIX-READY` · `DEFERRED` · `DONE`

## TRACK C — Reliability / production fixes (do first — affects current users)

- [ ] **P01 · Safari iOS black screen — deploy the ready fix** — `FIX-READY`
  Fix exists for `live-map.html`, not yet deployed. Multi-browser test + cache purge
  (4h TTL) required. Touches production-locked file → careful.
- [ ] **P02 · AirNow JSON API deprecation** — `NOT-STARTED` — ⏰ deadline **2026-09-30**
  Grep `worker/src/` to confirm which AirNow endpoints are in use (likely XYZ raster
  tiles = unaffected; risk = AQI data card + `generate_insights.js`). Migrate if needed.
- [x] **P03 · NREL API migration verify** — `DONE` 2026-09-12
  Closed 2026-09-12: repo-wide grep for nrel returns zero references. No migration needed.

> Done in this track (reference): "Data format error" on live-map — **RESOLVED**.
> Worker W4–W8 routes — **LIVE** (2026-03-19, ver 160d1fe8).

## TRACK A — NASA Space Apps (Hazard Intelligence Upgrade)

- [x] **P04 · Stage 0 + Stage 1 — Fire-spread danger layer (backend)** — `DONE`
  Worker-only. FIRMS ingest (NOAA-20/21 + SNPP fallback) + heuristic + new endpoint
  `/api/hazards/fire-danger`. **CORE VALUE.** Prompt written 2026-08-02.
  Shipped: /api/hazards/fire-danger live (worker/src/index.ts).
- [ ] **P05 · Stage 1 overlay → live-map.html** — `NOT-STARTED`
  Blocked until map is bug-clean (do P01 first). Heat overlay + on-device per-address LOC.
- [ ] **P06 · Stage 2 — Smoke/AQI layer (backend)** — `NOT-STARTED`
  AirNow + PurpleAir + NASA aerosol; upwind-cluster respiratory advisory.
- [ ] **P07 · Stage 2 overlay → live-map.html** — `NOT-STARTED`
- [x] **P08 · Stage 3 — Satellite-verified citizen reports (backend + D1)** — `DONE`
  Photo + geo, FIRMS cross-check, `satellite-confirmed` vs `unverified`.
  Shipped: POST/GET /api/reports, D1 REPORTS_DB, cron cleanup.
- [ ] **P09 · Stage 3 — citizen report submit UI** — `NOT-STARTED`
- [ ] **P10 · Stage 4 — Conversational front-end** — `NOT-STARTED`
  LLM over our own hazard JSON ("is it safe at my address?"). No PII.
- [ ] **P11 · Stage 5 — SAR burn-extent tiles (Sentinel-1)** — `DEFERRED`
  Offline pipeline → R2. Do not start before P04–P10 ship.

## TRACK B — NWS integration

- [ ] **P12 · Phase 2 — Observations** — `NOT-STARTED`
- [ ] **P13 · Phase 3a — Forecast (Worker endpoint + Morning Brief via n8n)** — `PLANNING`
  Awaiting scope decision: hourly vs 7-day periods.
- [ ] **P14 · Phase 3b — Forecast card on index.html (Kupuna-friendly)** — `PLANNING`

> Done: NWS Phase 1 (Alerts) — **LIVE**.

## TRACK D — Growth / distribution

- [ ] **P15 · Feature A — Automated Data Insights (daily Maui summary .md)** — `NOT-STARTED`
  Reuses Morning Brief pipeline infra.
- [x] **P16 · Feature B — Embeddable safety widget** — `DONE`
  `<kahuola-safety-widget>`, Shadow DOM, backlink. Cloudflare Worker.
  Shipped: kahuola-widget/, widget.kahuola.org live, embedded on homepage (P58).
- [ ] **P17 · Hawaiian voice — Phase 1 (EN + VI audio)** — `IN-PROGRESS`
  Via existing n8n-ffmpeg. "🔊 Listen" on Morning Brief card.
  voice.ts + /api/voice + R2 cache exist; UI surfacing unverified.
- [ ] **P18 · Hawaiian voice — Phase 2 (ʻŌlelo Hawaiʻi)** — `NOT-STARTED`
  After cultural/pronunciation review (Kahele Dukelow — outreach not yet initiated).

> Non-prompt growth work (manual, tracked separately below): journalism outreach, GBP.

## TRACK E — Clients / i18n

- [ ] **P19 · Android / Google Play release** — `PROMPT-READY`
  5-phase engineering prompt already generated. (iOS already on App Store.)
- [ ] **P20 · i18n — live-map popup/modal deep coverage** — `IN-PROGRESS`
  Remaining untranslated modal/popup/detail strings (EN/VI). Non-destructive patches only.
- [ ] **P21 · i18n — expand 4 remaining locales** — `IN-PROGRESS`
  ʻŌlelo Hawaiʻi, Tagalog, Ilocano, 日本語 (EN/VI already locked).
  haw/tl/ilo/ja scaffolded in bundle, each ~181–194 keys short of EN.
- [ ] **P22 · Apple Watch companion — watchOS Phase 1** — `BLOCKED`
  React Native + WatchConnectivity. Blocked on Xcode watchOS target (xcodegen path exploring).

> Done: Homepage i18n EN/VI (94e5fbb), live-map i18n Phase 1 EN/VI (a9956a8).

## TRACK F — Ocean Intelligence

- [x] **P23 · Ocean backend (/api/ocean/*)** — `DONE` 2026-09-12
  NDBC buoys (51001/51101/51205/51201) + PacIOOS SWAN + NWS surf zone (SRF/HFO)
  + NHC/CPHC tropical outlook. Worker ver d763df3d, PR #27.
  Notes: rip current risk does NOT exist upstream (HFO issues no risk product) —
  risk:null by design, never derive. Buoy 51101 dead for wave data (watch via
  source_health). Outlook geometry text-only (upstream KMZ/shapefile only).
- [x] **P24 · "Surf & Ocean Safety" card on index.html** — `DONE` 2026-09-12
  PR #28. Framing "Surf & Ocean Safety" (no risk badge). Feet-first display.
  40% threshold for tropical outlook lines. Isolated loader (Invariant 8).
  19 i18n keys EN/VI.
- [ ] **P25 · Ocean overlays on live-map** — `NOT-STARTED`
  Blocked on: map bug-clean (P01 Safari), KMZ-parse decision for outlook
  geometry (parse KMZ in Worker vs card-only, decide at implementation).

## NON-PROMPT TASKS (manual — not Claude Code)

- [ ] MapTiler key domain restriction @ cloud.maptiler.com (P2)
- [ ] Journalism outreach Tier 2 (Maui Now, Hawaiʻi News Now, Civil Beat) — highest-ROI SEO lever left
- [ ] Google Business Profile submission (service-area, hide address, show Maui County)
- [ ] BRIC program status re-verify (every 6 months — volatile)
- [ ] Legal incorporation (Hawaii Form DNP-1) — `DEFERRED to 2029` (hard gate, immigration attorney first)

## CONTINUOUS

- [ ] Nonprofit Phase 0 — evidence accumulation in `docs/impact/` (ongoing)

## RECOMMENDED EXECUTION ORDER

1. **P02** (AirNow — deadline 2026-09-30, live production dependency: /api/hazards/air JSON API powers homepage AQI + ocean card)
2. **P01** (Safari fix — unblocks all future map overlays)
3. **P05** (Stage 1 overlay — only after P01 clears the map)
4. **P06 → P07** (Stage 2 Smoke/AQI pair)
5. **P19** (Android release — prompt ready, parallelizable)
6. **P15** (insights), then P09–P10, NWS P12–P14, i18n P20–P21, P25, remainder.

Rationale: P03 closed as a no-op (zero nrel references) and P04 already shipped, so the
only hard deadline left leads → then fix the map (bug + Safari) so overlays have a clean
surface → then everything that renders on the map, in order.

## UPDATE LOG

- 2026-08-02 — Roadmap created. Reconciled vs memory: "Data format error" RESOLVED,
  Worker W4–W8 LIVE (both removed from pending). Stage 0+1 fire-danger prompt written.
- 2026-09-12 — TRACK F opened. P23 + P24 shipped same day (backend ver d763df3d,
  PRs #27/#28). Ocean card moved to always-visible in follow-up.
- 2026-09-12 — Reconciled roadmap vs repo reality (file was 6 weeks stale):
  P04/P08/P16 → DONE, P17/P21 → IN-PROGRESS, P03 closed (zero nrel refs).
  P02 re-ranked #1 — airnowapi.org/aq/data (index.ts:4021) is the deprecated
  JSON API and powers /api/hazards/air.
