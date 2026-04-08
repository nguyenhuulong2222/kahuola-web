<!-- SOURCE: docs/doctrine/PROJECT_HANDOFF_RULES.md -->
<!-- CATEGORY: doctrine -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# Kahu Ola Project Handoff Rules

This document ensures continuity when development responsibility transfers to a new developer or AI assistant.

---

# Non-Negotiable Rules

1. Production must only use real upstream hazard data.

Mock states are strictly forbidden in production.

---

2. Browser clients must never call upstream hazard APIs.

All upstream requests must go through the Worker Aggregator.

---

3. The system must never display a blank screen.

Fallback states must always be rendered.

---

4. Stale data must always be labeled.

Freshness states:

FRESH  
STALE_OK  
STALE_DROP  

---

5. Known V4 bugs must never be reintroduced.

Examples:

• Popup identity mismatch  
• Hidden layers still capturing clicks  
• Unlabeled stale data  
• Production pages using mock states  

---

# Development Flow

All major system changes must update:

README.md  
V4_8_MASTER_INDEX.md  
CURRENT_PRODUCTION_STATUS.md  

---

# Architecture Authority

The architecture defined in the V4.8 doctrine overrides any individual developer preferences.

System stability and public trust take priority over feature speed.
