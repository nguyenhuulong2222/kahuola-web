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
- **Products in production:** `VIIRS_NOAA20_NRT`, `VIIRS_NOAA21_NRT`
  (`worker/src/index.ts` → `FIRMS_PRIMARY_DATASETS`); `MODIS_NRT` as a cross-reference only
- **Revisit (Hawaiʻi):** polar-orbiting, so a small number of passes per day per
  satellite — roughly one day and one night pass each, a few total across NOAA-20
  and NOAA-21. **Not continuous.** Between passes there is no observation at all,
  which is why a zero count is never an all-clear (see `REMOTE_SENSING_RULES.md` A4)
- **Latency:** NRT, measured in tens of minutes after the pass, not seconds. Site
  copy states “20–30+ minutes after each satellite pass”. Kahu Ola adds its own
  300 s hotspot cache on top; the **pass**, not the processing, is the limiting factor
- **Pixel size:** VIIRS I-band nominal 375 m at nadir, growing off-nadir. Carried
  per-detection as `scan_km` × `track_km` (+ `footprint_km2`) since RS-1.
  Measured live over Hawaiʻi 2026-09-30: **0.51 × 0.41 km**. A detection marks the
  **pixel center**, never an exact fire location (A5)
- **Overpass (day/night):** sun-synchronous ~13:30 LTAN orbit, so roughly early
  afternoon and after-midnight local passes. `daynight` (`D`/`N`) is carried
  per-detection. **Nominal — verify against NASA LANCE/FIRMS documentation before
  any public claim about specific pass times**

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
- **Revisit:** geostationary — continuous station-keeping over the Pacific, with
  full-disk imagery on a fixed minutes-scale cadence. This is the one fire-adjacent
  source that may honestly be called near-continuous; FIRMS may not (A4)
- **Latency:** minutes from scan to availability — faster than FIRMS, but it is
  **context (L3), not detection (L2)**, and must never be styled or worded as a
  detection (A6)
- **Pixel size:** ABI nominal 2 km for emissive IR bands and 0.5–1 km for
  visible/near-IR, **at nadir**. Hawaiʻi sits far off GOES-West nadir, so the
  effective ground footprint here is materially coarser than the nominal figure.
  **Nominal — verify against NOAA ABI documentation before any public claim**
- **Overpass (day/night):** no overpass gap, but band availability is not constant.
  The Fire Temperature RGB composite (P41) combines an emissive band with two
  **reflective** bands, so it is expected to be daylight-only. Any night use needs
  that verified first

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
