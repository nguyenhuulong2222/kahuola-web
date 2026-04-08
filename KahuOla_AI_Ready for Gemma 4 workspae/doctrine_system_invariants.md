<!-- SOURCE: docs/doctrine/SYSTEM_INVARIANTS.md -->
<!-- CATEGORY: doctrine -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# Kahu Ola System Invariants

This document defines the non-negotiable architectural invariants of the Kahu Ola system.

These rules must never be violated by any future change to the system architecture.

If a proposed feature conflicts with an invariant, the feature must be redesigned.

---

# Invariant 1 — Client Must Be Stateless

All clients (web, mobile, smartwatch) must be stateless.

Clients may never fetch hazard data directly from upstream providers.

All hazard data must flow through the Kahu Ola Aggregator.

Architecture:

Client  
↓  
Cloudflare Worker  
↓  
Upstream Data Sources

Upstream data sources include:

• NASA FIRMS  
• NOAA  
• NWS  
• EPA AirNow  
• USGS  
• PacIOOS  
• RAWS  
• NIFC WFIGS

Reason:

Centralized aggregation ensures:

• schema validation  
• caching  
• rate-limit protection  
• security isolation  

---

# Invariant 2 — Production Must Use Real Hazard Data

Production environments must only use real upstream hazard data.

Mock data is forbidden in production.

Mock data may only exist in development or documentation contexts.

Violations include:

• placeholder API endpoints  
• hardcoded hazard states  
• simulated disaster conditions in production pages  

Reason:

Public safety systems must maintain trust.

---

# Invariant 3 — No Blank Screens

The system must never display a blank screen.

If upstream data fails, the UI must render a degraded state.

Fallback states include:

FRESH  
STALE_OK  
STALE_DROP  
DEGRADED

Users must always understand the current system condition.

---

# Invariant 4 — Data Freshness Must Be Visible

Every hazard signal must include freshness metadata.

Freshness classification:

FRESH  
STALE_OK  
STALE_DROP

Stale data must always be labeled.

Signals marked STALE_DROP must never be displayed.

Reason:

Users must understand whether data is current.

---

# Invariant 5 — Hazard Signals Must Be Interpretable

Raw datasets must never be displayed directly to users.

All upstream data must be translated into Hazard Signals.

Examples:

FireSignal  
FloodSignal  
StormSignal  
VolcanicSignal  
AirQualitySignal

Each signal must include:

• severity  
• human-readable message  
• freshness state  
• geographic context  

---

# Invariant 6 — The 5-Second Rule

Users must understand hazard conditions within five seconds.

Dashboard design must prioritize clarity over technical detail.

Required layout structure:

Hero banner  
Primary hazard signal  
Secondary signals  
Context strip  
Map overview  
Official links  
Civic disclaimer

Complex data must never block immediate hazard understanding.

---

# Invariant 7 — Official Authority Must Be Clear

Kahu Ola provides situational awareness.

It does not issue evacuation orders.

Official emergency instructions always come from:

• HIEMA  
• County Emergency Management  
• NWS  

The interface must always link to official authorities.

---

# Invariant 8 — Hazard Priority Must Be Deterministic

When multiple hazards occur simultaneously, a deterministic priority system must select the primary signal.

Current priority order:

1. Fire  
2. Flood  
3. Storm  
4. Volcanic  
5. Monitoring

The primary signal determines the Hero Banner.

---

# Invariant 9 — Graceful Degradation

The system must continue operating even if some upstream data sources fail.

Protection layers:

Layer 1 — Aggregator isolation  
Layer 2 — Edge caching  
Layer 3 — Schema validation  
Layer 4 — Degraded UI state

The failure of one data source must not collapse the entire dashboard.

---

# Invariant 10 — Map Layers Must Never Block Interaction

Map layers must not interfere with user interaction.

Known historical issues include:

• hidden layers capturing clicks  
• incorrect popup identity  
• overlapping polygon hitboxes

Future map implementations must avoid these problems.

---

# Invariant 11 — Transparency of Data Sources

Users must always be able to identify where hazard data originates.

Hazard signals should clearly reference sources such as:

NASA FIRMS  
NOAA  
NWS  
EPA AirNow  
USGS  

Transparency builds trust in civic infrastructure.

---

# Invariant 12 — Cultural Responsibility

Kahu Ola is a civic system serving Hawaiʻi communities.

The platform must respect local cultural principles.

Guiding principle:

E mālama pono.

Care for people, land, and community through responsible information systems.

---

# Enforcement

All architectural changes must be reviewed against these invariants.

If a change violates an invariant, it must not be merged into the production system.

The invariants are the final authority of system design.
