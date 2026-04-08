<!-- SOURCE: docs/architecture/V4_8_OBSERVABILITY_SPEC.md -->
<!-- CATEGORY: architecture -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# V4.8 Observability Specification
## Metrics, Logging, Health Signals, and Runtime Visibility

**Status:** Authoritative V4.8 Observability Spec

## Purpose

This document defines how Kahu Ola observes itself in production.

It answers:
- Is the system healthy?
- Are upstream sources fresh?
- Are parsers failing?
- Is cache hit ratio acceptable?
- Is degraded mode occurring too often?

## Core Metrics

### Upstream metrics
- fetch success rate by source
- fetch latency by source
- last successful fetch per source
- 429 counts by source
- cooldown activations by source

### Parser metrics
- parse success rate
- schema failure count
- GeoJSON failure count
- dropped dataset count

### Cache metrics
- cache hit ratio
- cache miss ratio
- stale serve ratio
- STALE_DROP count

### API metrics
- request count by endpoint
- latency by endpoint
- degraded response count
- health state distribution

## Logging Rules

Recommended log events:
- source fetch started
- source fetch failed
- parse failed
- snapshot built
- degraded state entered
- cooldown started
- endpoint returned degraded payload

## Health Surfaces

### Public-safe health summary
- healthy
- degraded
- unavailable

### Diagnostics health matrix
- per-source status
- freshness state
- last successful fetch
- parse status
- retry / cooldown state

## Final Requirement

Kahu Ola production deployments must include observability sufficient to detect stale data, parser failure, cache issues, and degraded operation before release.
