Kahu Ola System Architecture Doctrine
Version V4.7 — Civic Hazard Intelligence Platform for Hawaiʻi
Core Philosophy

Wildfire-First · Cache-First · Privacy-First · Failure-Tolerant · Grant-Ready

Kahu Ola is a civic hazard intelligence platform designed to protect communities across Hawaiʻi.
The architecture prioritizes wildfire detection while supporting multi-hazard situational awareness.

The system must always:

• Render under failure conditions
• Avoid direct client calls to government APIs
• Protect user privacy (Zero-PII)
• Maintain clear separation between canonical signals and context overlays

I. Immutable Architectural Invariants
1 — Client is Stateless

Frontend applications must never call upstream government APIs directly.

All upstream data must flow through the Kahu Ola Aggregator / Tile Broker.

Allowed pattern:

Client
↓
Kahu Ola Worker / Aggregator
↓
NASA / NOAA / NWS / USGS / PacIOOS

2 — Render Independent of Success

The UI must render under:

• API failure
• network outage
• partial data availability

Empty states must show civic-grade messaging instead of blank screens.

3 — Fail Closed Data Parsing

If upstream JSON fails schema validation:

DROP DATA

Never infer missing fields or guess structure.

4 — Zero PII

No GPS or personal location data may be stored or transmitted.

User device location must remain local.

5 — Civic Transparency

Every signal must clearly show:

• source agency
• timestamp
• confidence level

Example:

Wildfire Signal
Source: NASA FIRMS
II. Canonical Hazard Signals (Core System)

Canonical signals are the core intelligence layer of Kahu Ola.

These are used by:

• mobile apps
• notification system
• automated alerts

Current canonical signals:

FireSignal

Wildfire thermal detections.

Source:
NASA FIRMS (VIIRS / MODIS)

Displayed as:
Orange wildfire markers.

SmokeSignal

Satellite smoke plumes.

Source:
NOAA HMS.

Perimeter

Confirmed wildfire boundaries.

Source:
WFIGS / NIFC / official fire perimeters.

III. Web Map Context Overlays (V4.7 Extension)

The web live map may display context overlays that provide situational awareness but are not canonical hazard signals.

These layers must always be labeled context.

Allowed overlays:

Rain Radar

Source: NOAA NWS Radar

Purpose:
Real-time precipitation visualization.

Flood Context

Source:
PacIOOS + terrain logic

Purpose:
Estimate flood-prone terrain zones.

Fire Weather

Source:
NOAA / NWS

Signals include:

• High Wind Warnings
• Red Flag Warnings
• Lightning density

Purpose:
Identify wildfire ignition and spread risk.

Coastal Alerts

Source:
NWS / Tsunami Warning Center

Includes:

• Tsunami warnings
• Storm surge
• High surf advisories

Hurricanes / Cyclones

Source:
National Hurricane Center (NHC)

Includes:

• hurricane track
• cone of uncertainty
• storm classification

IV. Signal Identity Rules

Signals must always identify by source, not by active UI module.

Example:

Correct:

Wildfire Signal
NASA FIRMS

Incorrect:

Rain Radar

(for a wildfire marker)

V. UI Layer Naming (Material 3 Civic UI)
Data Layer	UI Name
NASA FIRMS	Wildfire Signal
NOAA Radar	Rain Radar
PacIOOS terrain flood	Flood Context
NWS Coastal alerts	Coastal Alerts
Wind + Lightning	Fire Weather
NHC storms	Hurricanes / Cyclones
VI. Web Map Rendering Principles

The map must:

• prioritize wildfire signals
• minimize polygon clutter
• maintain mobile usability
• remain readable during disasters

Rules:

Radar uses raster tiles

Wildfire detections use markers

Flood context uses light polygons

Alerts use outlined polygons

VII. Mobile Stability Requirements

Web map must support:

• iOS Safari
• Android Chrome
• low-bandwidth networks

Required safeguards:

safeResize()
requestAnimationFrame resize
delayed WebGL resize
VIII. Data Freshness Policy

All responses must include:

generated_at
stale_after_seconds

Clients must treat stale data as context only.

IX. Deployment Architecture

Production stack:

Cloudflare Worker
↓
Hazard Aggregator
↓
Upstream APIs

Primary upstreams:

NASA FIRMS
NOAA HMS
NWS Alerts
PacIOOS
WFIGS
AirNow

X. System Goal

Kahu Ola exists to protect Hawaiʻi communities by providing:

• wildfire early detection
• flood situational awareness
• disaster-ready civic intelligence

The system must always remain:

simple, transparent, and reliable during crisis.