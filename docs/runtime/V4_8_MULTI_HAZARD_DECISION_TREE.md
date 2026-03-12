# V4.8 Multi-Hazard Decision Tree

## Hero Selection, Map Emphasis, and Alert Copy Under Concurrent Hazards

**Status:** Authoritative V4.8 Runtime Decision Spec\
**Audience:** Product, frontend, backend, UX writing, AI coding agents

------------------------------------------------------------------------

# 1. Purpose

Kahu Ola may face situations where multiple hazards are active at the
same time.

Examples:

-   Fire signal near Lahaina during Kona storm
-   Flood Warning on Maui while statewide storm conditions remain active
-   Volcanic vog on Hawaiʻi Island while flood watch exists elsewhere
-   Degraded upstream health while one or more hazards appear elevated

This document defines how the system decides:

-   which hazard controls the hero
-   which map layers are emphasized
-   which signal appears first in the signal stack
-   how alert copy should be written
-   how island pages differ from the statewide homepage

This document works together with:

-   `V4_8_EVENT_PRIORITY_SPEC.md`
-   `V4_8_STATE_MACHINE.md`
-   `V4_8_HOMEPAGE_HERO_SPEC.md`
-   `V4_8_ALERT_COPY_GUIDELINES.md`

------------------------------------------------------------------------

# 2. Core Decision Principle

Kahu Ola must never try to display every hazard as equally primary.

At any moment, the system must select:

1.  one primary hero event
2.  one primary map emphasis
3.  one primary alert copy frame

Other hazards remain visible in:

-   secondary signal cards
-   context strips
-   island summaries
-   map overlays
-   diagnostics

This preserves the 5-second comprehension rule.

------------------------------------------------------------------------

# 3. Decision Inputs

The multi-hazard decision tree evaluates:

-   system health state
-   hazard severity
-   freshness confidence
-   geographic relevance
-   official warning status
-   populated-area proximity
-   event breadth (local vs statewide)

These inputs determine hero, map, and copy outputs.

------------------------------------------------------------------------

# 4. Decision Tree Root

## Step 1 --- System Integrity Check

If system confidence is degraded enough that one or more critical hazard
feeds cannot be trusted:

→ Primary hero = `DEGRADED`

Reason: System trust must be established before hazard interpretation.

If system integrity is acceptable:

→ proceed to Step 2

------------------------------------------------------------------------

# 5. Step 2 --- Immediate Life-Safety Hazard Check

Check for the following in order:

1.  Fire near populated or highly relevant area
2.  Flood Warning
3.  Other future explicit life-safety mandatory alerts

If any of these are active, select the highest-priority applicable
branch.

------------------------------------------------------------------------

# 6. Fire Branch

## Trigger conditions

Fire becomes primary when one or more are true:

-   high-confidence FIRMS detection near populated area
-   multiple clustered detections near community
-   elevated FRP
-   perimeter correlation
-   fire weather strengthens spread concern
-   island page scope makes fire locally dominant

## Outputs

### Hero

`FIRE_ACTIVE`

### Signal stack order

1.  Fire Signal
2.  Flood Signal or Storm Context if active
3.  Volcanic / supplemental signal

### Map emphasis

-   fire points highlighted
-   fire clusters emphasized
-   perimeter if available
-   context overlays visible but visually lower

### Alert copy frame

Lead with fire.

Example: Fire signal detected near Lahaina.\
Official storm context remains active statewide.\
Check Maui EMA for official alerts.

------------------------------------------------------------------------

# 7. Flood Warning Branch

## Trigger conditions

Flood Warning becomes primary when:

-   official NWS Flood Warning is active
-   flooding is occurring or imminent
-   local road, stream, valley, or low-lying area relevance is immediate

## Outputs

### Hero

`FLOOD_WARNING`

### Signal stack order

