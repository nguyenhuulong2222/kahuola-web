<!-- SOURCE: docs/map/V4_8_MAP_LAYER_SPEC.md -->
<!-- CATEGORY: map -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# V4.8 Map Layer Specification

## Layer Semantics for Web and Mobile Map Rendering

**Status:** Authoritative V4.8 Map Layer Spec\
**Audience:** Frontend, map engineering, design systems, and AI coding
agents

------------------------------------------------------------------------

# 1. Purpose

This document defines the official map layer system for Kahu Ola V4.8.

It standardizes:

-   layer naming
-   source types
-   rendering order
-   click priority
-   visibility rules
-   stale/degraded behavior
-   user-facing vs diagnostics layer semantics

The goal is a map that is:

-   wildfire-first
-   readable in under five seconds
-   mobile-safe
-   legally conservative
-   operationally transparent

------------------------------------------------------------------------

# 2. Layer Principles

Kahu Ola maps must follow these principles:

1.  Fire is always the first-class operational signal.
2.  Context layers must never visually or semantically override fire.
3.  Hidden layers must not remain interactive.
4.  All layers must support degraded/fallback behavior.
5.  Layer semantics must be stable across web and app.

------------------------------------------------------------------------

# 3. Layer Taxonomy

## 3.1 Canonical operational layers

-   `fire-signals`
-   `smoke-areas`
-   `fire-perimeters`

## 3.2 Context layers

-   `flood-context`
-   `storm-context`
-   `rain-radar`
-   `air-quality`
-   `ocean-context`
-   `volcanic-context`
-   `fire-weather`

## 3.3 Utility layers

-   `user-location`
-   `island-labels`
-   `region-highlights`
-   `diagnostic-health`

------------------------------------------------------------------------

# 4. Source Types

## 4.1 Vector sources

Use vector/GeoJSON for:

-   fire points
-   smoke polygons
-   perimeter polygons
-   flood polygons
-   storm polygons
-   ocean polygons
-   volcanic polygons

## 4.2 Raster sources

Use raster only for:

-   NOAA radar tiles
-   optional weather imagery layers
-   optional thermal backdrops

Radar should not be fetched as GeoJSON if the upstream is a raster tile
service.

------------------------------------------------------------------------

# 5. Official Layer IDs

The following IDs are reserved and should be used consistently.

## 5.1 Fire layers

-   `clusters`
-   `cluster-count`
-   `unclustered-fires-glow`
-   `unclustered-fires`

## 5.2 Smoke layers

-   `smoke-fill`
-   `smoke-outline`

## 5.3 Perimeter layers

-   `perimeter-fill`
-   `perimeter-outline`

## 5.4 Flood layers

-   `flash-flood-fill`
-   `flash-flood-outline`
-   `flash-flood-point`
-   `flood-context-fill`
-   `flood-context-outline`

## 5.5 Storm / radar layers

-   `storm-context-fill`
-   `storm-context-outline`
-   `noaa-radar-layer`

## 5.6 Air / ocean / volcanic layers

-   `air-quality-fill`
-   `ocean-context-fill`
-   `ocean-context-outline`
-   `volcanic-context-fill`
-   `volcanic-context-outline`

------------------------------------------------------------------------

# 6. Rendering Order

Top-to-bottom visual priority must be:

1.  clusters
2.  cluster-count
3.  unclustered-fires-glow
4.  unclustered-fires
5.  perimeter-outline
6.  perimeter-fill
7.  smoke-outline
8.  smoke-fill
9.  flash-flood-point
10. flash-flood-outline
11. flash-flood-fill
12. flood-context-outline
13. flood-context-fill
14. storm-context-outline
15. storm-context-fill
16. noaa-radar-layer
17. ocean / volcanic / air context layers
18. basemap

## Rule

Fire layers must always remain above flood, radar, and context overlays.

------------------------------------------------------------------------

# 7. Click Priority

Click routing must follow strict priority:

1.  `unclustered-fires`
2.  `clusters`
3.  `flash-flood-point`
4.  `flash-flood-fill`
5.  `flood-context-fill`
6.  `storm-context-fill`
7.  `smoke-fill`
8.  `perimeter-fill`
9.  all other context layers

## Rule

If multiple layers exist at the same point, fire wins.

