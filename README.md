Kahu Ola
Hawaiʻi Civic Hazard Intelligence Platform

Kahu Ola is a civic hazard intelligence platform for Hawaiʻi designed to transform complex public hazard data into clear situational awareness signals for residents, responders, and community organizations.

The system aggregates data from multiple public sources including:

NASA FIRMS wildfire satellite detections

National Weather Service alerts

NOAA radar and storm data

EPA AirNow air quality feeds

USGS Hawaiian Volcano Observatory

PacIOOS ocean and coastal sensors

RAWS and MesoWest weather stations

Kahu Ola converts these inputs into validated hazard signals presented through a calm, civic-grade interface designed for rapid comprehension during emergencies.

The platform does not replace official emergency systems and never issues evacuation instructions.

Instead, it provides situational awareness signals and directs users to official emergency authorities.

System Philosophy

Kahu Ola follows a simple principle:

Complex hazard data should be understandable in five seconds.

The system prioritizes:

plain-language hazard signals

freshness transparency

deterministic hazard priority

civic-safe action links

progressive disclosure of technical sources

High-Level Architecture
External Hazard Sources
(NASA · NOAA · NWS · EPA · USGS)

        ↓

Pollers / Parsers
(signal acquisition)

        ↓

Validation Layer
(fail-closed parsing)

        ↓

Signal Normalization
(FireSignal, FloodSignal, etc.)

        ↓

Freshness Engine
(FRESH / STALE_OK / STALE_DROP)

        ↓

Event Priority Engine
(multi-hazard decision)

        ↓

Snapshot Cache
(redis / edge cache)

        ↓

Cloudflare Worker API

        ↓

Clients
Web · Mobile · Smartwatch · Widgets

The client layer renders server-validated hazard signals.

Clients never interpret raw hazard data directly.

Repository Structure
kahuola/
│
├── docs/              # system specifications
│
│   ├── doctrine/
│   ├── architecture/
│   ├── api/
│   ├── map/
│   ├── ux/
│   └── runtime/
│
├── worker/            # Cloudflare Worker aggregator
│
├── web/               # website frontend
│
├── mobile/            # mobile client applications
│
├── scripts/           # pollers and snapshot builders
│
└── infrastructure/    # deployment configuration
Documentation Index

All system specifications live under /docs.

New contributors should begin reading in this order.

1. Core Architecture

Primary system design and hazard data pipeline.

docs/architecture/V4_8_MASTER_INDEX.md
docs/architecture/V4_8_SYSTEM_ARCHITECTURE.md
docs/architecture/V4_8_HAZARD_SIGNAL_PIPELINE.md
docs/architecture/V4_8_CLIENT_ARCHITECTURE.md

These documents describe:

overall system architecture

hazard signal pipeline

client architecture model

2. Runtime Hazard Logic

Defines how hazards are interpreted and prioritized.

docs/runtime/V4_8_STATE_MACHINE.md
docs/runtime/V4_8_EVENT_PRIORITY_SPEC.md
docs/runtime/V4_8_MULTI_HAZARD_DECISION_TREE.md
docs/runtime/V4_8_MOCK_STATE_SPEC.md

These documents define:

hero signal selection

multi-hazard conflict resolution

degraded system behavior

3. API Contracts

Defines data structures shared by all clients.

docs/api/V4_8_API_CONTRACT.md
docs/api/V4_8_SIGNAL_MODEL_SPEC.md
docs/api/V4_8_DATA_FRESHNESS_POLICY.md

These specifications define:

stable API endpoints

unified signal models

freshness classification

4. Civic UX Specifications

Defines how hazard information is presented.

docs/ux/V4_8_HOMEPAGE_HERO_SPEC.md
docs/ux/V4_8_ALERT_COPY_GUIDELINES.md
docs/ux/V4_8_DEGRADED_STATE_UX_SPEC.md

These documents define:

hero signal design

alert copy standards

degraded state user experience

5. Map Rendering Specifications

Defines hazard map layers and rendering order.

docs/map/V4_8_MAP_LAYER_SPEC.md

Includes:

wildfire hotspots

rainfall radar

flood polygons

smoke plume overlays

6. Infrastructure and Worker Architecture

Defines server aggregation and scaling model.

docs/architecture/V4_8_WORKER_AGGREGATOR_SPEC.md
docs/architecture/V4_8_CACHE_STRATEGY.md
docs/architecture/V4_8_RATE_LIMIT_PROTECTION.md

These documents define:

Cloudflare Worker aggregation

caching strategy

rate-limit protection

7. System Doctrine

Defines non-negotiable architectural principles.

docs/doctrine/Kahu_Ola_V4_7_Doctrine.md
docs/doctrine/V4_8_RUNTIME_PROTECTION_ADDENDUM.md

Key invariants include:

client stateless architecture

fail-closed data validation

civic trust guarantees

degraded state transparency

Operational Guarantees

Kahu Ola is designed to remain trustworthy even when upstream systems fail.

The platform provides the following guarantees.

Client Stateless Guarantee

Clients never query upstream hazard providers directly.

Client → Worker → Upstream APIs

All hazard interpretation occurs server-side.

Cache-First Hazard Delivery

Hazard signals are served from validated cached snapshots, not live upstream queries.

This prevents upstream outages from breaking the interface.

Freshness Transparency

Every signal contains explicit freshness metadata.

States include:

FRESH
STALE_OK
STALE_DROP

Users are never shown stale data without labeling.

Fail-Closed Parsing

Invalid upstream payloads are dropped entirely.

The system never attempts to repair malformed hazard data.

Degraded Mode

When upstream sources fail, the platform enters degraded mode.

Example message:

Some hazard data sources are delayed.
Showing the last verified snapshot where possible.

The system never silently hides degraded conditions.

Deterministic Hazard Priority

Multiple hazards are resolved using a deterministic priority model.

Example order:

Degraded
Fire Active
Flood Warning
Flood Watch
Storm Active
Volcanic Watch
Monitoring

Full specification:

docs/runtime/V4_8_MULTI_HAZARD_DECISION_TREE.md
Civic Authority Boundary

Kahu Ola does not issue emergency orders.

The system never:

instructs evacuation routes

overrides official alerts

predicts disaster outcomes

Users must follow guidance from:

Hawaiʻi Emergency Management Agency

County emergency management offices

National Weather Service

other official authorities

Hazard Data Sources

Kahu Ola integrates public hazard data from multiple agencies.

Primary sources include:

NASA FIRMS wildfire hotspots

NOAA radar and weather data

National Weather Service alerts

EPA AirNow air quality

NOAA HMS smoke plume detection

NIFC fire perimeters

PacIOOS coastal sensors

RAWS fire weather stations

USGS Hawaiian Volcano Observatory

These sources are normalized through the Kahu Ola signal pipeline before being presented to users.

System Goal

Kahu Ola aims to provide clear hazard awareness without replacing official emergency systems.

The platform focuses on:

clarity

transparency

civic trust

resilience during disasters

By translating complex hazard data into simple signals, Kahu Ola helps Hawaiʻi residents understand evolving hazard conditions quickly and safely.

License

See the LICENSE file for project license information.

Contributing

Contributors should review the architecture documentation before submitting changes.

Start with:

docs/architecture/V4_8_MASTER_INDEX.md

All system behavior must follow the V4 doctrine and associated runtime specifications.