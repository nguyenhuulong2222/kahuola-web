<!-- SOURCE: docs/architecture/V4_8_MASTER_INDEX.md -->
<!-- CATEGORY: architecture -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# V4.8 Master Index

## Kahu Ola Doctrine and Implementation Map

**Status:** Authoritative V4.8 Master Navigation Document\
**Audience:** Engineers, product, design, operations, and AI coding
agents

------------------------------------------------------------------------

# 1. Purpose

This file is the master index for the Kahu Ola V4.8 documentation set.

It exists to ensure that human engineers and AI coding agents can
quickly find the correct document for each implementation problem
without misreading the doctrine or inventing architecture.

Use this file as the first entry point before reading any deeper V4.8
specification.

------------------------------------------------------------------------

# 2. How to Use This Index

If you are:

-   designing the system architecture → start with the Architecture
    section
-   building API endpoints → start with API Contract and Worker
    Aggregator
-   designing homepage UX → start with Homepage Hero Spec
-   building live map behavior → start with Map Layer Spec
-   implementing stale/degraded logic → start with Freshness Policy and
    Degraded UX
-   deciding hero state when multiple hazards occur → start with Event
    Priority Spec
-   prototyping UI before real APIs → start with Mock State Spec
-   writing user-facing wording → start with Alert Copy Guidelines

------------------------------------------------------------------------

# 3. Core Doctrine Files

## 3.1 Foundational Doctrine

### `Kahu_Ola_V4_7_Doctrine.md`

Use for: - original core doctrine - wildfire-first philosophy -
invariant rules - client stateless architecture - civic-grade trust
posture

This is the foundational doctrine document.

------------------------------------------------------------------------

## 3.2 Runtime Safety

### `V4_8_RUNTIME_PROTECTION_ADDENDUM.md`

Use for: - four-layer runtime protection model - controlled API
boundary - freshness-aware fallback - fail-closed validation -
transparency rules

Read this before implementing runtime behavior.

------------------------------------------------------------------------

# 4. Architecture Documents

## 4.1 System-wide Architecture

### `V4_8_SYSTEM_ARCHITECTURE.md`

Use for: - unified web + mobile architecture - high-level topology -
poller → cache → aggregator → client flow - component boundaries

This is the primary architecture overview.

## 4.2 Worker / Aggregator

### `V4_8_WORKER_AGGREGATOR_SPEC.md`

Use for: - Cloudflare Worker behavior - edge gateway responsibilities -
request-time vs poller-time logic - stable response contracts

Read this before implementing Worker code.

## 4.3 Cache Behavior

### `V4_8_CACHE_STRATEGY.md`

Use for: - TTL - edge caching - stale fallback - cache key strategy -
snapshot composition strategy

Read this before implementing Redis/KV/CDN behavior.

## 4.4 Rate Limits and Traffic Surge

### `V4_8_RATE_LIMIT_PROTECTION.md`

Use for: - retry policy - cooldown policy - surge protection - 429
handling - upstream quota safety

Read this before launch or stress testing.

------------------------------------------------------------------------

# 5. Data and API Documents

## 5.1 API Contract

### `V4_8_API_CONTRACT.md`

Use for: - stable client endpoints - web/mobile JSON contract - response
field requirements - security rules for clients

This is the source of truth for endpoint design.

## 5.2 Signal Models

### `V4_8_SIGNAL_MODEL_SPEC.md`

Use for: - FireSignal schema - SmokeSignal schema - FloodSignal schema -
StormSignal schema - VolcanicSignal schema - shared required fields and
enums

Read this before building parsers or serializers.

## 5.3 Freshness Logic

### `V4_8_DATA_FRESHNESS_POLICY.md`

Use for: - FRESH - STALE_OK - STALE_DROP - freshness labeling - stale
rendering policy

This is the source of truth for data-age semantics.

------------------------------------------------------------------------

# 6. UX and Content Documents

## 6.1 Homepage Hero

### `V4_8_HOMEPAGE_HERO_SPEC.md`

