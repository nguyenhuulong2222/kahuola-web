# V4.8 Mock State Specification

## Hazard State Simulation for UI and Pre-API Testing

Status: Authoritative V4.8 Mock State Spec\
Audience: Frontend engineers, UI prototyping, QA, AI coding agents

------------------------------------------------------------------------

# Purpose

Mock states allow the Kahu Ola interface to simulate real hazard
environments before APIs are connected.

Supported states: - FIRE_ACTIVE - FLOOD_WATCH - MONITORING - DEGRADED

Each state must map to the real signal schema so UI logic remains
identical when real data arrives.
