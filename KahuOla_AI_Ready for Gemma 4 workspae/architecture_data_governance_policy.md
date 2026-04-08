<!-- SOURCE: docs/architecture/DATA_GOVERNANCE_POLICY.md -->
<!-- CATEGORY: architecture -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# Kahu Ola Data Governance Policy

This document defines how data is collected, validated, processed, and displayed within the Kahu Ola hazard intelligence platform.

The purpose of this policy is to ensure that all hazard signals presented to the public are reliable, transparent, and responsibly managed.

---

# Data Source Principles

Kahu Ola only uses publicly accessible hazard data from authoritative scientific or governmental sources.

Primary data providers include:

NASA FIRMS  
NOAA  
NWS  
EPA AirNow  
USGS  
PacIOOS  
RAWS  
NIFC WFIGS  

These sources provide satellite observations, weather alerts, environmental conditions, and hazard monitoring data.

Private or unverifiable sources are not permitted in the production hazard pipeline.

---

# Data Transparency

Every hazard signal must clearly indicate its source.

Examples:

Satellite hotspot detection — NASA FIRMS  
Weather alerts — National Weather Service  
Air quality readings — EPA AirNow  

Users must be able to understand where the information originates.

Transparency is essential for public trust.

---

# Data Validation

All upstream data must pass strict validation before becoming a hazard signal.

Validation includes:

• schema verification  
• type checking  
• timestamp validation  
• geographic coordinate validation  

If validation fails, the data must be rejected.

Partial signals must never be displayed.

---

# Data Freshness Governance

All hazard signals must include freshness metadata.

Freshness states:

FRESH  
STALE_OK  
STALE_DROP  

Signals classified as STALE_DROP must never be shown to users.

Freshness indicators must always be visible in the interface.

---

# Data Integrity

Kahu Ola must not alter the scientific meaning of upstream data.

Transformations allowed:

• converting raw datasets into hazard signals  
• simplifying technical fields into plain-language explanations  

Transformations not allowed:

• modifying source data to exaggerate hazards  
• suppressing hazard information  

---

# Privacy Protection

Kahu Ola does not collect or store personally identifiable information.

User location may be used only for:

• local hazard proximity calculations  
• map centering  

Location data must never be stored or transmitted to third parties.

---

# Data Retention

Hazard signals are transient data.

Typical retention windows:

Wildfire hotspots — 24 hours  
Weather alerts — until expiration  
Air quality readings — hourly  

Historical datasets may be archived for research purposes but must be clearly labeled.

---

# Responsible Data Usage

Hazard signals are intended for situational awareness.

Kahu Ola does not provide:

• official emergency instructions  
• evacuation orders  
• law enforcement directives  

Official authority remains with:

HIEMA  
County Emergency Management  
NWS  

---

# Data Governance Review

All new upstream data sources must undergo governance review.

The review must confirm:

• reliability  
• public accessibility  
• scientific credibility  
• legal compliance  

No new data source may be integrated without review.

---

# Guiding Principle

Hazard information must always prioritize public safety and truthfulness over technical complexity.

The platform must remain transparent about what it knows and what it does not know.
