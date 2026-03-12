# V4.8 Client Architecture

## Unified Client Model for Web, iOS, Android, Smartwatch, and Widgets

**Status:** Authoritative V4.8 Client Architecture Spec\
**Audience:** Frontend engineers, mobile engineers, product, platform
engineers, AI coding agents

------------------------------------------------------------------------

# 1. Purpose

This document defines how Kahu Ola client applications should be
structured across all supported surfaces.

Supported client surfaces include:

-   web browser
-   iOS app
-   Android app
-   smartwatch clients
-   widgets and lightweight glance surfaces

The purpose of this spec is to ensure that all Kahu Ola clients:

-   consume the same hazard contract
-   interpret signals the same way
-   preserve the same freshness semantics
-   follow the same state machine
-   maintain civic-safe behavior across surfaces

This document does **not** redefine system architecture. It defines how
clients should use the shared system safely.

------------------------------------------------------------------------

# 2. Core Principle

All Kahu Ola clients are **thin civic rendering layers** over a shared
hazard intelligence system.

Clients do not own hazard interpretation.

Clients do not infer hazard priority.

Clients do not call upstream providers directly.

Clients render server-composed snapshots and signal bundles.

Canonical model:

System → Worker API → Client render

Not:

Client → direct upstream APIs → local hazard reasoning

------------------------------------------------------------------------

# 3. Supported Client Types

## 3.1 Web Client

Examples:

-   homepage
-   island pages
-   live map
-   transparency / diagnostics views

Strengths: - richest map interaction - broader situational context -
best place for progressive disclosure - diagnostics and trust layers can
be deeper here

## 3.2 Mobile App Client

Examples:

-   iPhone app
-   Android app

Strengths: - local daily use - push notifications - faster repeat
access - location-aware convenience if policy allows

## 3.3 Smartwatch Client

Examples:

-   Apple Watch
-   Wear OS

Strengths: - glanceable hazard awareness - highly compressed state
presentation - simple urgency signaling - fast handoff to phone

## 3.4 Widget / Glance Client

Examples:

-   lock screen widgets
-   home screen widgets
-   compact dashboard tiles

Strengths: - persistent daily visibility - low-friction awareness -
daily habit reinforcement

------------------------------------------------------------------------

# 4. Shared Client Contract

All clients must consume the same normalized contract from the Worker
Aggregator.

Examples:

-   `/v1/home/summary`
-   `/v1/home/islands`
-   `/v1/hazards/fire`
-   `/v1/context/flood`
-   `/v1/system/health`

Required guarantee:

-   same signal semantics across all clients
-   same freshness fields across all clients
-   same severity meanings across all clients
-   same source attribution rules across all clients

This prevents web/app/watch divergence.

------------------------------------------------------------------------

# 5. Shared Rendering Guarantees

Every client must preserve:

-   source attribution
-   freshness labeling
-   degraded-state honesty
-   official link / action boundary
-   calm civic language

Even when layouts differ, meaning must remain the same.

Example:

If FireSignal is `WARNING` on web, it must also be interpreted as the
same warning level on mobile and watch.

------------------------------------------------------------------------

# 6. Client Responsibilities

Clients are responsible for:

-   rendering the returned hazard state clearly
-   displaying freshness
-   showing source labels
-   respecting degraded mode
-   directing users to official emergency sources

Clients are not responsible for:

-   deriving hazard priority from raw data
-   merging upstream feeds
-   guessing missing fields
-   computing event priority locally
-   reclassifying freshness locally
-   inventing user action routes

------------------------------------------------------------------------

# 7. Shared Runtime Logic

The following logic is shared across all clients and must come from
backend/system specifications:

-   `V4_8_STATE_MACHINE.md`
-   `V4_8_EVENT_PRIORITY_SPEC.md`
-   `V4_8_MULTI_HAZARD_DECISION_TREE.md`
-   `V4_8_DATA_FRESHNESS_POLICY.md`

The client must not create alternative local logic.

Example:

If the backend selects `FIRE_ACTIVE`, the client renders `FIRE_ACTIVE`.
It does not decide locally whether flood should win instead.

------------------------------------------------------------------------

# 8. Platform-Specific UX Roles

## 8.1 Web Role

Web is the richest civic dashboard surface.

Recommended responsibilities: - full homepage hero - signal stack - mini
map - live map - diagnostics access - source health visibility -
statewide and island pages

Web may expose the deepest context, but must still respect 5-second
clarity.

## 8.2 Mobile Role

Mobile is the primary repeat-use operational convenience surface.