Use for: - homepage first screen structure - hero banner behavior -
signal stack ordering - context strip rules - action button rules

Read this before changing homepage layout.

## 6.2 Alert Copy

### `V4_8_ALERT_COPY_GUIDELINES.md`

Use for: - plain-language hazard writing - legal-safe copy - popup
text - push notification wording - degraded banner wording

Read this before changing visible text.

## 6.3 Degraded UX

### `V4_8_DEGRADED_STATE_UX_SPEC.md`

Use for: - calm degraded-state rendering - stale visibility - non-panic
banner design - official-links-first fallback

Read this before implementing outage behavior.

------------------------------------------------------------------------

# 7. Map and State Logic Documents

## 7.1 Map Layer Behavior

### `V4_8_MAP_LAYER_SPEC.md`

Use for: - layer naming - rendering order - click priority - toggle
visibility - popup identity - homepage mini map vs live map differences

This is the source of truth for map behavior.

## 7.2 Mock State Prototyping

### `V4_8_MOCK_STATE_SPEC.md`

Use for: - FIRE_ACTIVE - FLOOD_WATCH - MONITORING - DEGRADED - pre-API
UI testing

Read this before building mock state switchers.

## 7.3 System State Machine

### `V4_8_STATE_MACHINE.md`

Use for: - global system states - hero state transitions - color theme
switching - map emphasis by state

Read this when implementing state logic.

## 7.4 Event Priority

### `V4_8_EVENT_PRIORITY_SPEC.md`

Use for: - multi-hazard conflict resolution - homepage hero selection -
island page vs statewide hero differences - fire vs flood vs storm vs
degraded rules

Read this before implementing hero selection logic.

------------------------------------------------------------------------

# 8. Recommended Reading Paths

## 8.1 If you are Claude Code

Read in this order:

1.  `Kahu_Ola_V4_7_Doctrine.md`
2.  `V4_8_RUNTIME_PROTECTION_ADDENDUM.md`
3.  `V4_8_HOMEPAGE_HERO_SPEC.md`
4.  `V4_8_ALERT_COPY_GUIDELINES.md`
5.  `V4_8_MAP_LAYER_SPEC.md`
6.  `V4_8_EVENT_PRIORITY_SPEC.md`

Focus: - readable UX - hero clarity - map interaction - calm degraded
behavior

## 8.2 If you are Codex

Read in this order:

1.  `Kahu_Ola_V4_7_Doctrine.md`
2.  `V4_8_SYSTEM_ARCHITECTURE.md`
3.  `V4_8_WORKER_AGGREGATOR_SPEC.md`
4.  `V4_8_API_CONTRACT.md`
5.  `V4_8_SIGNAL_MODEL_SPEC.md`
6.  `V4_8_CACHE_STRATEGY.md`
7.  `V4_8_DATA_FRESHNESS_POLICY.md`
8.  `V4_8_RATE_LIMIT_PROTECTION.md`

Focus: - backend structure - cache-first reads - parsers - endpoint
correctness - resilience

## 8.3 If you are Gemini

Read in this order:

1.  `Kahu_Ola_V4_7_Doctrine.md`
2.  `V4_8_SYSTEM_ARCHITECTURE.md`
3.  `V4_8_RUNTIME_PROTECTION_ADDENDUM.md`
4.  `V4_8_EVENT_PRIORITY_SPEC.md`
5.  `V4_8_HOMEPAGE_HERO_SPEC.md`
6.  `V4_8_ALERT_COPY_GUIDELINES.md`

Focus: - architecture integrity - policy consistency - event priority -
cross-document coherence

------------------------------------------------------------------------

