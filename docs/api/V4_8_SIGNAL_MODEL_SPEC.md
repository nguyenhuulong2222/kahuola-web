# V4.8 Signal Model Specification

## Canonical and Context Signal Schemas

**Status:** Authoritative V4.8 Signal Model Spec\
**Audience:** Product, backend, frontend, data engineering, and AI
coding agents

------------------------------------------------------------------------

# 1. Purpose

This document defines the normalized signal model used by Kahu Ola V4.8.

It standardizes:

-   canonical wildfire signals
-   context hazard signals
-   freshness and confidence fields
-   severity and display semantics
-   transport shape between Aggregator and clients

This spec exists so that web, iOS, Android, and future wearable clients
all interpret hazard data the same way.

------------------------------------------------------------------------

# 2. Model Categories

Kahu Ola V4.8 separates signals into two categories.

## 2.1 Canonical Signals

Canonical signals are core operational signals and must remain stable
across platforms.

Canonical set:

-   FireSignal
-   SmokeSignal
-   PerimeterSignal

These are the highest-priority hazard models in the V4 wildfire-first
doctrine.

## 2.2 Context Signals

Context signals provide situational awareness but do not replace
canonical operational priority.

Context set:

-   FloodSignal
-   StormSignal
-   RadarSignal
-   AirQualitySignal
-   OceanSignal
-   VolcanicSignal
-   FireWeatherSignal

Context signals may appear in web hero shells, island pages, and map
overlays.

------------------------------------------------------------------------

# 3. Shared Base Schema

All signals must conform to this shared base structure.

``` json
{
  "schema_version": "4.8",
  "signal_type": "fire",
  "signal_id": "fire_maui_001",
  "region": "maui",
  "scope": "local",
  "source": {
    "provider": "NASA FIRMS",
    "product": "VIIRS",
    "official": false
  },
  "freshness": {
    "state": "FRESH",
    "generated_at": "2026-03-11T20:45:00Z",
    "last_checked_at": "2026-03-11T20:44:00Z",
    "stale_after_seconds": 900
  },
  "display": {
    "headline": "Fire signal detected near Lahaina",
    "summary": "Satellite hotspot detected near populated Maui area.",
    "severity": "WARNING",
    "color": "red",
    "confidence_label": "High"
  },
  "properties": {},
  "geometry": null
}
```

------------------------------------------------------------------------

# 4. Shared Required Fields

Every signal must include:

-   `schema_version`
-   `signal_type`
-   `signal_id`
-   `region`
-   `scope`
-   `source.provider`
-   `source.product`
-   `source.official`
-   `freshness.state`
-   `freshness.generated_at`
-   `freshness.last_checked_at`
-   `freshness.stale_after_seconds`
-   `display.headline`
-   `display.summary`
-   `display.severity`
-   `display.color`

------------------------------------------------------------------------

# 5. Enumerations

## 5.1 signal_type

Allowed values:

-   `fire`
-   `smoke`
-   `perimeter`
-   `flood`
-   `storm`
-   `radar`
-   `air_quality`
-   `ocean`
-   `volcanic`
-   `fire_weather`

## 5.2 scope

Allowed values:

-   `local`
-   `island`
-   `statewide`

## 5.3 freshness.state

Allowed values:

-   `FRESH`
-   `STALE_OK`
-   `STALE_DROP`

## 5.4 display.severity

Allowed values:

-   `CLEAR`
-   `LOW`
-   `ELEVATED`
-   `WATCH`
-   `WARNING`
-   `CRITICAL`
-   `UNKNOWN`

## 5.5 display.color

Allowed values:

-   `green`
-   `blue`
-   `yellow`
-   `orange`
-   `red`
-   `gray`

------------------------------------------------------------------------

# 6. FireSignal

## 6.1 Purpose

Represents a wildfire thermal detection or fire intelligence signal.

## 6.2 Required FireSignal properties

``` json
{
  "properties": {
    "confidence": "high",
    "frp_mw": 87.0,
    "satellite": "VIIRS",
    "distance_miles": 13.4,
    "wind_mph": 18,
    "wind_direction": "NE",
    "humidity_pct": 34,
    "satellite_only": true
  }
}
```

## 6.3 FireSignal rules

-   Must never be phrased as a confirmed field report unless confirmed
    by official source.
-   If based on FIRMS only, `satellite_only` must be `true`.
-   Confidence must be normalized to:
    -   `low`
    -   `nominal`
    -   `high`
-   FRP must be numeric if available.
-   UI may translate FRP into a user-facing intensity label, but raw FRP
    must remain available.

## 6.4 FireSignal severity guide

Suggested normalization:

-   `CLEAR` → no signal
-   `WATCH` → low/nominal confidence or distant detection
-   `WARNING` → high-confidence detection near populated area
-   `CRITICAL` → multiple high-confidence detections and/or extreme FRP

------------------------------------------------------------------------

# 7. SmokeSignal

## 7.1 Purpose

Represents smoke plume presence or smoke exposure context.

## 7.2 Required SmokeSignal properties

``` json
{
  "properties": {
    "aqi": 117,
    "pm25": 42.3,
    "plume_density": "moderate",
    "sensitive_groups_warning": true
  }
}
```

## 7.3 Rules

-   Smoke may come from NOAA HMS, EPA AirNow, or blended model.
-   Source line must remain explicit.
-   Smoke does not replace FireSignal priority.

------------------------------------------------------------------------

# 8. PerimeterSignal

