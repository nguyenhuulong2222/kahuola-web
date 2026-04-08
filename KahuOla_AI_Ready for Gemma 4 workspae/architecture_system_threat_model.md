<!-- SOURCE: docs/architecture/SYSTEM_THREAT_MODEL.md -->
<!-- CATEGORY: architecture -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# Kahu Ola System Threat Model

This document identifies potential threats to the reliability, accuracy, and safety of the Kahu Ola hazard intelligence platform.

The goal is to ensure the system continues to provide trustworthy situational awareness even during infrastructure failures or extreme hazard events.

---

# Threat Modeling Scope

The Kahu Ola system consists of:

Client Layer
Web dashboard, mobile app, smartwatch clients

Aggregation Layer
Cloudflare Worker hazard aggregator

Upstream Data Sources
NASA FIRMS  
NOAA  
NWS  
EPA AirNow  
USGS  
PacIOOS  
RAWS  
NIFC WFIGS  

Infrastructure Layer
Cloudflare Workers  
Cloudflare Pages  
Edge caching  
API endpoints  

---

# Threat Category 1 — Upstream Data Failure

## Description

Upstream hazard data providers may fail temporarily.

Examples:

• NASA FIRMS API outage  
• NWS alerts endpoint downtime  
• NOAA radar server issues  
• AirNow data delays  

## Impact

The system may lose hazard visibility.

Without safeguards, this could produce:

• false “safe” states  
• blank dashboards  
• outdated hazard data  

## Mitigation

Freshness engine classification:

FRESH  
STALE_OK  
STALE_DROP  

If upstream data becomes unavailable:

The system must transition to:

DEGRADED state.

Users must always see a banner indicating limited data availability.

---

# Threat Category 2 — Satellite Latency

## Description

Satellite-based detection systems have inherent latency.

Example:

NASA FIRMS wildfire detection may be delayed by 10–20 minutes depending on satellite pass.

## Impact

Wildfire signals may appear after fire ignition.

Residents could misinterpret this as a system failure.

## Mitigation

Hazard signals must include:

• detection timestamp  
• satellite confidence level  
• freshness indicator  

UI messaging must clarify:

Satellite signals indicate **possible fire activity**, not confirmed fire reports.

---

# Threat Category 3 — API Rate Limiting

## Description

Frequent requests to upstream APIs may trigger rate limits.

Examples:

NASA FIRMS  
NWS API  
AirNow  

## Impact

Repeated API failures could cascade into degraded system state.

## Mitigation

The architecture enforces:

Client → Worker → Upstream APIs

The Worker provides:

• centralized caching  
• request deduplication  
• edge rate-limit protection  

Clients must never call upstream APIs directly.

---

# Threat Category 4 — Data Integrity Risk

## Description

Malformed upstream responses or schema changes could break parsers.

Example:

An upstream provider modifies field names or response structure.

## Impact

Parsing failures could produce:

• incorrect hazard signals  
• partial data  
• system crashes  

## Mitigation

Strict schema validation is enforced.

If parsing fails:

The signal must be dropped.

No partial signal rendering is allowed.

---

# Threat Category 5 — Misinformation Risk

## Description

During disasters, misinformation spreads rapidly through social media.

Users may confuse Kahu Ola signals with official evacuation orders.

## Impact

Misinterpretation of hazard signals could cause panic or incorrect actions.

## Mitigation

The UI must clearly state:

Kahu Ola provides **situational awareness only**.

Official emergency instructions come from:

HIEMA  
County Emergency Management  
NWS  

All pages must link to official authorities.

---

# Threat Category 6 — Infrastructure Outage

## Description

Cloud infrastructure may experience outages.

Possible causes:

• Cloudflare regional failures  
• DNS issues  
• network disruptions  

## Impact

The dashboard may become temporarily unavailable.

## Mitigation

Static pages should remain accessible through edge caching.

The system architecture minimizes backend dependencies.

The client UI must remain functional even when APIs fail.

---

# Threat Category 7 — Map Interaction Failures

## Description

Complex map layers can create interaction conflicts.

Historical issues include:

• hidden layers capturing clicks  
• incorrect popup identity  
• overlapping polygons blocking interaction  

## Impact

Users may misinterpret hazard locations.

## Mitigation

Map layers must follow strict interaction rules.

Only the active hazard layer may capture click events.

Hidden layers must have pointer events disabled.

---

# Threat Category 8 — Data Staleness Misinterpretation

## Description

Users may assume all displayed data is real-time.

However, different data sources have different update intervals.

Examples:

FIRMS: 10–15 minutes  
AirNow: hourly  
Radar: near real-time  

## Impact

Users may overestimate system accuracy.

## Mitigation

Each signal must display freshness metadata.

Example:

“Satellite hotspot detected 8 minutes ago.”

---

# Threat Category 9 — Overload During Major Disasters

## Description

During major disasters, traffic spikes dramatically.

Example:

Wildfire evacuation events.

## Impact

System traffic spikes could overwhelm infrastructure.

## Mitigation

The architecture uses:

Cloudflare edge caching  
stateless clients  
lightweight JSON APIs  

This design allows the system to scale globally.

---

# Threat Category 10 — Cultural and Community Risk

## Description

Hazard communication systems must respect local communities.

Poor messaging could undermine trust.

## Impact

Residents may ignore warnings.

## Mitigation

Kahu Ola messaging incorporates Hawaiian cultural values.

Guiding principle:

E mālama pono.

Care for people, land, and community.

---

# Threat Model Summary

Kahu Ola addresses system threats through:

• architecture isolation  
• strict validation  
• freshness labeling  
• degraded state handling  
• transparent data sources  

The platform prioritizes trust, clarity, and resilience.

---

# Final Principle

The system must always answer:

“Is there danger near me?”

And it must answer honestly, even when data is incomplete.