# 9. File Roles Summary

  Document                              Primary Role
  ------------------------------------- ----------------------------------
  Kahu_Ola_V4_7_Doctrine.md             original doctrine
  V4_8_RUNTIME_PROTECTION_ADDENDUM.md   runtime safety interpretation
  V4_8_SYSTEM_ARCHITECTURE.md           full platform architecture
  V4_8_WORKER_AGGREGATOR_SPEC.md        Cloudflare Worker design
  V4_8_CACHE_STRATEGY.md                TTL and cache behavior
  V4_8_RATE_LIMIT_PROTECTION.md         surge and quota safety
  V4_8_API_CONTRACT.md                  public client API
  V4_8_SIGNAL_MODEL_SPEC.md             normalized hazard signal schemas
  V4_8_DATA_FRESHNESS_POLICY.md         freshness classification
  V4_8_HOMEPAGE_HERO_SPEC.md            homepage structure
  V4_8_ALERT_COPY_GUIDELINES.md         visible wording
  V4_8_MAP_LAYER_SPEC.md                map semantics
  V4_8_MOCK_STATE_SPEC.md               pre-API UI states
  V4_8_DEGRADED_STATE_UX_SPEC.md        outage and stale UX
  V4_8_STATE_MACHINE.md                 runtime state transitions
  V4_8_EVENT_PRIORITY_SPEC.md           multi-hazard hero selection

------------------------------------------------------------------------

# 10. Implementation Rule of Thumb

When documents appear to overlap, resolve in this order:

1.  Foundational doctrine
2.  Runtime protection and architecture
3.  API and signal model
4.  Freshness and degraded behavior
5.  UX and copy rules
6.  Mock state / testing guidance

If there is ever ambiguity: - preserve wildfire-first doctrine - prefer
cache-first safety - prefer calm and honest user messaging - never hide
stale or degraded conditions

------------------------------------------------------------------------

# 11. Final Requirement

All future Kahu Ola implementations, including web, mobile, maps,
workers, and dashboards, must use this master index as the top
navigation layer for V4.8 documentation.

This file should be the first document opened by any engineer or AI
coding agent entering the repo.

# Kahu Ola V4.8 Master Documentation Index

This document defines the complete documentation structure of the Kahu Ola system.

It serves as the primary navigation point for all architectural and operational documentation.

---

# Architecture

docs/architecture/

V4_8_SYSTEM_ARCHITECTURE.md  
V4_8_CLIENT_ARCHITECTURE.md  
V4_8_DEPLOYMENT_ARCHITECTURE.md  

---

# Runtime

docs/runtime/

V4_8_RUNTIME_PROTECTION_ADDENDUM.md  
V4_8_CACHE_STRATEGY.md  
V4_8_RATE_LIMIT_PROTECTION.md  
V4_8_DATA_FRESHNESS_POLICY.md  

---

# Hazard Signal System

docs/signals/

V4_8_SIGNAL_MODEL_SPEC.md  
V4_8_EVENT_PRIORITY_SPEC.md  
V4_8_MULTI_HAZARD_DECISION_TREE.md  
V4_8_HAZARD_SIGNAL_PIPELINE.md  

---

# Map System

docs/map/

V4_8_MAP_LAYER_SPEC.md  

---

# UX System

docs/ux/

V4_8_HOMEPAGE_HERO_SPEC.md  
V4_8_ALERT_COPY_GUIDELINES.md  
V4_8_MOCK_STATE_SPEC.md  
V4_8_DEGRADED_STATE_UX_SPEC.md  

---

# Data Sources

docs/data/

V4_8_DATA_SOURCE_REGISTRY.md  

---

# Security

docs/security/

V4_8_SECURITY_MODEL.md  
V4_8_TRUST_MODEL.md  

---

# Observability

docs/operations/

V4_8_OBSERVABILITY_SPEC.md  
V4_8_COMMUNITY_INTEGRATION.md  

---

# Visual Architecture

docs/diagrams/

architecture_diagram.svg  
hazard_pipeline.svg  
decision_tree.svg  

---

# Operational Docs

docs/operations/

CURRENT_PRODUCTION_STATUS.md  
PROJECT_HANDOFF_RULES.md  

---

# Decision Records

docs/adr/

ADR_001_PRODUCTION_REAL_DATA_ONLY.md
