# V4.8 Worker Aggregator Specification

## Cloudflare Worker Design for Multi-Source Hazard Aggregation

**Status:** Authoritative V4.8 Worker Aggregator Spec\
**Audience:** Backend engineers, platform engineers, Cloudflare Worker
implementers, AI coding agents

------------------------------------------------------------------------

# 1. Purpose

This document defines how Kahu Ola should implement its Cloudflare
Worker / Edge Gateway layer when integrating multiple upstream hazard
sources.

The Worker Aggregator must support:

-   single client boundary
-   multi-source hazard ingestion
-   cache-first reads
-   graceful degradation
-   rate-limit resilience
-   web/mobile parity

The Worker must **not** be interpreted as a live fan-out engine that
calls all upstream APIs for every user request.

------------------------------------------------------------------------

# 2. Core Principle

The Worker Aggregator is a **read gateway**, not the primary ingestion
engine.

Correct model:

Pollers / CRON / scheduled jobs → upstream APIs\
Validation → freshness classification → cache write\
Client → Worker → cached snapshot / aggregated response

Incorrect model:

Client → Worker → 16 live upstream requests

------------------------------------------------------------------------

# 3. Responsibilities of the Worker

The Worker Aggregator is responsible for:

-   exposing stable Kahu Ola API endpoints
-   reading cached hazard snapshots
-   composing multi-signal responses
-   applying freshness labels
-   returning degraded responses safely
-   enforcing platform-safe response contracts
-   shielding clients from upstream complexity

The Worker is **not** responsible for:

-   uncontrolled live fan-out
-   per-request multi-provider aggregation
-   client-side schema guessing
-   hiding stale data

------------------------------------------------------------------------

# 4. Upstream Source Classes

The Worker ecosystem may integrate these source families:

-   NASA FIRMS
-   NWS api.weather.gov
-   NOAA radar / weather services
-   EPA AirNow
-   NOAA HMS
-   NIFC / WFIGS
-   NOAA GOES-West
-   PacIOOS
-   MesoWest / RAWS
-   USGS HVO
-   and additional public hazard sources

These sources should be normalized before cache admission.

------------------------------------------------------------------------

# 5. Layered Runtime Topology

Recommended architecture:

Client Layer - Web browser - iOS app - Android app - Wearable /
lightweight client

Edge Layer - Cloudflare Worker - Optional CDN cache - API Gateway
contract

Core Layer - Hazard Aggregator logic - Snapshot Composer - Freshness
classifier

Data Layer - Redis / KV - PostGIS / historical store - R2 / object
storage (optional)

Ingestion Layer - Pollers - scheduled jobs - retry queue - validation
pipeline

------------------------------------------------------------------------

# 6. Endpoint Contract Responsibilities

The Worker should expose stable endpoints such as:

-   /v1/home/summary
-   /v1/home/islands
-   /v1/home/map
-   /v1/hazards/fire
-   /v1/hazards/smoke
-   /v1/hazards/perimeters
-   /v1/context/flood
-   /v1/context/storm
-   /v1/context/radar
-   /v1/context/air
-   /v1/context/ocean
-   /v1/system/health

The client must never need to know the names or URLs of upstream
providers.

------------------------------------------------------------------------

# 7. Aggregation Model

## 7.1 Canonical signals

Canonical wildfire-first signals: - FireSignal - SmokeSignal -
PerimeterSignal

## 7.2 Context signals

Context signals may include: - FloodSignal - StormSignal - RadarSignal -
AirQualitySignal - OceanSignal - VolcanicSignal - FireWeatherSignal

## 7.3 Composition rule

The Worker may compose:

-   hero summary bundles
-   island summaries
-   mini map summaries
-   local page summaries
-   live map layer bundles

But all composition must use validated, cached data.

------------------------------------------------------------------------

# 8. Freshness Rules in the Worker

The Worker must preserve freshness state in every response:

-   FRESH
-   STALE_OK
-   STALE_DROP

Required fields in all responses:

-   generated_at
-   freshness_state
-   last_checked_at
-   stale_after_seconds
-   source metadata

If data is stale: - it must be labeled - it must not be silently
presented as fresh

If data is too stale: - it must be dropped or replaced with
degraded-safe fallback

------------------------------------------------------------------------

# 9. Degraded Behavior

When one or more sources fail, the Worker must:

-   keep the endpoint contract stable
-   return a degraded-safe payload
-   include stale/degraded metadata
-   preserve official links and action guidance

The Worker must never return: - undefined response shape - empty payload
without status explanation - guessed fields

------------------------------------------------------------------------

# 10. Health Model

The Worker should expose internal health state at two levels:

## 10.1 User-safe health summary

For `/v1/system/health` or homepage hero metadata: - healthy -
degraded - unavailable

## 10.2 Diagnostics health matrix

For internal or advanced diagnostics: - per-source freshness - parse
failures - network failures - retry cooldown state - last successful
fetch time

Diagnostics detail must not dominate the primary public UX.

------------------------------------------------------------------------

# 11. Error Handling Rules

## 11.1 Upstream network failure

-   do not crash endpoint
-   use last verified snapshot if policy allows
-   mark degraded

## 11.2 Invalid schema

-   drop dataset
-   log parse failure
-   do not cache
-   do not partial-render

## 11.3 Rate limit from internal dependencies

-   return non-breaking degraded response
-   avoid retry storms

## 11.4 Missing optional source

-   continue rendering other signals if contract still safe

------------------------------------------------------------------------

# 12. Response Shape Stability

Clients must be able to rely on stable JSON keys.

Required contract behavior:

-   all top-level keys present
-   missing data expressed as explicit null / empty collection /
    degraded state
-   no random omission of fields

This stability is required for web/mobile parity and safer app releases.

------------------------------------------------------------------------

# 13. Security and Privacy Rules

The Worker must never:

-   expose upstream API keys to clients
-   expose private internal service URLs
-   store precise user location server-side unless explicitly required
    by a different policy
-   imply official authority
-   serve stale hazard data without labels

------------------------------------------------------------------------

# 14. Performance Expectations

The Worker must target:

-   sub-200ms cached reads where possible
-   high cache hit ratio
-   minimal per-request CPU
-   minimal request-time transformation complexity

If an expensive operation is repeated frequently, it belongs in
poller-time composition, not request-time composition.

------------------------------------------------------------------------

# 15. Recommended Deployment Split

Recommended separation:

## A. Edge Worker

-   serves cached reads
-   enforces contract
-   applies final freshness/degraded semantics

## B. Ingestion Workers / Pollers

-   fetch upstream
-   validate
-   retry
-   write snapshots

## C. Historical store

-   archival, analytics, replay, and future notification support

This split keeps request-time paths lightweight.

------------------------------------------------------------------------

# 16. Forbidden Patterns

The Worker Aggregator must not:

-   live-call all 16 upstream APIs per page request
-   expose raw upstream schemas directly to the client
-   allow malformed upstream data into the cache
-   hide degraded state
-   mix canonical and context semantics without labels
-   let context override FireSignal priority in canonical outputs

------------------------------------------------------------------------

# 17. Final Requirement

All Cloudflare Worker implementations for Kahu Ola must comply with this
spec before release.
