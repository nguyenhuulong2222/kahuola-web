<!-- SOURCE: docs/architecture/V4_8_SYSTEM_ARCHITECTURE.md -->
<!-- CATEGORY: architecture -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# V4.8 System Architecture

## Unified Web + Mobile Architecture

Status: Canonical Architecture Reference for Kahu Ola V4.8

------------------------------------------------------------------------

# 1. Architectural Goals

Kahu Ola V4.8 is designed as a **civic hazard intelligence platform**
optimized for:

-   wildfire-first hazard awareness
-   statewide disaster monitoring
-   multi-platform deployment (web, iOS, Android, wearables)
-   high reliability during disasters
-   cache-first low latency performance

The system must continue functioning even when upstream providers fail.

------------------------------------------------------------------------

# 2. High-Level Architecture

Client Layer

Web Browser iOS App Android App Watch / Lightweight Clients

↓

Edge Layer

Cloudflare CDN Edge Worker (API Gateway)

↓

Core Platform

Hazard Aggregator API Signal Composer Snapshot Builder

↓

Data Layer

Redis / KV Cache PostGIS / Historical Store R2 / Object Storage
(optional)

↓

Ingestion Layer

Pollers / CRON Jobs Queue / Scheduler Schema Validation Engine

↓

External Hazard Sources

NASA FIRMS NOAA NWS EPA AirNow USGS PacIOOS RAWS / MesoWest Additional
public hazard APIs

------------------------------------------------------------------------

# 3. Request Flow

User Request Flow:

Client → Edge Worker → Aggregator API → Cached Snapshot → Response

The request must **never directly fan-out to upstream hazard
providers**.

------------------------------------------------------------------------

# 4. Data Ingestion Flow

Poller Flow:

Scheduler → Fetch Source → Validate → Classify Freshness → Cache Write

Steps:

1.  Poller fetches upstream API
2.  Schema validation runs
3.  GeoJSON validation runs (if spatial)
4.  Freshness classification occurs
5.  Cache admission decision
6.  Snapshot update

Invalid data must never enter the cache layer.

------------------------------------------------------------------------

# 5. Signal Composition Layer

The Signal Composer transforms multiple raw feeds into a single civic
signal model.

Canonical Signals:

FireSignal SmokeSignal PerimeterSignal

Context Signals:

FloodContext StormContext RadarContext AirQualityContext OceanContext

The UI prioritizes canonical signals while context layers provide
situational awareness.

------------------------------------------------------------------------

# 6. Web vs Mobile Responsibilities

Web Platform

-   homepage dashboard
-   live map layers
-   statewide overview
-   diagnostics panels

Mobile Apps

-   simplified hero signal
-   local hazard context
-   push notifications
-   emergency deep links

Both platforms use the **same API contract**.

------------------------------------------------------------------------

# 7. Resilience Principles

The architecture enforces:

Cache-first reads\
Fail-closed validation\
Freshness-aware rendering\
Two-level transparency

The system must remain operational even if multiple upstream sources
fail simultaneously.

------------------------------------------------------------------------

# 8. System Diagram (Conceptual)

           +---------------------+
           |   Web / Mobile App  |
           +----------+----------+
                      |
                      v
             +-------------------+
             |   Edge Worker     |
             |   API Gateway     |
             +---------+---------+
                       |
                       v
             +-------------------+
             | Hazard Aggregator |
             +---------+---------+
                       |
          +------------+------------+
          |                         |
          v                         v

+-------------+ +-------------+ \| Redis Cache \| \| PostGIS DB \|
+-------------+ +-------------+ \^ \| +-------------+ \| Pollers \|
+-------------+ \| v External Hazard APIs
