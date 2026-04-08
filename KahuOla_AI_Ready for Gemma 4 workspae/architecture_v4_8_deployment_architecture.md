<!-- SOURCE: docs/architecture/V4_8_DEPLOYMENT_ARCHITECTURE.md -->
<!-- CATEGORY: architecture -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# V4.8 Deployment Architecture
## Production Deployment Topology for Web, Worker, and Supporting Services

**Status:** Authoritative V4.8 Deployment Architecture

## Purpose

This document defines the recommended deployment model for Kahu Ola V4.8.

It covers:
- website deployment
- Worker deployment
- cache and data placement
- poller execution strategy
- environment boundaries

## Recommended Topology

### Public web layer
- Cloudflare Pages or equivalent static hosting

### API / edge layer
- Cloudflare Workers

### Cache layer
- Cloudflare KV and/or Redis-backed service

### Historical / persistent layer
- PostGIS / durable DB / object storage as needed

### Ingestion layer
- scheduled pollers / background jobs

## Deployment Flow

GitHub
→ CI / deployment pipeline
→ Cloudflare Pages (web)
→ Cloudflare Workers (API)
→ supporting cache / data services

## Service Separation

### Web
Static HTML/CSS/JS and assets

### Worker
Public API contract, cached reads, freshness labels, degraded-safe responses

### Pollers
Source acquisition, validation, normalization, snapshot building

### Data stores
Cache and history

## Environment Model

Recommended environments:
- development
- staging
- production

## Final Requirement

All production deployments of Kahu Ola must preserve cache-first, fail-closed, and degraded-safe behavior across web and API surfaces.
