# KAHUOLA AI System Manifest

This file is the fastest possible system briefing for any AI assistant working on Kahu Ola.

Project:
- Repository: nguyenhuulong22/kahuola-web
- Platform: Cloudflare Pages + Cloudflare Workers
- Domain: kahuola.org
- Region focus: Hawaiʻi
- Primary public mission: civic hazard situational awareness

---

# What Kahu Ola Is

Kahu Ola is a civic hazard intelligence platform for Hawaiʻi.

It translates public hazard data into clear, calm, mobile-friendly hazard signals for residents.

Primary hazards:
- wildfire
- flood
- storm
- air quality
- volcanic activity
- ocean / coastal context

The homepage must follow a 5-second civic dashboard model:
- users should understand the current hazard state within five seconds

---

# Core Architecture

Kahu Ola uses a strict stateless-client architecture.

Required flow:

Client
→ Cloudflare Worker
→ validated cache / upstream hazard sources

Clients must never call upstream APIs directly.

Upstream data sources include:
- NASA FIRMS
- NOAA
- NWS
- EPA AirNow
- USGS
- PacIOOS
- RAWS
- NIFC WFIGS

---

# Production Rule

Production must use real hazard data only.

Forbidden in production:
- mock hazard states
- placeholder endpoints
- fake signal cards
- hardcoded “demo” hazard values

Mock states are allowed only for:
- development preview
- documentation
- design review

---

# Reliability Rules

The UI must never show a blank screen.

All hazard data must pass:
- validation
- freshness classification
- signal normalization
- event priority selection

Freshness states:
- FRESH
- STALE_OK
- STALE_DROP

If data is too limited, the system must render:
- DEGRADED state

Stale or degraded conditions must always be labeled.

---

# Hazard Logic

Signal model includes:
- FireSignal
- FloodSignal
- StormSignal
- SmokeSignal
- AirQualitySignal
- VolcanicSignal
- OceanSignal
- FireWeatherSignal

Hero selection is deterministic.

Default priority: DEGRADED FIRE_ACTIVE FLOOD_WARNING FLOOD_WATCH STORM_ACTIVE VOLCANIC_WATCH MONITORING 
Homepage is statewide.
Island pages are locally relevant.

Fire-first doctrine remains active even when storm/flood context exists.

---

# UI / UX Rules

Homepage structure:
- top utility bar
- hero banner
- signal stack
- context strip
- mini Hawaiʻi map
- island signals
- official links
- civic disclaimer

Important naming:
- “Rain Radar” only for radar
- orange fire markers = “Wildfire Signal / NASA FIRMS”
- flood polygons = “Flood Context”
- tsunami/coastal = “Coastal Alerts”
- wind/lightning = “Fire Weather”

The system must remain calm, civic, and non-sensational.

Preferred principle:
E mālama pono.

---

# Known Historical Bugs That Must Never Return

Do not reintroduce:
- wrong popup identity
- hidden layers still capturing clicks
- flood popup opening when clicking fire marker
- stale data shown without label
- browser direct calls to upstream APIs
- production pages using fake data

Strict map rules:
- click handlers must target exact layers
- hidden layers must use visibility:none
- popup identity must be independent of active tab/module
- parse failures must drop data, not render wrong types

---

# Worker / API Contract

Current important endpoints:
- /v1/home/summary
- /v1/hazards/fire
- /v1/context/flood
- /v1/context/storm
- /v1/system/health
- /v1/system/status

Homepage expects:
- primary_event
- fire_count
- flood_count
- storm_count

Worker responsibilities:
- cached reads
- schema validation
- freshness labeling
- degraded-safe responses

---

# Cloudflare Notes

Deployment stack:
- Cloudflare Pages for web
- Cloudflare Workers for API
- Cloudflare KV / cache for signal snapshots

Worker config must not expose secrets.
Use env vars / secrets for real API configuration.

---

# Required Reading Order

Before modifying code, read in this order:
 docs/architecture/V4_8_MASTER_INDEX.md docs/architecture/KAHUOLA_AI_SYSTEM_MANIFEST.md docs/doctrine/Kahu_Ola_V4_7_Doctrine.md docs/doctrine/V4_8_RUNTIME_PROTECTION_ADDENDUM.md docs/doctrine/PROJECT_HANDOFF_RULES.md docs/doctrine/SYSTEM_INVARIANTS.md docs/architecture/CURRENT_PRODUCTION_STATUS.md docs/architecture/V4_8_SYSTEM_ARCHITECTURE.md docs/architecture/V4_8_CLIENT_ARCHITECTURE.md docs/architecture/V4_8_HAZARD_SIGNAL_PIPELINE.md docs/api/V4_8_API_CONTRACT.md docs/api/V4_8_SIGNAL_MODEL_SPEC.md docs/api/V4_8_DATA_FRESHNESS_POLICY.md docs/runtime/V4_8_STATE_MACHINE.md docs/runtime/V4_8_EVENT_PRIORITY_SPEC.md docs/runtime/V4_8_MULTI_HAZARD_DECISION_TREE.md docs/map/V4_8_MAP_LAYER_SPEC.md docs/ux/V4_8_HOMEPAGE_HERO_SPEC.md docs/ux/V4_8_ALERT_COPY_GUIDELINES.md docs/ux/V4_8_DEGRADED_STATE_UX_SPEC.md 
---

# Required AI Working Method

Before making changes, the AI must: summarize the current architecture summarize production rules list exact files it plans to modify explain how the change preserves V4.8 invariants avoid replacing architecture with a simpler but incompatible shortcut 
If anything conflicts with these rules, the manifest overrides convenience.
