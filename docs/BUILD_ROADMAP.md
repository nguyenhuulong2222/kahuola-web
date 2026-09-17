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

- [x] **P01 · Safari iOS black screen** — `DONE` (shipped 2026-03-08, verified 2026-09-16)
  **No code change was needed — the fix was already live.** The "ready fix" is
  `safeMapResize()` in live-map.html (multi-pass `map.resize()` behind two
  nested `requestAnimationFrame`s plus 100/300/600 ms settle passes), wired to
  `resize`, `orientationchange`, `pageshow` (bfcache), `visibilitychange` and
  `focus`. It landed in commits 873a82d / 943512a / 1218a8b / fc1043f on
  2026-03-08 (an earlier `safeResize` was renamed to `safeMapResize` in
  fc1043f, which is why searching for the old name finds only history).
  Production and `main` are byte-identical (438,521 bytes), so it had already
  deployed; the entry was simply never closed.
  Verified 2026-09-16 on the iOS 26 Simulator (iPhone 17, Mobile Safari): map
  renders on cold load and again after a background→foreground app-switch, no
  black screen. Desktop Chrome EN+VI: canvas non-zero through a resize cycle,
  11 lazy modules open, 0 raw i18n keys, no console errors.
  ⚠ The old note said "cache purge (4h TTL)". That is wrong: `_headers` sets
  `/live-map` and `/live-map.html` to `max-age=30, must-revalidate` and
  Cloudflare reports `cf-cache-status: DYNAMIC`, so a deploy reaches users in
  about 30 s and no manual purge is required.
