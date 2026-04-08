<!-- SOURCE: docs/architecture/V4_8_API_CONTRACT.md -->
<!-- CATEGORY: architecture -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# V4.8 API Contract

## Standard Client Endpoints

Status: Stable API Contract for Web and Mobile

------------------------------------------------------------------------

# 1. Purpose

This document defines the canonical endpoints used by all Kahu Ola
clients.

Web and mobile clients must rely exclusively on these endpoints.

------------------------------------------------------------------------

# 2. Base URL

https://api.kahuola.org/v1

------------------------------------------------------------------------

# 3. Homepage Endpoints

Hero Summary

GET /home/summary

Response

primary_hazard severity_level freshness actions\[\] sources\[\]

------------------------------------------------------------------------

Island Overview

GET /home/islands

Response

islands\[\] hazard_state freshness

------------------------------------------------------------------------

Map Snapshot

GET /home/map

Response

island_markers\[\] signal_colors\[\]

------------------------------------------------------------------------

# 4. Hazard Signal Endpoints

Fire Signals

GET /hazards/fire

Parameters

region since

------------------------------------------------------------------------

Smoke Signals

GET /hazards/smoke

------------------------------------------------------------------------

Fire Perimeters

GET /hazards/perimeters

------------------------------------------------------------------------

# 5. Context Endpoints

Flood Context

GET /context/flood

Storm Context

GET /context/storm

Radar Context

GET /context/radar

Air Quality

GET /context/air

Ocean Context

GET /context/ocean

------------------------------------------------------------------------

# 6. Health Endpoint

GET /system/health

Response

status freshness source_health_summary

------------------------------------------------------------------------

# 7. Freshness Fields

All responses must include

generated_at freshness_state source

------------------------------------------------------------------------

# 8. Error Policy

429 Rate Limit

Client must cooldown and retry later.

500 Internal Error

Client displays degraded banner.

No endpoint may return undefined schema fields.

------------------------------------------------------------------------

# 9. Security Rules

Clients must never:

store upstream API keys\
call upstream APIs directly\
infer hazard conditions locally

All hazard interpretation must occur server-side.