1.  Fire Signal remains first card if doctrine requires fire-first stack
2.  Flood Signal shown as warning and visually elevated
3.  Storm / volcanic / other context

### Map emphasis

-   flood polygons highlighted
-   flood point markers if applicable
-   rain radar visible if available
-   fire remains tappable and visible if active

### Alert copy frame

Lead with warning language.

Example: Flood Warning active for parts of Maui.\
Flooding may already be occurring or expected very soon.\
Check official alerts and avoid flooded roads.

------------------------------------------------------------------------

# 8. Flood Watch Branch

## Trigger conditions

Flood Watch becomes primary when:

-   official watch active
-   sustained rainfall context elevated
-   flood concern matters more than fire in current scope
-   no higher-priority fire or flood warning exists

## Outputs

### Hero

`FLOOD_WATCH`

### Signal stack

-   Fire Signal remains present and first-class in doctrine
-   Flood card elevated
-   Storm context follows

### Map emphasis

-   flood context visible
-   rain radar context encouraged
-   fire markers still visually stronger if present

### Alert copy frame

Lead with watch semantics.

Example: Flood Watch in effect across parts of Maui.\
Heavy rainfall may cause flooding in valleys and low roads.\
Use official alerts for urgent decisions.

------------------------------------------------------------------------

# 9. Storm Active Branch

## Trigger conditions

Storm becomes primary when:

-   broad Kona storm or tropical system affects multiple islands
-   strong wind + heavy rain + rough seas coexist
-   no stronger local life-safety signal overrides it

## Outputs

### Hero

`STORM_ACTIVE`

### Signal stack

1.  Fire Signal
2.  Flood Signal
3.  Volcanic or other statewide signal

### Map emphasis

-   radar and storm context visible
-   island-wide context allowed
-   fire markers remain visually above radar layers

### Alert copy frame

Lead with statewide weather framing.

Example: Kona storm conditions are affecting Hawaiʻi.\
Heavy rain, gusty winds, and rough seas may continue for several hours.\
Official weather alerts may change quickly.

------------------------------------------------------------------------

# 10. Volcanic Watch Branch

## Trigger conditions

Volcanic becomes primary when:

-   elevated SO₂ or vog has meaningful public relevance
-   Hawaiʻi Island or statewide volcanic context is the most relevant
    elevated signal
-   no fire, flood warning, or stronger storm condition overrides it in
    scope

## Outputs

### Hero

`VOLCANIC_WATCH`

### Signal stack

1.  Fire Signal
2.  Flood / storm if active
3.  Volcanic elevated card

### Map emphasis

-   volcanic overlay visible if implemented
-   context remains island-specific where possible

### Alert copy frame

Lead with restrained, geographic volcanic language.

Example: Volcanic activity is being monitored on Hawaiʻi Island.\
Vog or elevated SO₂ may affect downwind districts.\
Sensitive groups should limit exposure if official advisories increase.

------------------------------------------------------------------------

# 11. Monitoring Branch

## Trigger conditions

Use Monitoring when:

-   no major elevated hazard wins the tree
-   data freshness is acceptable
-   context may still be shown but no hazard dominates

## Outputs

### Hero

`MONITORING`

### Map emphasis

-   minimal overlays
-   calm state
-   context remains available

### Alert copy frame

Lead with calm monitoring.

Example: Hawaiʻi Hazard Monitoring.\
No major hazards are elevated in the current snapshot.

------------------------------------------------------------------------

# 12. Degraded Branch

## Trigger conditions

Use Degraded when:

-   critical source freshness falls below safe threshold
-   cache is stale beyond policy
-   upstream failure blocks confidence in primary hazards

## Outputs

### Hero

`DEGRADED`

### Signal stack

-   show unknown or last verified where policy allows
-   keep freshness labeling explicit

### Map emphasis

-   map remains visible
-   stale overlays may be de-emphasized or removed
-   no false confidence

### Alert copy frame

Lead with calm system trust wording.

