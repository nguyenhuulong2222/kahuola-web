# V4.8 Alert Copy Guidelines

## Plain-Language Hazard Messaging Rules

**Status:** Authoritative V4.8 Copy Standard\
**Audience:** Product, content, frontend, UX writing, notification
systems, and AI coding agents

------------------------------------------------------------------------

# 1. Purpose

This document defines how Kahu Ola writes hazard copy.

The goal is to ensure that all homepage text, alert cards, signal cards,
map popups, banners, and notifications are:

-   plain-language
-   legally safe
-   trustworthy
-   culturally respectful
-   operationally clear

This document applies across:

-   web homepage
-   island pages
-   live map
-   mobile apps
-   push notifications
-   future wearable alerts

------------------------------------------------------------------------

# 2. Core Writing Principles

All hazard copy must follow these principles:

1.  Say what is happening first.
2.  Say where it matters second.
3.  Say what the user should do next third.
4.  Name the source without letting it dominate the first line.
5.  Never overclaim certainty.

------------------------------------------------------------------------

# 3. Required Order of Meaning

Correct copy order:

1.  Hazard state
2.  Location relevance
3.  Time / freshness
4.  Source / confidence
5.  Next action

## Good example

Fire signal detected near Lahaina.\
Last checked 8 minutes ago.\
Source: NASA FIRMS.\
Check Maui EMA for official evacuation instructions.

## Bad example

NASA FIRMS VIIRS confidence high hotspot signal detected at 20.8783,
-156.6825.

------------------------------------------------------------------------

# 4. Tone Rules

Kahu Ola copy must sound:

-   calm
-   precise
-   direct
-   non-dramatic
-   non-sensational

Forbidden tone:

-   panic language
-   clickbait
-   exaggerated urgency
-   vague alarmism

Incorrect: Massive catastrophe incoming

Correct: Heavy rain and flood risk are increasing across Hawaiʻi.

------------------------------------------------------------------------

# 5. Legal-Safe Language

Kahu Ola must never imply that it is issuing official emergency orders.

## Forbidden phrases

-   evacuate now
-   go here now
-   this road is safe
-   you have X minutes to escape
-   shelter here now
-   Kahu Ola recommends evacuation

## Allowed phrasing

-   Check official alerts now
-   Follow Maui EMA and NWS guidance
-   Review county emergency information
-   Conditions may change quickly
-   Official evacuation instructions may change rapidly

------------------------------------------------------------------------

# 6. Fire Copy Rules

Fire copy must explicitly distinguish a satellite signal from a
confirmed field report.

## Required concepts

-   Fire signal
-   nearby place
-   freshness
-   confidence
-   source
-   satellite-only disclaimer if appropriate

## Good example

Fire signal detected near Lahaina.\
NASA FIRMS (VIIRS) · 8 min ago · High confidence.\
Satellite signal only --- not a confirmed field report.\
Follow Maui EMA for official evacuation orders.

## Good "clear" example

No active fire signal is shown near Maui in the current snapshot.\
Last checked 10 minutes ago.\
Source: NASA FIRMS.

------------------------------------------------------------------------

# 7. Flood Copy Rules

Flood copy must clearly distinguish watch vs warning.

## Watch meaning

Conditions support possible flooding.

## Warning meaning

Flooding is occurring or imminent.

## Good Watch example

Flood Watch in effect across parts of Maui.\
Heavy rainfall may lead to flooding in valleys, stream corridors, and
low-lying roads.\
Source: NWS Honolulu.

## Good Warning example

Flood Warning active for parts of Maui.\
Flooding may already be occurring or expected very soon.\
Check official alerts and avoid flooded roads.

------------------------------------------------------------------------

# 8. Storm Copy Rules

Storm copy should describe system-wide weather context.

## Good example

Kona storm conditions are affecting Hawaiʻi.\
Heavy rain, gusty winds, and rough seas may continue for several hours.\
Official weather alerts may change quickly.

Storm copy should not replace FireSignal semantics in wildfire-first
architecture.

------------------------------------------------------------------------

# 9. Volcanic Copy Rules

Volcanic copy must remain restrained and geographic.

## Good example

Volcanic activity is being monitored on Hawaiʻi Island.\
Vog or elevated SO₂ may affect downwind districts.\
Sensitive groups should limit outdoor exposure if official advisories
increase.

Do not use volcanic copy on Maui-first surfaces unless relevant.

------------------------------------------------------------------------

# 10. Freshness and Trust Language

Every visible hazard card or popup should include freshness wording.

## Preferred freshness phrases

-   Updated 3 minutes ago
-   Last checked 8 minutes ago
-   Last verified 24 minutes ago
-   May be stale
-   Some data sources are delayed

## Forbidden freshness behavior

-   hiding timestamps
-   pretending stale data is current
-   mixing old and new states without labels

------------------------------------------------------------------------

# 11. Source Attribution Rules

Source attribution must be visible but subordinate to the hazard
meaning.

## Preferred source pattern

Fire signal detected near Lahaina.\
Source: NASA FIRMS.

## Do not lead with

NASA FIRMS VIIRS MODIS etc.

Technical source names belong in:

-   chips
-   source lines
-   secondary rows
-   diagnostics

------------------------------------------------------------------------

# 12. Push Notification Rules

Push notifications must be shorter but follow the same hierarchy.

## Good push examples

Fire signal near Lahaina. Check official alerts now.

Flood Watch for parts of Maui. Heavy rain may increase flood risk.

Some Kahu Ola data sources are delayed. Use official alerts while
verification is limited.

## Forbidden push examples

Evacuate now\
Drive north immediately\
Safe route available

------------------------------------------------------------------------

# 13. Popup Copy Rules

Map popups must remain concise.

## Required popup order

-   signal title
-   location
-   freshness
-   source
-   one action note

## Example popup

Wildfire Signal\
Near Lahaina\
Last checked 8 min ago\
Source: NASA FIRMS\
Satellite signal only --- check official alerts.

------------------------------------------------------------------------

# 14. Kūpuna and Keiki Language

When relevant, Kahu Ola should include a community note for:

-   kūpuna
-   keiki
-   people with breathing issues
-   residents in low-lying or flood-prone areas

## Example

Kūpuna, keiki, and residents in low-lying areas should monitor official
alerts and avoid unnecessary travel during heavy rain.

This language should remain respectful and practical, never tokenistic.

------------------------------------------------------------------------

# 15. Degraded State Language

When the system is degraded:

-   be honest
-   stay calm
-   keep official links visible
-   do not name agencies in primary degraded banners

## Good degraded example

Some data sources are delayed.\
Showing the last available verified snapshot where possible.\
Use official alerts for time-sensitive decisions.

## Bad degraded example

NOAA failed. NASA timeout. PacIOOS error.

Detailed diagnostics belong in advanced panels, not the primary civic
layer.

------------------------------------------------------------------------

# 16. Forbidden Copy Patterns

Kahu Ola copy must never:

-   overstate certainty
-   impersonate official emergency authority
-   hide data limitations
-   lead with raw coordinates or jargon
-   create false confidence from stale data
-   provide routing claims or shelter claims without official backing

------------------------------------------------------------------------

# 17. Final Requirement

All Kahu Ola copy --- across hero banners, signal cards, map popups,
notifications, and degraded states --- must comply with these guidelines
before release.
