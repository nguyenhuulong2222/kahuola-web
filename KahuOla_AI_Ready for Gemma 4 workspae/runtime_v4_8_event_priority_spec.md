<!-- SOURCE: docs/runtime/V4_8_EVENT_PRIORITY_SPEC.md -->
<!-- CATEGORY: runtime -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# V4.8 Event Priority Specification

## Multi-Hazard Hero Selection and Conflict Resolution Rules

**Status:** Authoritative V4.8 Event Priority Spec\
**Audience:** Product, backend, frontend, platform engineers, and AI
coding agents

------------------------------------------------------------------------

# 1. Purpose

Kahu Ola may detect multiple elevated hazards at the same time.

Examples:

-   wildfire signal near a populated area
-   flood watch or flood warning
-   Kona storm conditions
-   volcanic vog or elevated SO₂
-   degraded or stale data state

This document defines how Kahu Ola chooses:

-   the primary homepage hero state
-   the top island card state
-   the first signal shown to the user
-   which hazard wins when multiple hazards coexist

Without a strict event-priority model, the UI may feel inconsistent,
misleading, or overly crowded.

------------------------------------------------------------------------

# 2. Core Rule

Only **one primary event state** may control the hero banner at a time.

Other active hazards may still appear in:

-   secondary signal cards
-   context strips
-   island summaries
-   map overlays
-   diagnostics

The hero layer must remain singular, fast, and legible.

------------------------------------------------------------------------

# 3. Distinction Between Signal Priority and Event Priority

## 3.1 Signal Priority

Signal priority defines the stable architecture of hazard classes.

Kahu Ola remains **wildfire-first**. Canonical signal priority remains:

1.  FireSignal
2.  SmokeSignal
3.  PerimeterSignal

Context signals remain secondary.

## 3.2 Event Priority

Event priority defines what the hero banner shows **right now** when
several elevated conditions are active.

This means:

-   Fire can remain first-class in architecture
-   but a statewide storm banner may still appear first on homepage
    during a Kona storm
-   while FireSignal still remains first in the signal stack

This distinction is required for Hawaiʻi-wide usability.

------------------------------------------------------------------------

# 4. Event Priority Tiers

Kahu Ola V4.8 uses the following event priority tiers.

## Tier 0 --- System Integrity

-   DEGRADED
-   OFFLINE
-   STALE_LIMITED

## Tier 1 --- Immediate Life-Safety Hazard

-   FIRE_ACTIVE near populated area
-   FLOOD_WARNING
-   TSUNAMI_WARNING if implemented in future
-   confirmed volcanic emergency if implemented in future

## Tier 2 --- Active Hazard Environment

-   FLOOD_WATCH
-   STORM_ACTIVE
-   VOLCANIC_WATCH
-   RED_FLAG / FIRE_WEATHER_ELEVATED

## Tier 3 --- Monitoring / Context

-   MONITORING
-   AQI advisory
-   ocean context
-   general weather context

The hero must always choose the highest active tier.

------------------------------------------------------------------------

# 5. Absolute Override Rules

## 5.1 Degraded override

If system confidence is degraded enough that primary hazard data cannot
be trusted, the hero must show:

DEGRADED

This override exists because confidence in the system is a prerequisite
for all other hazard display.

## 5.2 Fire override

If a wildfire signal is detected near a populated or user-relevant area,
Fire wins over all non-degraded context hazards.

Fire overrides:

-   Flood Watch
-   Storm Active
-   Volcanic Watch
-   Fire Weather
-   AQI / Smoke context
-   Ocean context

Fire does **not** automatically override: - Degraded - Tsunami Warning
(future) - other future explicit life-safety mandatory warnings if
adopted

## 5.3 Flood Warning override

Flood Warning overrides:

-   Flood Watch
-   Storm Active
-   Volcanic Watch
-   Monitoring

Flood Warning does **not** override: - Degraded - Fire Active near
populated area

------------------------------------------------------------------------

# 6. Canonical Hero Priority Order

The default hero selection order is:

1.  DEGRADED
2.  FIRE_ACTIVE
3.  FLOOD_WARNING
4.  FLOOD_WATCH
5.  STORM_ACTIVE
6.  VOLCANIC_WATCH
7.  FIRE_WEATHER_ELEVATED
8.  MONITORING

This is the system-wide default.

------------------------------------------------------------------------

# 7. Geographic Scope Modifier

The same hazard may be more or less important depending on scope.

## 7.1 Homepage

Homepage is statewide. A statewide active Kona storm may lead the hero
even if a minor non-populated fire signal exists on one island.

## 7.2 Island page

Island page prioritizes local relevance. A Maui fire signal near Lahaina
should override a statewide Kona storm banner on the Maui page.

## 7.3 User-local view

If Kahu Ola later introduces explicit user-local state selection,
proximity may further elevate local hazards.

------------------------------------------------------------------------

# 8. Relevance Matrix

The hero must consider both:

-   severity
-   geographic relevance

## Example A

Statewide Kona storm + weak remote fire signal on unpopulated terrain

Homepage hero: STORM_ACTIVE

