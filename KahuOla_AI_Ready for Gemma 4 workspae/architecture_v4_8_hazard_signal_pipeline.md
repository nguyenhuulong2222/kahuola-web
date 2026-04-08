<!-- SOURCE: docs/architecture/V4_8_HAZARD_SIGNAL_PIPELINE.md -->
<!-- CATEGORY: architecture -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# V4.8 Hazard Signal Pipeline

## Kahu Ola Civic Hazard Intelligence Platform

Status: Production Specification\
Version: V4.8\
Audience: Engineering, Architecture, AI Coding Agents (Claude Code,
Codex, Gemini)

------------------------------------------------------------------------

# 1. Purpose

This document defines the **Hazard Signal Processing Pipeline** used by
Kahu Ola.

The pipeline transforms **raw upstream hazard detections** into
**validated civic signals** that can be safely presented to the public.

The pipeline ensures:

-   No raw data is shown without validation
-   No client directly consumes upstream APIs
-   All signals contain freshness metadata
-   Hazard priority is determined consistently
-   Civic-safe actions are always presented

------------------------------------------------------------------------

# 2. Pipeline Overview

Detection → Validation → Signal → Context → Priority → Snapshot → Safe
Civic Action

------------------------------------------------------------------------

# 3. Upstream Hazard Detection

Primary upstream data sources include:

-   NASA FIRMS --- wildfire hotspots
-   NWS api.weather.gov --- official alerts
-   NOAA Radar / MRMS --- rainfall intensity
-   NOAA HMS --- smoke plumes
-   EPA AirNow --- AQI and PM2.5
-   NIFC / WFIGS --- fire perimeters
-   PacIOOS --- coastal and ocean sensors
-   RAWS / MesoWest --- wind and humidity
-   USGS HVO --- volcanic activity
-   NHC --- tropical storm and hurricane advisories

Clients never call these APIs directly.

------------------------------------------------------------------------

# 4. Polling Layer

Background pollers retrieve upstream data at controlled intervals.

Typical intervals:

Fast feeds\
5--15 minutes

Medium feeds\
15--30 minutes

Slow feeds\
30--60 minutes

Polling occurs server-side only.

------------------------------------------------------------------------

# 5. Validation Layer

Every upstream payload is validated before processing.

Validation checks include:

-   JSON schema validation
-   GeoJSON geometry validation
-   timestamp integrity
-   required field presence

Invalid payloads are dropped entirely.

No partial render is allowed.

------------------------------------------------------------------------

# 6. Signal Normalization

Validated data is converted into unified signal models.

Examples:

FireSignal\
FloodSignal\
SmokeSignal\
StormSignal\
AirQualitySignal\
VolcanicSignal

Signals include fields such as:

signal_type\
geometry\
severity\
confidence\
source\
updated_at

------------------------------------------------------------------------

# 7. Freshness Classification

Signals are labeled based on age.

Possible states:

FRESH\
STALE_OK\
STALE_DROP

Example rule:

FireSignal

FRESH \< 15 minutes\
STALE_OK \< 60 minutes\
STALE_DROP \> 60 minutes

------------------------------------------------------------------------

# 8. Context Enrichment

Signals are enriched with contextual information:

wind direction and speed\
humidity\
rainfall intensity\
AQI / smoke conditions\
distance to populated areas\
official emergency links

Example:

Fire hotspot + wind context → FireSignal hero card.

------------------------------------------------------------------------

# 9. Event Priority Resolution

Multiple hazards may exist simultaneously.

Priority resolution determines which signal becomes the hero state.

Example order:

DEGRADED\
FIRE_ACTIVE\
FLOOD_WARNING\
FLOOD_WATCH\
STORM_ACTIVE\
VOLCANIC_WATCH\
MONITORING

------------------------------------------------------------------------

# 10. Snapshot Composition

Signals are bundled into stable snapshots used by clients.

Snapshots contain:

homepage hero summary\
island hazard summaries\
map layer summaries\
system health information

------------------------------------------------------------------------

# 11. Cache Layer

Kahu Ola uses cache-first architecture.

Typical systems:

Redis\
Cloudflare KV\
Edge CDN cache

Clients receive cached snapshots.

Workers do not call upstream APIs per request.

------------------------------------------------------------------------

# 12. Worker Aggregator

Cloudflare Worker exposes public API endpoints.

Examples:

/v1/home/summary\
/v1/home/islands\
/v1/hazards/fire\
/v1/context/flood\
/v1/system/health

Worker responsibilities:

serve cached data\
attach freshness metadata\
enforce rate limits\
handle degraded mode

------------------------------------------------------------------------

# 13. Civic UX Rendering

Client surfaces include:

homepage hero signals\
island pages\
live hazard map\
future mobile applications

The UI follows progressive disclosure:

plain-language hazard message first\
source attribution second\
technical diagnostics separately

------------------------------------------------------------------------

# 14. Safe Civic Action Layer

Kahu Ola provides links to official authorities.

Examples:

View Live Map\
Open Official Alerts\
HIEMA\
Maui EMA\
Ready Hawaiʻi

Kahu Ola never issues evacuation orders or routing instructions.

------------------------------------------------------------------------

# 15. Pipeline Summary

External Detection\
→ Polling\
→ Validation\
→ Signal Models\
→ Freshness Classification\
→ Context Enrichment\
→ Event Priority\
→ Snapshot Cache\
→ Worker API\
→ Civic UX\
→ Official Action Links