Example: Some hazard data sources are delayed.\
Showing the last available verified snapshot where possible.\
Use official alerts for urgent decisions.

------------------------------------------------------------------------

# 13. Homepage vs Island Page Decision Logic

## Homepage

Optimize for statewide understanding.

Decision factors: - statewide breadth - island spread - biggest
public-facing summary event

Example: weak remote fire + strong statewide Kona storm\
→ homepage hero may remain `STORM_ACTIVE`

## Island page

Optimize for local urgency.

Decision factors: - local population relevance - island-specific warning
status - local fire proximity

Example: Maui fire near Lahaina + statewide Kona storm\
→ Maui page hero should be `FIRE_ACTIVE`

------------------------------------------------------------------------

# 14. Hero / Map / Copy Output Matrix

## Case A

Fire Active + Flood Watch

Hero: Fire Active

Map: Fire emphasized, flood visible

Copy: Lead with fire, mention flood second

## Case B

Flood Warning + No Fire

Hero: Flood Warning

Map: Flood emphasized, radar visible

Copy: Lead with flood warning

## Case C

Storm Active + No Fire + No Flood Warning

Hero: Storm Active

Map: Radar/storm emphasis

Copy: Lead with statewide storm framing

## Case D

Fire Active + Degraded

Hero: Degraded

Map: show last verified fire only if clearly labeled

Copy: Lead with degraded trust message, not with certainty

## Case E

Volcanic Watch + Monitoring elsewhere

Homepage: Monitoring or Storm depending on statewide state

Hawaiʻi Island page: Volcanic Watch

------------------------------------------------------------------------

# 15. Tie-Breaker Logic

If two candidate events appear equally strong, apply tie-breakers in
this order:

1.  degraded trust overrides all
2.  official warning beats unofficial context
3.  immediate life-safety beats broad context
4.  local populated relevance beats remote relevance
5.  fresher data beats less fresh data
6.  wildfire-first principle resolves remaining ties

------------------------------------------------------------------------

# 16. Alert Copy Decision Tree

When the primary event is selected:

## If Fire Active

Lead with: - fire signal - place - freshness - official next step

## If Flood Warning

Lead with: - warning - flooding may be occurring - official next step

## If Flood Watch

Lead with: - watch semantics - what may happen - official next step

## If Storm Active

Lead with: - statewide storm framing - multi-effect context - official
next step

## If Degraded

Lead with: - limited confidence - last verified snapshot if applicable -
official links

------------------------------------------------------------------------

# 17. Map Decision Tree

## Fire Active

Highlight: - fire markers - fire clusters - perimeters

## Flood Warning / Watch

Highlight: - flood polygons - radar context

## Storm Active

Highlight: - radar / storm context - statewide visual conditions

## Degraded

Highlight: - neutral map - reduced overlay emphasis - diagnostics
available separately

The visible map layers must not override the chosen hero decision.

------------------------------------------------------------------------

# 18. Testing Scenarios

Every implementation must test at minimum:

-   Fire + Flood Watch
-   Fire + Flood Warning
-   Fire + Storm Active
-   Flood Warning + Storm Active
-   Volcanic Watch + Monitoring
-   Any active hazard + Degraded
-   Local island hazard vs statewide storm
-   Weak remote fire vs strong statewide event

The resulting hero, map emphasis, and copy must match this decision
tree.

------------------------------------------------------------------------

# 19. Forbidden Behaviors

The system must never:

-   show two competing heroes
-   choose hero based on visible tab
-   choose hero based only on map layer visibility
-   hide degraded state behind hazard certainty
-   let broad storm context suppress a high-confidence populated-area
    fire on local pages
-   use raw provider names as hero logic

------------------------------------------------------------------------

# 20. Final Requirement

All Kahu Ola homepage heroes, island page heroes, map emphasis logic,
and alert copy selection must comply with this multi-hazard decision
tree before release.
