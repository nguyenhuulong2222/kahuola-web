# Contributing to Kahu Ola

Mahalo for your interest in contributing to **Kahu Ola**, a civic hazard intelligence platform for Hawaiʻi.

This project prioritizes **public safety, transparency, and reliability**.

---

# Project Principles

Kahu Ola follows the **V4 Doctrine**.

Core principles:

• Wildfire-first architecture  
• Cache-first system design  
• Privacy-first user model  
• Failure-tolerant UI  
• Civic responsibility

---

# Architectural Rules

All contributions must respect these invariants.

### 1 — Client is Stateless

Clients (web, mobile, watch) must never call external hazard APIs directly.

Allowed flow:
Client → Kahu Ola Worker → External sources

Never:
Client → Kahu Ola Worker → External sources

---

### 2 — Render Independent of Success

UI must render even when:

- APIs fail
- APIs are slow
- APIs are stale

No blank screens.

---

### 3 — Fail Closed

If a schema is invalid:
DROP DATA

Never guess or repair corrupted upstream data.

---

### 4 — Zero Personal Data

Kahu Ola does not store:

- user identity
- personal information
- precise location history

---

# Pull Request Rules

All pull requests must:

• follow the V4 architecture doctrine  
• include clear commit messages  
• not introduce new external API calls in the client  
• respect hazard signal schema definitions  

---

# Development Setup

1. Install Node
2. Install Wrangler
3. Run local worker

Wrangler dev

---

# Community

Kahu Ola exists to help protect the people of Hawaiʻi.

Please treat the project with respect for the communities it serves.

E mālama pono.

