<!-- SOURCE: docs/architecture/ADR_001_PRODUCTION_REAL_DATA_ONLY.md -->
<!-- CATEGORY: architecture -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# ADR 001: Production Must Use Real Hazard Data

Status: Accepted

---

# Context

Early development versions of the Kahu Ola dashboard used mock states for UI preview.

However, displaying simulated hazards in production would undermine public trust and create legal risk.

---

# Decision

Production systems must use real upstream hazard data only.

Mock data is allowed only in development environments.

---

# Consequences

Positive:

• Increased public trust  
• Accurate situational awareness  
• Clear system integrity  

Negative:

• Development testing becomes more complex  
• Requires robust fallback logic  

---

# Enforcement

Production builds must reject:

• Placeholder API endpoints  
• Mock hazard states  
• Hardcoded hazard values  

All hazard signals must originate from registered upstream data sources.
