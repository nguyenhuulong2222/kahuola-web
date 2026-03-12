# V4.8 Cache Strategy

## TTL, Stale Policy, and Edge Caching Rules

**Status:** Authoritative V4.8 Cache Strategy\
**Audience:** Platform engineers, backend engineers, edge caching
implementers, AI coding agents

------------------------------------------------------------------------

# 1. Purpose

This document defines how Kahu Ola caches hazard data safely and
efficiently.

The cache system must support:

-   low-latency reads
-   stale-aware resilience
-   rate-limit protection
-   graceful degradation
-   web/mobile consistency

The cache is a trust boundary, not just a performance optimization.

------------------------------------------------------------------------

# 2. Core Principles

Kahu Ola cache strategy must be:

-   cache-first
-   freshness-aware
-   fail-closed
-   signal-specific
-   edge-friendly

No client request should depend on live fan-out to upstream APIs during
normal operation.

------------------------------------------------------------------------

# 3. Cache Layers

Recommended cache stack:

## Layer A --- Edge cache

-   Cloudflare CDN / edge cache
-   short-lived public summaries
-   very fast repeated reads

## Layer B --- Aggregator cache

-   Redis / KV
-   validated snapshots
-   signal bundles
-   island summaries
-   homepage summaries

## Layer C --- Historical store

-   PostGIS / persistent DB / R2
-   replay, analytics, audit, training, notifications

------------------------------------------------------------------------

# 4. Cache Unit Types

The system should cache at multiple units:

-   raw normalized signal records
-   per-signal snapshot bundles
-   per-island summary bundles
-   homepage hero summary
-   mini map summary
-   diagnostics health summary

Each cache unit should have its own TTL and stale policy.

------------------------------------------------------------------------

# 5. Freshness States

Every cacheable object must be classified as:

-   FRESH
-   STALE_OK
-   STALE_DROP

## Meaning

FRESH - recent enough for normal display

STALE_OK - older than ideal but still useful for situational awareness -
must be visibly labeled stale

STALE_DROP - too old or invalid for safe rendering - must not be used
operationally

------------------------------------------------------------------------

# 6. Default TTL Recommendations

These are recommended defaults and may be refined by implementation.

## Fire hotspots

-   ideal TTL: 5--15 minutes
-   stale_ok window: up to 30 minutes
-   beyond that: STALE_DROP

## NWS alerts

-   ideal TTL: 5--10 minutes
-   stale_ok window: up to 20 minutes
-   then STALE_DROP unless explicit event continuation policy exists

## Smoke / AQI

-   ideal TTL: 15--30 minutes
-   stale_ok window: up to 60 minutes

## Fire perimeters

-   ideal TTL: 30--60 minutes
-   stale_ok window: up to several hours if clearly labeled

## Radar / weather context

-   ideal TTL: 5--10 minutes
-   stale_ok window: up to 20 minutes

## Ocean / volcanic / slower context

-   ideal TTL: 15--60 minutes depending on source

------------------------------------------------------------------------

# 7. Cache Admission Rules

No object may enter the cache unless:

1.  schema validation passes
2.  required fields exist
3.  timestamps are parseable
4.  freshness can be determined
5.  geometry is valid if geometry is present

If any of these fail: - drop object - log structured error - do not
cache

------------------------------------------------------------------------

# 8. Edge Caching Rules

Edge caching is allowed only for:

-   public summary endpoints
-   island summaries
-   mini map summaries
-   diagnostics summaries safe for public read

Edge cache should not hold ambiguous or unstable live-composition
payloads for too long.

## Recommended practice

-   short CDN TTL
-   revalidation support
-   explicit freshness metadata in response body

------------------------------------------------------------------------

# 9. Snapshot Composition Strategy

Prefer poller-time composition, not request-time composition.

Good: - poller writes `/home/summary` snapshot every few minutes

Bad: - homepage request dynamically rebuilds hero summary from many
internal components every time

Request-time composition should be lightweight whenever possible.

------------------------------------------------------------------------

# 10. Stale Fallback Policy

When a fresh object is unavailable:

## If STALE_OK exists

-   serve stale object
-   label clearly in UI

## If only STALE_DROP exists

-   do not serve operationally
-   fallback to neutral or degraded state

## If nothing exists

-   degraded state
-   no blank screen

------------------------------------------------------------------------

# 11. Cache Invalidation

Invalidate or refresh cache when:

-   new verified upstream data arrives
-   severe event status changes
-   poller recomputes summary bundle
-   stale window expires
-   schema version changes

Avoid broad invalidation storms where possible.

------------------------------------------------------------------------

# 12. Cache Key Strategy

Recommended key families:

-   `home:summary:hawaii`
-   `home:islands:hawaii`
-   `hazard:fire:maui`
-   `hazard:smoke:maui`
-   `hazard:perimeter:maui`
-   `context:flood:hawaii`
-   `context:storm:hawaii`
-   `health:public`
-   `health:diagnostics`

Keys should encode: - scope - region - signal family - version if needed

------------------------------------------------------------------------

# 13. Response Metadata Requirements

Every cached response served to clients should include:

-   generated_at
-   freshness_state
-   last_checked_at
-   stale_after_seconds
-   source metadata

This metadata is required so the UI can remain honest and resilient.

------------------------------------------------------------------------

# 14. Cache and Mobile Apps

Mobile apps should consume the same cached bundles as web.

Apps should not implement their own independent freshness interpretation
beyond the shared contract.

This keeps: - rendering consistent - alert semantics consistent - risk
messaging consistent

------------------------------------------------------------------------

# 15. Forbidden Cache Behaviors

The system must never:

-   cache invalid schema output
-   cache unlabeled stale hazard data
-   treat STALE_DROP as normal display
-   let CDN cache hide freshness truth
-   rely on edge cache as the only source of truth
-   let request-time live fan-out replace snapshot caching

------------------------------------------------------------------------

# 16. Final Requirement

All Kahu Ola caching behavior must comply with this strategy before
release.