Recommended responsibilities: - hero summary - local signal cards - push
notifications - quick action links - map handoff - degraded awareness -
saved region / island preference if implemented safely

Mobile should remain narrower than web and faster to scan.

## 8.3 Smartwatch Role

Watch is a compressed awareness surface.

Recommended responsibilities: - one primary hazard state - one
timestamp - one source or trust marker - handoff button to phone

Watch must never attempt to reproduce the full web dashboard.

## 8.4 Widgets

Widgets provide glanceable awareness only.

Recommended responsibilities: - hero state - freshness - short
island/local label - tap-through to app or web

Widgets must not attempt full diagnostics or multi-panel interpretation.

------------------------------------------------------------------------

# 9. Client Data Models

All clients should share the same normalized signal model.

Minimum shared model concepts:

-   `signal_type`
-   `severity`
-   `headline`
-   `summary`
-   `source`
-   `freshness_state`
-   `generated_at`
-   `last_checked_at`
-   `confidence_label`

Platform-specific rendering may differ, but the underlying schema must
remain stable.

------------------------------------------------------------------------

# 10. Freshness and Degraded Behavior

Every client must support:

-   `FRESH`
-   `STALE_OK`
-   `STALE_DROP`

And every client must support degraded rendering.

## Web

May show: - stale banner - diagnostics panel - source health summary

## Mobile

May show: - stale badge - degraded banner - official links first

## Watch

May show: - limited / delayed label - tap to open phone

The behavior should scale down gracefully, not diverge semantically.

------------------------------------------------------------------------

# 11. Navigation Model by Client

## Web

Recommended navigation: - homepage - island page - live map - official
links - transparency / diagnostics

## Mobile

Recommended navigation: - home - local signals - map - official alerts -
settings / diagnostics

## Watch

Recommended navigation: - current hazard - freshness - open on phone

The smaller the screen, the fewer simultaneous hazard surfaces should be
shown.

------------------------------------------------------------------------

# 12. Notification Strategy

Notifications are a client surface, but notification logic must still
follow server semantics.

Clients must not generate notifications purely from local UI state.

Notification generation should come from backend event logic or approved
notification rules.

## Mobile notifications

May include: - Fire signal near Lahaina - Flood Watch for Maui - Some
data sources delayed

## Watch notifications

Must be shorter and more compressed.

------------------------------------------------------------------------

# 13. Platform Constraints

## Web constraints

-   support mobile browsers
-   maintain no-blank-screen behavior
-   avoid heavy first-load requirements on homepage

## iOS / Android constraints

-   fast cold start
-   low battery/network cost
-   clear offline/degraded handling
-   App Store-safe language

## Smartwatch constraints

-   minimal text
-   short interaction time
-   no dense diagnostics
-   no complex map requirement

------------------------------------------------------------------------

# 14. Shared Design Invariants

All clients must preserve these invariants:

1.  wildfire-first system semantics
2.  progressive disclosure
3.  source transparency
4.  freshness honesty
5.  official authority boundary
6.  no routing or evacuation instruction claims
7.  degraded state visibility
8.  same hazard meaning across platforms

------------------------------------------------------------------------

# 15. Recommended Feature Allocation by Surface

## Homepage (web)

-   statewide hero
-   signal stack
-   island summaries
-   mini map
-   official links

## Island page (web/mobile)

-   local hero
-   local signal stack
-   local official links
-   local map emphasis

## Live map (web/mobile)

-   operational visual verification
-   layered context
-   diagnostics

## Watch

-   single hazard headline
-   freshness
-   open on phone

## Widget

-   compact hazard state
-   updated time
-   tap-through

------------------------------------------------------------------------

# 16. Forbidden Client Behaviors

Clients must never:

-   call upstream hazard APIs directly
-   invent local hazard priority rules
-   hide stale data
-   ignore degraded state
-   imply official emergency authority
-   provide evacuation routing
-   reinterpret server severity with custom meaning
-   expose diagnostics as the first layer on small surfaces

------------------------------------------------------------------------

# 17. Example Rendering Across Surfaces

## Web

🔥 Fire Signal --- Active\
Near Lahaina\
NASA FIRMS · 8 min ago\
Check official alerts

## Mobile

🔥 Fire signal near Lahaina\
Updated 8 min ago\
Open official alerts

## Watch

🔥 Fire near Lahaina\
8 min ago\
Open on phone

All three surfaces express the same underlying server state.

------------------------------------------------------------------------

# 18. Final Requirement

All Kahu Ola web, mobile, smartwatch, and widget surfaces must comply
with this unified client architecture before release.

The client layer is a renderer of civic truth, not an independent hazard
intelligence engine.
