<!-- SOURCE: docs/doctrine/V4_8_RUNTIME_PROTECTION_ADDENDUM.md -->
<!-- CATEGORY: doctrine -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# V4.8 Runtime Protection Addendum

## Four-Layer Runtime Protection Model

Status: Authoritative V4.8 Addendum\
This document clarifies how Kahu Ola scales from web to mobile while
preserving the core doctrine: Wildfire‑First · Cache‑First ·
Privacy‑First · Failure‑Tolerant.

This addendum is written for both human engineers and AI coding agents
(Claude Code, Codex, Gemini).

------------------------------------------------------------------------

# 1. Purpose

Kahu Ola integrates multiple upstream hazard intelligence providers
including:

-   NASA FIRMS
-   NOAA
-   NWS
-   EPA AirNow
-   USGS
-   PacIOOS
-   RAWS / MesoWest
-   and additional public hazard feeds.

These integrations must not compromise runtime stability, UI clarity, or
system resilience.

This addendum establishes a Four‑Layer Runtime Protection Model designed
to prevent:

-   request‑time API fan‑out collapse
-   blank screen failures
-   corrupted partial rendering
-   hidden stale data
-   architectural violations of the V4 doctrine

This document clarifies implementation rules without replacing the
original V4 doctrine.

------------------------------------------------------------------------

# 2. Correct Interpretation of Invariant I

Invariant I states:

The client is stateless and may only communicate with Kahu
Ola‑controlled endpoints.

This must NOT be interpreted as:

Browser/App → Worker → 16 upstream APIs (per request)

That model would create latency spikes, rate‑limit failures, and
unstable rendering.

Correct architecture:

Pollers → Validation → Stale Engine → Cache → Aggregator → Client

Clients never contact upstream providers directly. Upstream providers
are fetched by scheduled pollers, not by user requests.

------------------------------------------------------------------------

# 3. Four-Layer Runtime Protection Model

## Layer 1 --- Controlled API Boundary

All clients must communicate only with Kahu Ola endpoints.

Clients must never directly call:

-   NASA
-   NOAA
-   NWS
-   EPA
-   USGS
-   PacIOOS
-   or any upstream hazard API.

Client request: Client → Kahu Ola API

Server behavior: Aggregator → Cached snapshot

Upstream calls are executed only by ingestion pollers.

Forbidden:

-   Browser calls upstream APIs
-   Mobile apps call upstream APIs
-   Request‑time fan‑out to all providers
-   UI logic that assumes upstream APIs are reachable

Rationale:

-   preserves latency
-   protects backend stability
-   ensures App Store compliance
-   guarantees consistent client behavior

------------------------------------------------------------------------

## Layer 2 --- Freshness-Aware Fallback Rendering

The UI must always render, even when data is stale or partially
unavailable. The interface must never collapse to a blank screen.

Freshness states:

FRESH STALE_OK STALE_DROP

Rendering behavior:

FRESH → normal display

STALE_OK → visible stale label

STALE_DROP → fallback to neutral state or last-known verified state

UI guarantees:

-   no blank screens
-   no silent stale data
-   no hidden degradation
-   official links remain accessible

Possible banners:

-   offline banner
-   degraded banner
-   stale badge
-   cooldown banner
-   data format error banner

------------------------------------------------------------------------

## Layer 3 --- Fail-Closed Validation

Invalid upstream data must be rejected before entering cache.

Validation sequence:

1.  fetch source
2.  validate schema
3.  validate GeoJSON structure
4.  classify freshness
5.  determine cache eligibility
6.  write to cache if valid

On failure:

-   drop record
-   log error
-   increment metrics
-   do not write to cache
-   do not render partial data

Forbidden:

-   best‑effort rendering
-   inferred missing fields
-   partial hazard rendering

The cache layer is a trust boundary. Corrupt cache data would compromise
the entire system.

------------------------------------------------------------------------

## Layer 4 --- Transparency and Source Health

The platform must remain transparent about:

-   data sources
-   timestamps
-   freshness
-   confidence

Transparency levels:

Level A --- User transparency

Display:

Source label Last checked timestamp Confidence indicator Freshness label

Example:

Source: NASA FIRMS Last checked: 8 minutes ago Confidence: High

Level B --- Diagnostics transparency

Diagnostics panels may show:

-   per-source health
-   parse error counters
-   network error counts
-   ingestion latency

Emergency banners must not name agencies.

Incorrect: NOAA API failure

Correct: Some data sources are delayed.

------------------------------------------------------------------------

# 4. Implementation Guidance

Homepage:

Use aggregated summaries: - hero hazard summary - island summaries -
freshness indicators

Do not request all upstream providers live.

Live Map:

Additional layers allowed, but only through cached endpoints.

Mobile Apps:

Focus on:

-   canonical hazard signals
-   concise summaries
-   freshness‑aware rendering
-   official source deep links

Diagnostics should remain secondary.

------------------------------------------------------------------------

# 5. Operational Defaults

Polling cadence should vary by source.

Fast feeds: 5--15 minutes Medium feeds: 15--30 minutes Slow feeds:
30--60 minutes

Rate limiting:

If Aggregator returns 429:

-   enter cooldown
-   avoid retry storms
-   keep UI operational

Health states:

healthy degraded unavailable

UI must render in all states.

------------------------------------------------------------------------

# 6. Non-Negotiable Enforcement Rules

The following violate V4.8:

-   clients calling upstream providers
-   per-request multi-provider fan-out
-   blank screen failures
-   guessed rendering
-   stale data without labeling
-   degraded banners naming agencies
-   diagnostics in primary hazard layer
-   storing precise user location server-side

------------------------------------------------------------------------

# 7. Guidance for AI Coding Agents

Claude Code: Focus on UI clarity and graceful degradation.

Codex: Focus on ingestion pipelines and strict validation.

Gemini: Focus on architecture integrity and system resilience.

------------------------------------------------------------------------

# 8. Final Statement

Kahu Ola V4.8 is not a browser‑to‑16‑API system.

It is a:

-   cache‑first hazard intelligence platform
-   poller‑driven ingestion architecture
-   fail‑closed validation pipeline
-   freshness‑aware civic interface
-   transparency‑driven trust system

The Four‑Layer Runtime Protection Model is required for all future
implementations across web, mobile, and wearable platforms.