- [x] **P02 · AirNow JSON API deprecation** — `DONE` 2026-09-12
  Closed as a no-op: **nothing we use is retiring.** EPA's official notice
  (`docs.airnowapi.org/docs/AirNowAPIUpdates2026June.pdf`) retires six services on
  2026-09-30 — `/aq/forecast/{zipCode,latLong}/`, `/aq/observation/{zipCode,latLong}/current/`,
  `/aq/observation/{zipCode,latLong}/historical/`. Repo-wide grep: **zero references to
  any of the six.** Our three AirNow-adjacent surfaces are all clear:
  · `/api/hazards/air` -> `/aq/data/` (index.ts:4021), listed **"Remain"** in the notice's
    own table ("Hourly Observations by Monitoring Site - Bounding Box"). Verified live:
    15 monitors, freshness FRESH.
  · `/api/tiles/xyz/airnow/*` -> proxies `tiles.aqicn.org`, not an AirNow API endpoint at
    all (the route name is historical; `tiles.airnowtech.org` is long defunct).
  · `scripts/insights/generate_insights.js` -> **no AirNow reference**; the 2026-08-02 note
    flagging it was wrong.
  Do NOT "migrate" `/aq/data/` to the new `/aq/dailydata/`: that sibling service is DAILY
  observations, and the AQI card needs HOURLY. Switching would degrade the data.
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
- [x] **P25 · Ocean intelligence on live-map** — `DONE` 2026-09-16
  Folded into the EXISTING "Coastal & Surf" module rather than added as its own
  card: that module already owns the ocean slot, and a second ocean-ish card
  beside it would make a reader choose between two entries answering the same
  question. NWS alerts stay the headline; four sub-blocks sit beneath —
  surf by shore, tropical outlook, surf zone forecast, water quality.
  Loads on the module's existing lazy click via a bespoke 4-endpoint
  Promise.allSettled. NOT a HAZARD_REGISTRY entry: refreshHazard() fetches one
  endpoint and parses synchronously, and refactoring it is off-limits on a
  production-locked file.
  ⚠ The brief called for the "LAZY_MODULES + event-delegation pattern". That
  object is EMPTY and the pattern was deliberately abandoned — its own comment
  records that leaving entries in it made the document-level bubble handler
  overwrite translated content with hardcoded English. The live pattern is
  lazyLoadModule() + per-element listeners in bindButtons(); that is what this
  follows.
  ⚠ Surf MARKERS deferred to P25b: /api/ocean/surf carries no lat/lon on any
  signal, and keeping an NDBC/SWAN coordinate table in live-map.html is exactly
  what that file forbids ("never re-derived... a second, drifting copy of the
  Worker's allowlist"). The Worker already holds verified positions for all
  four buoys and four SWAN points; emitting lat/lon per signal is a small
  backend change. No dead layer, source or click-chain entry was shipped.
  Tropical outlook is non-geometric by upstream constraint (NHC ships GTWO as
  KMZ/shapefile only) — card list, no KMZ parser, matching P23's finding.
- [ ] **P25b · Surf markers on live-map** — `NOT-STARTED`
  Blocked on: /api/ocean/surf emitting lat/lon per signal (Worker-side, small).
  Then a teal marker layer + popup, sentinels styled distinctly.
- [ ] **P26 · Wind Arrival Timeline** — `NOT-STARTED`
  NHC "earliest reasonable arrival of TS-force winds" + wind speed probability
  grids. Answers "when could storm winds reach my island" — extends the
  existing Hurricane module/NHC handler, not a new module. Best built/verified
  while a real storm is active.
- [x] **P27 · Brown Water Advisory** — `DONE` 2026-09-15
  New route `/api/ocean/water-quality` + a "Water quality" block on the existing
  Surf & Ocean Safety card. **Two sources, never blended.**
  (a) OFFICIAL — a machine-readable DOH feed DOES exist and is primary:
  `eha-cloud.doh.hawaii.gov/cwb/api/events?expand=locations&status=Open` (JSON,
  no key — the endpoint DOH's own public viewer calls). Verified live: 8 open
  events, 6 of them Brown Water Advisories.
  ⚠ Parsing trap: the `hasBwa` boolean does NOT mean "is a Brown Water
  Advisory" — it was true on a Sewage Spill and a Beach Advisory and false on
  all six real BWAs. Key on `type`.
  (b) DERIVED — `runoff_caution` from NWS Flash Flood Warnings in the past 72 h,
  joined to islands by UGC COUNTY code (HIC001 etc.), never by areaDesc name
  matching. `/api/hazards/flash-flood` is a current snapshot with no history, so
  the lookback uses the same NWS origin over a time range. Labelled "Derived
  from NWS flash flood warnings · Kahu Ola", never as a DOH advisory; an island
  with a DOH advisory does not also get one.
  Quiet ocean = signals [], status "clear", HTTP 200.
  UI relocated: homepage block removed (P27b); **restored on live-map** inside
  the Coastal & Surf module (P25, 2026-09-16). Backend route unchanged
  throughout.
- [x] **P27c · Water Quality map layer** — `DONE` (2026-09-16)
  DOH ships geometry, so the advisory is drawn where it actually applies.
  `locations[].geometry` carries WKT POLYGON shoreline strings (686-3,855
  chars) plus `centroid` POINT values; Beach Advisories carry a POINT geometry.
  Worker parses WKT→GeoJSON in-house (POINT / LINESTRING / POLYGON /
  MULTILINESTRING / MULTIPOLYGON) — no dependency, far simpler than the
  KMZ/GRIB2 dead ends in P23/P26. Every position is range-checked
  (lon ∈ [-180,180], lat ∈ [-90,90], no NaN/Inf) and rings must be explicitly
  closed — rings are never auto-closed.
  **Fail-closed per record:** malformed WKT → `geometry: null`,
  `centroid: null`, and the advisory still ships as text. A real advisory is
  never dropped over bad geometry and coordinates are never guessed — the
  centroid is DOH's own `centroid` field, never computed from the polygon.
  A POINT advisory is its own centroid, so it emits one marker, not two.
  `runoff_caution` is island-derived and carries no geometry by design.
  Map: amber (`#ffcc66`) `water-quality-fill` / `-outline` / `-point` —
  deliberately NOT red (flash flood warning / tsunami only) and NOT teal
  (surf). `layer_class: "context"` — never enters the Event Priority ladder.
  Verified 6/6 against the DOH viewer, 5 with geometry; the Kauaʻi island-wide
  advisory has no `locations[]` and correctly ships text-only.
  ⚠ Stacking is decided by `raiseFireLayersAboveOverlays()`, not by call order
  in `ensureLayers()` — that pass re-stacks an explicit id list on every
  `style.load`. Water-quality sits directly under `flash-flood-*` there.
  ⚠ Pre-existing, NOT fixed here: that same list already stacks
  `flood-context-*` above `flash-flood-*`, so a terrain estimate draws over a
  Flash Flood Warning. Water-quality is under both. Worth a separate look.
- [ ] **P28 · Tide + King Tide** — `NOT-STARTED`
  NOAA CO-OPS tide predictions + observed water level (Kahului, Honolulu,
  Hilo stations, free JSON). Coastal flood context when king tide coincides
  with large swell.
- [ ] **P29 · Vog Forecast** — `NOT-STARTED`
  UH Mānoa VMAP 60-hour vog dispersion. High value for Kona/Kaʻū residents;
  complements AQI/SmokeSignal. Verify VMAP data access terms at
  implementation time (academic model — confirm it's fetchable, not
  scrape-only).

P26–P29 are queued candidates, not commitments — none starts before P01 and
P25 ship. Priority within the four: P26 if a storm is active, else P27.

## NON-PROMPT TASKS (manual — not Claude Code)

- [ ] MapTiler key domain restriction @ cloud.maptiler.com (P2)
- [ ] Journalism outreach Tier 2 (Maui Now, Hawaiʻi News Now, Civil Beat) — highest-ROI SEO lever left
- [ ] Google Business Profile submission (service-area, hide address, show Maui County)
- [ ] BRIC program status re-verify (every 6 months — volatile)
- [ ] Legal incorporation (Hawaii Form DNP-1) — `DEFERRED to 2029` (hard gate, immigration attorney first)

## CONTINUOUS

- [ ] Nonprofit Phase 0 — evidence accumulation in `docs/impact/` (ongoing)

## RECOMMENDED EXECUTION ORDER

1. **P01** (Safari fix — unblocks all future map overlays)
2. **P05** (Stage 1 overlay — only after P01 clears the map)
3. **P06 → P07** (Stage 2 Smoke/AQI pair)
4. **P19** (Android release — prompt ready, parallelizable)
5. **P15** (insights), then P09–P10, NWS P12–P14, i18n P20–P21, P25, remainder.

Rationale: P02 and P03 both closed as no-ops (no retiring AirNow endpoint in use; zero
nrel references) and P04 already shipped, so **no hard deadline remains**. The map bug
(Safari) now leads, because every remaining overlay renders on it → then the overlays in
dependency order → then the parallelizable and growth work.

## UPDATE LOG

- 2026-08-02 — Roadmap created. Reconciled vs memory: "Data format error" RESOLVED,
  Worker W4–W8 LIVE (both removed from pending). Stage 0+1 fire-danger prompt written.
- 2026-09-12 — TRACK F opened. P23 + P24 shipped same day (backend ver d763df3d,
  PRs #27/#28). Ocean card moved to always-visible in follow-up.
- 2026-09-12 — Reconciled roadmap vs repo reality (file was 6 weeks stale):
  P04/P08/P16 → DONE, P17/P21 → IN-PROGRESS, P03 closed (zero nrel refs).
  P02 re-ranked #1 — airnowapi.org/aq/data (index.ts:4021) is the deprecated
  JSON API and powers /api/hazards/air.
- 2026-09-12 — P02 closed as a no-op after reading EPA's official retirement notice.
  `/aq/data/` is marked "Remain", not retiring; the six retiring services are the
  zipCode/latLong forecast + observation endpoints, none of which this repo calls.
  Corrects the previous log line, which assumed /aq/data was the deprecated API.
  No Worker change shipped.
- 2026-09-15 — Queued P26–P29 (ocean Tier 2: wind arrival, brown water,
  tides, vog) after TRACK F P23/P24 shipped. Deferred remaining ocean ideas
  (tsunami travel time, marine zones, run-up, SST) — revisit after P26–P29.
- 2026-09-15 — P27 shipped. /api/ocean/water-quality (DOH advisories + derived
  runoff caution) and the Water quality block on the homepage ocean card. DOH
  publishes a usable JSON API, so this is a+b, not b-only.
- 2026-09-16 — P27b: Water Quality block removed from the homepage (8 statewide
  advisory rows against the 5-second rule). /api/ocean/water-quality stays live
  and untouched; i18n keys retained for reuse. Returns in the live-map Ocean
  module when P25 ships.
- 2026-09-16 — P01 closed with no code change: the Safari iOS fix
  (safeMapResize + orientationchange/pageshow/visibilitychange/focus) shipped
  2026-03-08 and production already matches main byte-for-byte. Re-verified on
  the iOS Simulator. Corrected the stale "4h TTL" note — live-map HTML is
  max-age=30, must-revalidate, cf-cache-status DYNAMIC.
- 2026-09-16 — P27c shipped: DOH water-quality advisories now render as an
  amber shoreline layer on live-map, with a server-side WKT→GeoJSON parser in
  worker/src/ocean.ts. Fail-closed per record; DOH's own centroid only. 36/36
  unit tests on today's live DOH geometry; 6/6 parity with the DOH viewer.
  iOS Safari verification NOT run this session — the Xcode license gate blocked
  `xcrun simctl`; desktop Chrome only.
- 2026-09-16 — P25 shipped: ocean intelligence folded into the Coastal & Surf
  module (surf / tropical outlook / surf zone / water quality), restoring the
  P27 water-quality block on live-map. Surf markers deferred to P25b pending
  coordinates in the surf payload. Recorded P27c: DOH ships WKT polygons.
