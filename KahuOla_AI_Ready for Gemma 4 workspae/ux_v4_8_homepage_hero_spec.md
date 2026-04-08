<!-- SOURCE: docs/ux/V4_8_HOMEPAGE_HERO_SPEC.md -->
<!-- CATEGORY: ux -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# V4.8 Homepage Hero Specification

## Kahu Ola Homepage Hero System

**Status:** Authoritative V4.8 Homepage Hero Spec\
**Audience:** Product, design, frontend, content, and AI coding agents

------------------------------------------------------------------------

# 1. Purpose

This document defines the official homepage hero system for Kahu Ola
V4.8.

The hero is the highest-priority UI surface on the homepage. It must
communicate statewide hazard status in under five seconds while
preserving:

-   wildfire-first doctrine
-   legal-safe language
-   civic clarity
-   mobile usability
-   official-source trust

The homepage hero is not an operational command center. It is a civic
summary layer that directs users toward the map and official sources.

------------------------------------------------------------------------

# 2. Core Objective

The homepage hero must answer these questions immediately:

1.  What is the most important hazard state right now?
2.  Is Hawaiʻi in a calm, watch, warning, or degraded condition?
3.  How fresh is the data?
4.  Where should the user click next?

If the user cannot answer those four questions within five seconds, the
hero has failed.

------------------------------------------------------------------------

# 3. Hero Structure

The homepage hero consists of six required blocks:

1.  Identity Header
2.  Primary Situation Banner
3.  Signal Stack
4.  Context Strip
5.  Action Buttons
6.  Trust / Disclaimer Surface

------------------------------------------------------------------------

# 4. Identity Header

## Required elements

-   Kahu Ola name
-   Guardian of Life positioning
-   statewide Hawaiʻi framing
-   freshness badge

## Example

Kahu Ola\
Guardian of Life · Hawaiʻi\
Updated 3 minutes ago

## Rules

-   freshness must remain visible without scrolling
-   branding must not overpower hazard clarity
-   decorative language must remain secondary to hazard state

------------------------------------------------------------------------

# 5. Primary Situation Banner

## Purpose

This is the top summary line for current statewide conditions.

## Allowed states

-   Fire Active
-   Storm / Flood Watch
-   Monitoring
-   Degraded / Stale

## Rules

-   banner state must reflect current summary state
-   banner is not a replacement for canonical FireSignal
-   storm banner may be primary during a statewide event, but wildfire
    remains first-class in system architecture
-   degraded banner must be honest and non-alarmist

## Example states

### Fire state

Wildfire Signal Near Maui\
Satellite hotspot detected near Lahaina. Follow official alerts for
evacuation instructions.

### Storm / Flood state

Statewide Storm / Flood Watch\
A Kona storm is bringing heavy rain, flood risk, and strong winds across
Hawaiʻi.

### Monitoring state

Hawaiʻi Hazard Monitoring\
No major statewide hazard is elevated in the current snapshot.

### Degraded state

Hazard Signals Temporarily Degraded\
Some data sources are delayed. Use official links while verification is
limited.

------------------------------------------------------------------------

# 6. Signal Stack

## Purpose

The signal stack translates technical feeds into plain-language cards.

## Required order

1.  Fire Signal
2.  Flood Signal
3.  Volcanic or supplemental statewide signal

## Reason

The signal stack must preserve V4 wildfire-first ordering even when
flood or storm context is dominant on the banner.

## Signal Card Rules

Every signal card must include:

-   plain-language title
-   plain-language summary
-   source chips or source line
-   timestamp / freshness
-   severity state
-   confidence when applicable

### Fire Signal required content

-   Fire Signal state
-   source: NASA FIRMS
-   freshness
-   confidence
-   satellite-only note if not field confirmed
-   FRP available in secondary detail

### Flood Signal required content

-   Watch vs Warning distinction
-   source: NWS and/or NOAA
-   rainfall / forecast context if available
-   freshness

### Supplemental signal

May show: - Volcanic Activity - Air / Smoke - Storm Context

But must not reorder the fire-first stack.

------------------------------------------------------------------------

# 7. Context Strip

## Purpose

The context strip provides rapid situational awareness around the main
hazards.

## Recommended items

-   Wind
-   Air Quality
-   Temperature / Humidity
-   Ocean Conditions

## Rules

-   compact only
-   no long paragraphs
-   one line of value plus one line of subtext
-   should support visual scanning in under two seconds

------------------------------------------------------------------------

# 8. Action Buttons

## Purpose

The homepage hero must convert awareness into safe action.

## Required buttons

-   View Live Map
-   Official Alerts

## Recommended buttons

-   Maui Page
-   Share

## Forbidden buttons

-   Escape Route
-   Safe Route
-   Evacuate Now
-   Drive Here

The homepage hero must not issue routing or evacuation commands.

------------------------------------------------------------------------

# 9. Trust and Disclaimer Surface

## Required trust elements

The homepage hero must show source trust through:

-   source chips
-   timestamp freshness
-   confidence labels
-   official links

## Required disclaimer concepts

-   Kahu Ola is situational awareness
-   Kahu Ola is not an official emergency service
-   official county/state/federal instructions take priority
-   stale or delayed data must be labeled clearly

------------------------------------------------------------------------

# 10. State Model

The homepage hero must support at least four explicit mock/live states.

## 10.1 Fire Active

Use when: - satellite hotspot near populated area - confidence high
enough to elevate - fire becomes primary immediate concern

## 10.2 Flood Watch

Use when: - statewide or island flood watch - Kona storm / heavy
rainfall event - flood conditions matter more than current fire
detection

## 10.3 Monitoring

Use when: - no major active statewide hazard - platform remains in
normal watch mode

## 10.4 Degraded / Stale

Use when: - one or more critical feeds are stale or unavailable - system
must remain usable but transparent

------------------------------------------------------------------------

# 11. Mobile Requirements

The hero must be mobile-first.

## Required behavior

-   all critical meaning above the fold
-   no horizontal scrolling
-   action buttons thumb-friendly
-   signal stack readable without map interaction
-   map optional on first screen, not mandatory

## Rule

The user must understand the hazard state without touching the map.

------------------------------------------------------------------------

# 12. Mini Map Relationship

The homepage may include a mini map, but:

-   the hero explains the hazard
-   the mini map confirms visually
-   the mini map does not replace the signal stack
-   the mini map must not introduce operational clutter

Homepage order should remain:

Hero\
Signal Stack\
Mini Map\
Official Links\
Disclaimer

or

Hero + Mini Map split layout\
Signal Stack\
Official Links\
Disclaimer

------------------------------------------------------------------------

# 13. Accessibility and Cultural Fit

The homepage hero should remain calm, respectful, and readable.

## Required principles

-   large readable headings
-   high contrast
-   low jargon in first layer
-   community-aware tone
-   Kūpuna and Keiki note when relevant

## Example community note

Kūpuna, keiki, and residents in low-lying or flood-prone areas should
monitor official alerts and prepare essentials if conditions escalate.

------------------------------------------------------------------------

# 14. Forbidden Homepage Hero Behaviors

The hero must never:

-   lead with technical acronyms instead of plain-language hazard state
-   hide freshness
-   imply official authority
-   suggest evacuation routes
-   overload the first view with too many simultaneous cards
-   show diagnostics as the first-layer message
-   reorder signals so context visually replaces FireSignal priority

------------------------------------------------------------------------

# 15. Final Requirement

All future Kahu Ola homepage hero implementations must comply with this
specification before release.