## 8.1 Purpose

Represents an official or semi-official fire perimeter polygon.

## 8.2 Required PerimeterSignal properties

``` json
{
  "properties": {
    "incident_name": "Lahaina Incident",
    "official": true,
    "acres": 1350,
    "containment_pct": 42,
    "status": "active"
  }
}
```

## 8.3 Rules

-   Geometry is required.
-   If official source exists, `source.official` must be `true`.
-   Perimeter is not the same as active spread direction.

------------------------------------------------------------------------

# 9. FloodSignal

## 9.1 Purpose

Represents flash flood or heavy-rain hazard context.

## 9.2 Required FloodSignal properties

``` json
{
  "properties": {
    "alert_level": "watch",
    "rain_rate_in_hr": 1.1,
    "duration_minutes": 45,
    "forecast_hours": 3,
    "affected_features": [
      "stream corridors",
      "low-lying roads",
      "valleys"
    ]
  }
}
```

## 9.3 Rules

-   Must differentiate `watch` vs `warning`.
-   If derived only from rainfall context and not official alert, this
    must be reflected in summary text.
-   Watch means conditions support flooding.
-   Warning means flooding is occurring or imminent.

------------------------------------------------------------------------

# 10. StormSignal

## 10.1 Purpose

Represents a broader weather event such as Kona storm, tropical storm,
or severe thunderstorm environment.

## 10.2 Required StormSignal properties

``` json
{
  "properties": {
    "storm_name": "Kona Storm",
    "wind_mph": 27,
    "gust_mph": 44,
    "heavy_rain_expected": true,
    "thunderstorm_risk": true
  }
}
```

## 10.3 Rules

-   StormSignal is event framing, not evacuation authority.
-   It may become the homepage banner condition while FireSignal remains
    canonical priority internally.

------------------------------------------------------------------------

# 11. RadarSignal

## 11.1 Purpose

Represents rainfall/radar context layer summary.

## 11.2 Required RadarSignal properties

``` json
{
  "properties": {
    "rain_rate_in_hr": 1.1,
    "coverage": "broad",
    "sustained_minutes": 45
  }
}
```

## 11.3 Rules

-   RadarSignal should usually be context only.
-   It should not be treated as official warning by itself.

------------------------------------------------------------------------

# 12. AirQualitySignal

## 12.1 Purpose

Represents AQI / PM2.5 public health exposure context.

## 12.2 Required properties

``` json
{
  "properties": {
    "aqi": 67,
    "category": "Moderate",
    "pm25": 18.2,
    "health_note": "Sensitive groups should monitor conditions."
  }
}
```

------------------------------------------------------------------------

# 13. OceanSignal

## 13.1 Purpose

Represents marine, surf, or coastal hazard context.

## 13.2 Required properties

``` json
{
  "properties": {
    "advisory": "High Surf Advisory",
    "shore": "North and West Shores",
    "severity_level": "watch"
  }
}
```

------------------------------------------------------------------------

# 14. VolcanicSignal

## 14.1 Purpose

Represents volcanic gas, ash, eruptive, or vog-related public context.

## 14.2 Required properties

``` json
{
  "properties": {
    "so2_elevated": true,
    "vog_advisory": true,
    "districts": ["Kaʻū", "Kona"]
  }
}
```

## 14.3 Rules

-   VolcanicSignal should usually be statewide or island-specific.
-   It should not displace FireSignal on Maui-first pages unless truly
    relevant.

------------------------------------------------------------------------

# 15. FireWeatherSignal

## 15.1 Purpose

Represents wind, humidity, and fuel-driven wildfire risk context.

## 15.2 Required properties

``` json
{
  "properties": {
    "wind_mph": 24,
    "gust_mph": 38,
    "humidity_pct": 31,
    "red_flag": false,
    "risk_level": "elevated"
  }
}
```

------------------------------------------------------------------------

# 16. Geometry Rules

## 16.1 Allowed geometry types by signal

-   FireSignal → Point
-   SmokeSignal → Polygon / MultiPolygon / null summary
-   PerimeterSignal → Polygon / MultiPolygon
-   FloodSignal → Polygon / MultiPolygon / null summary
-   StormSignal → null summary or Polygon
-   RadarSignal → null summary or Polygon
-   AirQualitySignal → null summary
-   OceanSignal → null summary or Polygon
-   VolcanicSignal → null summary or Polygon
-   FireWeatherSignal → null summary or Polygon

## 16.2 Null geometry

Null geometry is allowed for summary-only cards and hero signals.

------------------------------------------------------------------------

# 17. Client Rendering Rules

## 17.1 Hero layer

Hero cards must only use:

-   display.headline
-   display.summary
-   display.severity
-   display.color
-   freshness
-   source

## 17.2 Technical detail layer

FRP, PM2.5, raw rain rate, and similar metrics belong in secondary
detail rows or chips.

## 17.3 Progressive disclosure

Technical source names and model names should remain visible but
subordinate to plain-language hazard text.

------------------------------------------------------------------------

# 18. Forbidden Modeling Behaviors

The system must never:

-   present FIRMS as a confirmed on-the-ground fire report
-   hide freshness or confidence
-   collapse watch and warning into the same meaning
-   infer missing schema fields
-   relabel malformed data into another signal type
-   allow stale data to masquerade as current

------------------------------------------------------------------------

# 19. Final Requirement

All future Kahu Ola signal bundles, hero states, map layers, and app
cards must conform to this specification before release.
