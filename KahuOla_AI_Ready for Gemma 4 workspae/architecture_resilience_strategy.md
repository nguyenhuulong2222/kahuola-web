<!-- SOURCE: docs/architecture/RESILIENCE_STRATEGY.md -->
<!-- CATEGORY: architecture -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# Kahu Ola Resilience Strategy

This document defines the resilience strategy for the Kahu Ola hazard intelligence platform.

The goal is to ensure that Kahu Ola continues to provide situational awareness to Hawaiʻi residents even during infrastructure failures, data outages, or extreme hazard events.

---

# Core Philosophy

Hazard communication systems must remain operational when people need them most.

Disasters create the following conditions:

• infrastructure stress  
• data source outages  
• network congestion  
• misinformation spread  

Kahu Ola is designed to remain usable even under degraded conditions.

---

# Resilience Layer 1 — Architecture Isolation

The system architecture isolates hazard data access behind an aggregation layer.

Architecture:

Client  
↓  
Cloudflare Worker  
↓  
Upstream Data Sources

Benefits:

• upstream API failures do not directly affect clients  
• request deduplication reduces load  
• centralized schema validation prevents data corruption  

Clients never communicate directly with upstream hazard APIs.

---

# Resilience Layer 2 — Edge Caching

Hazard signals are cached at the edge.

Cache locations:

Cloudflare Edge Network

Cache benefits:

• reduces upstream API pressure  
• improves response time  
• allows temporary operation during upstream outages  

Typical TTL values:

FIRMS wildfire signals: 10–15 minutes  
NWS alerts: 5–10 minutes  
Air quality: 60 minutes  

---

# Resilience Layer 3 — Freshness Classification

All hazard signals include freshness classification.

States:

FRESH  
STALE_OK  
STALE_DROP  

If upstream updates stop:

Signals transition gradually:

FRESH → STALE_OK → STALE_DROP

This prevents sudden disappearance of hazard signals.

---

# Resilience Layer 4 — Degraded Mode

If upstream sources fail completely, the system enters DEGRADED state.

Indicators:

• banner warning about limited data  
• previously cached signals displayed if valid  
• reduced signal confidence  

Users must always see the system condition.

The interface must never render a blank screen.

---

# Resilience Layer 5 — Static Frontend Availability

The frontend dashboard is deployed as static content.

Deployment:

Cloudflare Pages

Benefits:

• pages remain accessible even if backend APIs fail  
• minimal infrastructure dependency  
• global edge availability  

Users can still access official emergency links.

---

# Resilience Layer 6 — Multi-Source Hazard Detection

Where possible, hazards are detected using multiple sources.

Examples:

Wildfire detection:

NASA FIRMS  
NIFC WFIGS  

Flood detection:

NWS alerts  
NOAA radar  

Air quality:

EPA AirNow  
NOAA HMS smoke plumes  

Multiple sources reduce reliance on any single data provider.

---

# Resilience Layer 7 — Traffic Surge Handling

Major disasters can produce massive traffic spikes.

Example:

wildfire evacuations

System design mitigations:

• stateless clients  
• lightweight JSON APIs  
• CDN edge caching  

These measures allow the system to scale globally.

---

# Resilience Layer 8 — Communication Fallbacks

Even if hazard data becomes unavailable, the platform must remain useful.

Fallback content includes:

• official emergency links  
• evacuation authority links  
• preparedness guidance  

Users must still receive actionable information.

---

# Resilience Layer 9 — Mobile Compatibility

Mobile devices are often the only devices available during disasters.

The platform is optimized for:

• mobile browsers  
• low bandwidth conditions  
• simplified hazard signals  

The interface must remain readable on small screens.

---

# Resilience Layer 10 — Community Trust

The most critical resilience factor is trust.

If users trust the platform:

they will return during disasters.

Trust is maintained through:

• transparent data sources  
• clear freshness labeling  
• honest degraded state messaging  

The system must never pretend that outdated data is current.

---

# Resilience Strategy Summary

Kahu Ola maintains resilience through:

• architecture isolation  
• edge caching  
• freshness classification  
• degraded state handling  
• multi-source hazard detection  
• static frontend availability  

These layers ensure the platform remains useful during real disasters.

---

# Guiding Principle

Even when data is incomplete, the system must still help people make safer decisions.

---

# Cultural Commitment

The resilience strategy follows the Hawaiian value:

E mālama pono.

Care for people, land, and community through responsible systems.