Signal stack: Fire still shown first in stack, but homepage banner may
remain storm-focused.

## Example B

Statewide Kona storm + high-confidence fire signal near Lahaina

Homepage hero: FIRE_ACTIVE

Reason: populated-area wildfire is more immediate for civic
interpretation than broad storm context.

## Example C

Flood Warning in Maui + no fire signal

Maui page hero: FLOOD_WARNING

Homepage hero: May still be STORM_ACTIVE or FLOOD_WARNING depending on
statewide spread.

------------------------------------------------------------------------

# 9. Severity Modifiers

Hero selection must account for hazard strength.

## Fire modifiers

Fire becomes hero-critical when one or more are true:

-   high confidence
-   elevated FRP
-   multiple detections
-   populated area proximity
-   perimeter correlation
-   strong fire weather context

## Flood modifiers

Flood becomes hero-critical when one or more are true:

-   Warning vs Watch
-   sustained rainfall intensity
-   multiple affected islands
-   official warning polygons
-   road / stream / valley relevance

## Storm modifiers

Storm becomes hero-critical when:

-   statewide impact
-   multiple hazard effects (rain + wind + surf)
-   official NWS or hurricane framing

------------------------------------------------------------------------

# 10. Tie-Breaking Rules

If two hazards are at the same tier, use the following tie-breakers in
order.

1.  More immediate life-safety implication
2.  Smaller and more populated geographic relevance
3.  Official warning beats unofficial context
4.  Higher freshness confidence
5.  Wildfire-first principle if still tied

------------------------------------------------------------------------

# 11. Hero Banner Selection Examples

## Example 1

Fire Active near Lahaina\
Flood Watch statewide

Result: Hero = FIRE_ACTIVE\
Secondary signal = Flood Watch

## Example 2

No fire\
Flood Warning on Maui\
Kona storm statewide

Result on Maui page: Hero = FLOOD_WARNING

Result on homepage: Hero = FLOOD_WARNING or STORM_ACTIVE depending on
breadth, but Flood Warning should usually win if immediate and official.

## Example 3

No fire\
No flood warning\
Kona storm with strong winds and rough surf

Result: Hero = STORM_ACTIVE

## Example 4

Fire active near Lahaina\
System freshness severely degraded

Result: Hero = DEGRADED\
Secondary cards may show last verified fire state if policy allows

------------------------------------------------------------------------

# 12. Relationship to Signal Stack

Even when the hero banner is controlled by Storm or Flood:

-   FireSignal remains first in the signal stack
-   Fire remains the first-class canonical hazard
-   technical architecture remains wildfire-first

This prevents event framing from breaking the core doctrine.

------------------------------------------------------------------------

# 13. Relationship to Map Layers

Map layers may show multiple hazards simultaneously.

However:

-   hero must choose one primary event
-   signal stack may show multiple active signals
-   map may display broader context than the hero
-   map overlays do not control hero selection directly

The state machine and event priority engine control the hero, not the
currently visible map tab.

------------------------------------------------------------------------

# 14. Homepage vs Island Page Behavior

## Homepage

Optimize for statewide understanding.

Recommended hero candidates: - Storm / Flood - Fire near major
population - Degraded

## Island Page

Optimize for island-specific urgency.

Recommended rule: - local immediate hazard beats broad statewide context

This is especially important for Maui pages.

------------------------------------------------------------------------

# 15. Copy Rules for Priority Transitions

When event priority changes, copy must remain calm.

Good examples:

-   Fire signal detected near Lahaina. Official storm context remains
    active statewide.
-   Flood Warning active for parts of Maui. No current fire signal is
    elevated.
-   Some hazard data sources are delayed. Showing the last verified
    snapshot where possible.

Do not use theatrical language or sudden tone shifts.

------------------------------------------------------------------------

# 16. Implementation Interface

Recommended event priority function:

``` ts
selectPrimaryEvent({
  systemHealth,
  fireSignal,
  floodSignal,
  stormSignal,
  volcanicSignal,
  regionScope
}) => PrimaryEventState
```

Expected outputs:

-   DEGRADED
-   FIRE_ACTIVE
-   FLOOD_WARNING
-   FLOOD_WATCH
-   STORM_ACTIVE
-   VOLCANIC_WATCH
-   MONITORING

------------------------------------------------------------------------

# 17. Testing Requirements

All implementations must test at minimum:

-   Fire + Flood Watch
-   Fire + Storm Active
-   Flood Warning + Storm Active
-   Volcanic Watch + Monitoring
-   Any hazard + Degraded
-   Local island hazard vs statewide hazard

The selected hero must match this specification.

------------------------------------------------------------------------

# 18. Forbidden Behaviors

The system must never:

-   show two competing hero banners
-   let visible map overlays decide the hero state
-   let technical source names decide priority
-   treat all hazards as equal
-   let a weak context signal override a strong populated-area fire
    signal
-   hide degraded state when confidence is reduced

------------------------------------------------------------------------

# 19. Final Requirement

All homepage heroes, island heroes, app summary cards, and future
notification summarizers must comply with this event-priority
specification before release.
