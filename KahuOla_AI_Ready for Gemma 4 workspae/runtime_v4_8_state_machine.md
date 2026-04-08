<!-- SOURCE: docs/runtime/V4_8_STATE_MACHINE.md -->
<!-- CATEGORY: runtime -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# V4.8 System State Machine

## Hazard Priority and State Transition Model

Status: Authoritative V4.8 Runtime Logic Spec\
Audience: Frontend, backend, platform engineers, AI coding agents

------------------------------------------------------------------------

# 1. Purpose

This document defines the **global hazard state machine** used by Kahu
Ola.

The system state machine determines:

• which hazard appears in the hero banner\
• which signals are prioritized\
• which UI color theme is used\
• how degraded states are handled

Without a clear state machine, the interface may show conflicting
signals.

------------------------------------------------------------------------

# 2. Core System States

Kahu Ola V4.8 supports the following global states:

1.  MONITORING
2.  FIRE_ACTIVE
3.  FLOOD_WATCH
4.  FLOOD_WARNING
5.  STORM_ACTIVE
6.  VOLCANIC_WATCH
7.  DEGRADED

Only **one primary state** may control the hero banner at a time.

------------------------------------------------------------------------

# 3. Monitoring State

Used when no major hazards are elevated.

Hero example:

Hawaiʻi Hazard Monitoring\
No major hazards detected in the current snapshot.

Signals may still show:

• wind conditions\
• air quality\
• ocean advisories

Monitoring is the default baseline state.

------------------------------------------------------------------------

# 4. Fire Active State

Triggered when:

• NASA FIRMS high-confidence hotspot detected\
• detection near populated area\
• FRP above threshold or multiple detections

Hero example:

Fire Signal Near Lahaina\
Satellite hotspot detected near populated area.

Fire state overrides all context hazards except degraded state.

------------------------------------------------------------------------

# 5. Flood Watch State

Triggered when:

• NWS Flash Flood Watch active OR • sustained rainfall conditions exceed
threshold

Hero example:

Flood Watch Across Maui\
Heavy rainfall may cause flooding in valleys and low roads.

Flood Watch does not override Fire Active if fire is present.

------------------------------------------------------------------------

# 6. Flood Warning State

Triggered when:

• NWS Flash Flood Warning issued OR • radar rainfall intensity exceeds
emergency thresholds

Hero example:

Flood Warning Active\
Flooding may already be occurring in parts of Maui.

Flood Warning has higher priority than Flood Watch.

------------------------------------------------------------------------

# 7. Storm Active State

Triggered when:

• Kona Storm conditions detected OR • tropical storm / hurricane watch

Hero example:

Kona Storm Conditions Across Hawaiʻi\
Heavy rain, strong winds, and rough seas affecting multiple islands.

Storm state may coexist with flood signals.

------------------------------------------------------------------------

# 8. Volcanic Watch State

Triggered when:

• USGS HVO reports elevated SO₂ emissions OR • vog advisory issued

Hero example:

Volcanic Activity Watch\
Vog conditions may affect downwind districts.

This state is usually localized to Hawaiʻi Island.

------------------------------------------------------------------------

# 9. Degraded State

Triggered when:

• critical upstream APIs unavailable • freshness thresholds exceeded •
cache unavailable

Hero example:

Hazard Data Temporarily Limited\
Some hazard sources are delayed.

Degraded state overrides all others because system confidence is
reduced.

------------------------------------------------------------------------

# 10. Priority Order

The state machine uses strict priority.

Highest → Lowest

1.  DEGRADED
2.  FIRE_ACTIVE
3.  FLOOD_WARNING
4.  FLOOD_WATCH
5.  STORM_ACTIVE
6.  VOLCANIC_WATCH
7.  MONITORING

Only the highest active state controls the hero banner.

------------------------------------------------------------------------

# 11. State Transition Logic

Example transitions:

Monitoring → Fire Active (satellite hotspot detected)

Fire Active → Monitoring (signal disappears)

Monitoring → Flood Watch (heavy rain conditions)

Flood Watch → Flood Warning (flooding confirmed)

Any State → Degraded (critical data failure)

Degraded → Previous state once data freshness restored

------------------------------------------------------------------------

# 12. Map Interaction Rules

The map layer priority must align with system state.

Fire Active • fire markers emphasized

Flood Watch / Warning • flood polygons emphasized

Storm Active • radar overlays emphasized

Monitoring • minimal overlays

Degraded • neutral map state

------------------------------------------------------------------------

# 13. UI Color Themes

Each state controls hero color tone.

Fire Active → red/orange\
Flood Warning → deep blue\
Flood Watch → light blue\
Storm Active → gray-blue\
Volcanic Watch → orange\
Monitoring → green\
Degraded → neutral gray

Color themes must remain consistent across web and app.

------------------------------------------------------------------------

# 14. Developer Interface

Example state variable:

systemState = "MONITORING"

Possible values:

MONITORING\
FIRE_ACTIVE\
FLOOD_WATCH\
FLOOD_WARNING\
STORM_ACTIVE\
VOLCANIC_WATCH\
DEGRADED

------------------------------------------------------------------------

# 15. Testing Requirement

All UI builds must verify:

• correct hero state • correct signal ordering • correct color theme •
correct degraded fallback

------------------------------------------------------------------------

# 16. Final Requirement

All Kahu Ola interfaces must derive their hero state from this state
machine.
