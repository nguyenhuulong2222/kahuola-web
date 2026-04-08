<!-- SOURCE: docs/architecture/V4_8_DATA_SOURCE_REGISTRY.md -->
<!-- CATEGORY: architecture -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# V4.8 Data Source Registry
## Canonical Upstream Hazard Source Inventory

**Status:** Authoritative V4.8 Data Source Registry  
**Audience:** Product, engineering, grant reviewers, civic partners, AI coding agents

## Purpose

This document is the canonical registry of external data sources used by Kahu Ola.

It exists to make source provenance explicit for:
- architecture review
- grant applications
- civic trust documentation
- parser ownership
- freshness and TTL planning
- future platform audits

## Source Inventory

### NASA FIRMS
- **Provider:** NASA
- **Hazard Domain:** Wildfire thermal detections
- **Products:** VIIRS / MODIS
- **Data Type:** Point detections / geo feeds
- **Expected Latency:** Near-real-time satellite pass latency
- **Typical Kahu Ola Usage:** FireSignal
- **Parser Owner:** `parsers/firms.ts`
- **Trust Notes:** Satellite detection only; not a confirmed field report by default

### NWS Alerts / api.weather.gov
- **Provider:** NOAA / National Weather Service
- **Hazard Domain:** Official weather alerts
- **Data Type:** JSON / GeoJSON alerts
- **Expected Latency:** Fast / near-real-time
- **Typical Kahu Ola Usage:** FloodSignal, StormSignal, official links
- **Parser Owner:** `parsers/nws.ts`
- **Trust Notes:** Official warning/watch authority

### NOAA Radar
- **Provider:** NOAA
- **Hazard Domain:** Rainfall / storm radar
- **Data Type:** Raster tiles / imagery services
- **Expected Latency:** Fast
- **Typical Kahu Ola Usage:** RadarSignal, map context
- **Parser Owner:** `parsers/noaa.ts`
- **Trust Notes:** Context layer, not a warning by itself

### MRMS / QPE
- **Provider:** NOAA
- **Hazard Domain:** Quantitative precipitation estimation
- **Data Type:** Raster / gridded precipitation
- **Expected Latency:** Fast
- **Typical Kahu Ola Usage:** Flood and rainfall context
- **Parser Owner:** `parsers/noaa.ts`
- **Trust Notes:** Strong flood context input, not official warning alone

### NOAA HMS
- **Provider:** NOAA
- **Hazard Domain:** Smoke plume detection
- **Data Type:** Polygons / smoke analysis
- **Expected Latency:** Medium
- **Typical Kahu Ola Usage:** SmokeSignal
- **Parser Owner:** `parsers/hms.ts`

### EPA AirNow
- **Provider:** EPA
- **Hazard Domain:** AQI / PM2.5
- **Data Type:** JSON / station-based air quality
- **Expected Latency:** Medium
- **Typical Kahu Ola Usage:** AirQualitySignal
- **Parser Owner:** `parsers/airnow.ts`

### NIFC / WFIGS
- **Provider:** National Interagency Fire Center
- **Hazard Domain:** Fire perimeters / incident intelligence
- **Data Type:** Polygon / fire incident datasets
- **Expected Latency:** Medium to slow
- **Typical Kahu Ola Usage:** PerimeterSignal
- **Parser Owner:** `parsers/wfigs.ts`

### NOAA GOES-West
- **Provider:** NOAA
- **Hazard Domain:** Satellite weather / thermal context
- **Data Type:** Imagery / thermal products
- **Expected Latency:** Fast to medium
- **Typical Kahu Ola Usage:** Fire/storm/radar context
- **Parser Owner:** `parsers/noaa.ts`

### PacIOOS
- **Provider:** PacIOOS
- **Hazard Domain:** Ocean / coastal / local marine conditions
- **Data Type:** Sensor feeds / ocean observations
- **Expected Latency:** Medium
- **Typical Kahu Ola Usage:** OceanSignal, coastal context
- **Parser Owner:** `parsers/pacioos.ts`

### RAWS / MesoWest
- **Provider:** USDA / MesoWest ecosystem
- **Hazard Domain:** Wind, humidity, fire weather
- **Data Type:** Weather station observations
- **Expected Latency:** Medium
- **Typical Kahu Ola Usage:** FireWeatherSignal
- **Parser Owner:** `parsers/raws.ts`

### USGS Hawaiian Volcano Observatory
- **Provider:** USGS
- **Hazard Domain:** Volcanic activity / vog / SO2
- **Data Type:** Observatory products / status summaries
- **Expected Latency:** Medium to slow
- **Typical Kahu Ola Usage:** VolcanicSignal
- **Parser Owner:** `parsers/usgs.ts`

### National Hurricane Center
- **Provider:** NOAA / NHC
- **Hazard Domain:** Tropical systems / hurricane advisories
- **Data Type:** Advisory products / track data
- **Expected Latency:** Medium
- **Typical Kahu Ola Usage:** StormSignal
- **Parser Owner:** `parsers/noaa.ts`

### HIEMA / County EMA / Ready Hawaiʻi / FEMA
- **Provider:** State and federal agencies
- **Hazard Domain:** Official emergency guidance
- **Data Type:** Official pages / curated links
- **Expected Latency:** Variable
- **Typical Kahu Ola Usage:** Official action layer
- **Trust Notes:** Official authority, not telemetry

## Final Requirement

This registry must be updated whenever a new upstream source is added, removed, or reclassified.
