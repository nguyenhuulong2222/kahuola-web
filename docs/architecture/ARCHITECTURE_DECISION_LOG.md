# Kahu Ola Architecture Decision Log

This document records major architectural decisions and structural evolutions of the Kahu Ola system.

Unlike ADRs, which document individual design decisions, this log provides a chronological narrative of how the system architecture evolved over time.

The goal is to preserve institutional memory and prevent regressions.

---

# 2023 — Lahaina Wildfire Context

The Lahaina wildfire exposed critical failures in public hazard communication systems in Hawaiʻi.

Key insight:

Residents did not lack raw data.
They lacked clear situational awareness.

Existing systems provided fragmented signals:

• NWS alerts  
• Satellite detections  
• Weather radar  
• Social media reports  

But no single system translated these signals into a clear civic dashboard.

This event inspired the concept of **Kahu Ola**.

Mission:

Provide real-time hazard signals translated into plain-language civic intelligence.

---

# 2024 — Early Prototypes

Initial prototypes focused on wildfire detection using NASA FIRMS.

Architecture:

Browser → NASA FIRMS

Problems discovered:

• Direct browser API calls created instability  
• Rate limits caused outages  
• Browser security risks exposed API keys  

Decision:

Introduce an aggregation layer.

---

# 2024 Q3 — Aggregator Architecture

New architecture adopted:

Client → Cloudflare Worker → Upstream APIs

The Worker became responsible for:

• Fetching hazard data  
• Validating schemas  
• Normalizing signals  
• Handling rate limits  
• Caching upstream responses  

This architecture eliminated browser dependence on upstream services.

---

# 2024 Q4 — Hazard Signal Model

Raw datasets proved difficult for users to understand.

Example:

NASA FIRMS returns:

latitude  
longitude  
FRP  
confidence  

These values required interpretation.

Decision:

Introduce **Hazard Signal Models**.

Examples:

FireSignal  
FloodSignal  
StormSignal  
VolcanicSignal  

Each signal translates raw data into:

• severity
• freshness
• plain-language message

---

# 2025 — Multi-Hazard System

Kahu Ola expanded from wildfire-only monitoring to multi-hazard awareness.

Hazards supported:

• Wildfire
• Flood
• Storm
• Volcanic activity
• Air quality
• Ocean conditions

A priority engine was introduced.

Priority order:

Fire  
Flood  
Storm  
Volcanic  
Monitoring

This system determines which hazard becomes the **Primary Event Banner**.

---

# 2025 Q3 — Freshness Engine

Hazard data sources have different update frequencies.

Example:

NASA FIRMS: ~10–15 minutes  
NWS alerts: near real-time  
AirNow: hourly  

Displaying outdated hazard signals could mislead residents.

Decision:

Introduce freshness classification.

States:

FRESH  
STALE_OK  
STALE_DROP  

Only FRESH and STALE_OK signals may be displayed.

STALE_DROP signals are discarded.

---

# 2025 Q4 — Civic Dashboard UX

User testing revealed a critical requirement:

Users must understand hazard conditions within 5 seconds.

Decision:

Adopt the **5-Second Civic Dashboard Layout**.

Structure:

Hero banner  
Primary hazard signal  
Secondary hazard signals  
Context strip  
Mini map  
Official links  
Civic disclaimer

This design prioritizes clarity over complexity.

---

# 2026 — V4 Architecture Doctrine

Version 4 formalized the system architecture.

Key principles:

Client is stateless  
Worker is the aggregation layer  
Signals must pass validation and freshness checks  
Production must use real hazard data only

The system must degrade gracefully under upstream failures.

---

# Runtime Protection Layers

The system includes multiple protection layers.

Layer 1  
Single API endpoint for clients.

Layer 2  
Edge caching and rate-limit protection.

Layer 3  
Strict schema validation.

Layer 4  
Graceful degraded UI state.

These layers ensure the system remains operational during disasters.

---

# Map System Evolution

Early map prototypes used raw datasets.

Problems discovered:

• Layer click conflicts  
• Performance issues on mobile  
• Complex visual noise  

Decision:

Introduce simplified hazard overlays:

Wildfire hotspots  
Radar rainfall  
Flood polygons  
Smoke plumes  

Map layers must never prevent interaction with other hazard signals.

---

# Future Architecture Direction

Planned improvements include:

• Mobile app clients
• Smartwatch hazard alerts
• Satellite event correlation
• Community hazard reporting

However, the core doctrine remains unchanged:

Clear civic situational awareness must always take priority over technical complexity.

---

# Guiding Principle

Kahu Ola exists to answer one question:

“Is there danger near me?”

And it must answer that question clearly within seconds.

---

# Cultural Commitment

The project embraces the Hawaiian principle:

E mālama pono.

Care for people, land, and community through responsible information systems.