------------------------------------------------------------------------

# 8. Visibility Rules

## 8.1 Toggle semantics

When a layer is turned off, it must use:

`layout.visibility = none`

Opacity-only hiding is insufficient, because hidden polygons may still
intercept clicks.

## 8.2 Required behavior

For all toggleable overlays:

-   set `visibility: visible` when on
-   set `visibility: none` when off

## 8.3 Forbidden

Do not rely only on:

-   `fill-opacity: 0`
-   `line-opacity: 0`

for interactive overlays.

------------------------------------------------------------------------

# 9. Popup Identity Rules

Popup identity must come from the clicked feature or layer type, never
from the active sidebar tab.

Correct examples:

-   Fire point → `Wildfire Signal`
-   Flood polygon → `Flood Signal`
-   Radar context → `Rain Radar`
-   Volcanic context → `Volcanic Activity`

Incorrect behavior:

-   Clicking a fire point while Flood tab is open and showing Flood
    popup

------------------------------------------------------------------------

# 10. User-Facing Labels

The preferred user-facing labels are:

-   `Wildfire Signal`
-   `Smoke`
-   `Fire Perimeter`
-   `Flood Signal`
-   `Storm Conditions`
-   `Rain Radar`
-   `Air Quality`
-   `Ocean Conditions`
-   `Volcanic Activity`
-   `Fire Weather`

Technical labels such as NASA FIRMS, PacIOOS, MRMS, RAWS, and GOES
belong in source lines, chips, or diagnostics.

------------------------------------------------------------------------

# 11. Layer Styling Rules

## 11.1 Fire

Fire markers must be visually dominant.

Recommended style: - orange fill - stronger glow - compact but visible
stroke - pulse optional, but restrained

## 11.2 Flood

Flood should be blue-toned and translucent.

Recommended: - fill opacity modest - clear outline - warning/watch
distinction visible

## 11.3 Radar

Radar is raster context only.

Recommended: - moderate opacity - visually lower than fire - no popup
dependency required

## 11.4 Smoke

Smoke should be softer than fire but still legible.

Recommended: - purple or muted smoke palette - stronger outline than
fill

## 11.5 Degraded state

In degraded mode: - do not hide the map - maintain neutral rendering -
visually de-emphasize stale layers - label freshness clearly

------------------------------------------------------------------------

# 12. Mini Map vs Live Map

## 12.1 Homepage mini map

Purpose: - quick visual orientation - simple island-level hazard
context - no dense operational controls

Homepage mini map should not carry full operational complexity.

## 12.2 Live map

Purpose: - deeper situational verification - detailed overlays -
diagnostics access - multi-layer exploration

Live map may include more controls, but still must obey click priority
and visibility rules.

------------------------------------------------------------------------

# 13. Map Freshness and Degraded Behavior

Every map layer should inherit freshness semantics from its signal
bundle.

## 13.1 FRESH

Render normally.

## 13.2 STALE_OK

Render with: - visible stale label in panel or popup - possible visual
de-emphasis

## 13.3 STALE_DROP

Do not render operationally. Fallback options: - remove layer - replace
with neutral unavailable state - keep previous verified snapshot only if
clearly labeled

------------------------------------------------------------------------

# 14. Diagnostics Layer

Diagnostics should be accessible but not primary.

Allowed diagnostics content: - source freshness - parse failures -
network failures - stale counts - cooldown state

Diagnostics should not dominate the 5-second hazard comprehension layer.

------------------------------------------------------------------------

# 15. Mobile Map Rules

For mobile:

-   prioritize hero card over deep controls
-   keep toggles minimal
-   avoid clutter from too many simultaneous overlays
-   preserve tap priority for fire
-   never require map expertise to understand hazard state

------------------------------------------------------------------------

# 16. Forbidden Map Behaviors

The map must never:

-   allow hidden overlays to intercept clicks
-   allow context layers to visually overpower fire
-   let sidebar state define popup identity
-   render malformed geometry
-   show unlabeled stale layers
-   imply official evacuation routing
-   overload the homepage mini map with operational controls

------------------------------------------------------------------------

# 17. Final Requirement

All Kahu Ola web maps, app maps, hero mini maps, and future island map
variants must comply with this layer specification before release.
