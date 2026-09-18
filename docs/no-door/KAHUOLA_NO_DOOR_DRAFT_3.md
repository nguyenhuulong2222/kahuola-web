# KAHU OLA --- NO DOOR

## A Privacy-Minimized Resilient Human-Services Response Graph

**Document type:** Prior-Art Research + Competition Concept\
**Version:** Draft 3.0\
**Date:** 2026-09-17\
**Project:** Kahu Ola · kahuola.org\
**Supersedes:** Draft 2.0\
**Status:** RESEARCHED CONCEPT --- novelty claims narrowed; prototype
validation still required

------------------------------------------------------------------------

# 0. WHAT CHANGED FROM DRAFT 2.0

Draft 2.0 proposed five possible innovations:

1.  Need → Capability Response Compiler
2.  Resilient Service Capability Graph
3.  Synthetic-household Response Gap Simulator / Human-Services Disaster
    Digital Twin
4.  Privacy-Preserving Continuity Token
5.  Integration of all four into a zero/low-intake disaster
    human-services architecture

Draft 3.0 performs a targeted prior-art review.

The result changes the innovation claim substantially:

> **The individual building blocks are not new.**

Knowledge graphs for services exist. Automated emergency workflow
composition exists. Closed-loop social-care referral networks exist.
Synthetic populations and disaster digital twins exist.
Privacy-preserving humanitarian tokens and QR credentials exist.

What was **not identified in this targeted review** is an operational
architecture that combines these ideas around one specific objective:

> **Compile a household-specific human-services response path, minimize
> centralized personal data, test whether that path survives
> provider/infrastructure failures, and expose the exact broken
> capability edge before a real disaster.**

That combination is the strongest research direction for Kahu Ola.

This is **not** a patent novelty opinion and is **not** evidence that no
one in the world has ever built something similar. A formal
patent/literature review would be required before any "world's first" or
"first-of-its-kind" claim.

------------------------------------------------------------------------

# 1. RESEARCH QUESTION

The Draft 2.0 research questions were:

1.  Has anyone implemented a **Need → Capability compiler** for disaster
    human services?
2.  Has anyone represented human-services continuity as a **resilient
    capability graph**?
3.  Has anyone used **synthetic households to discover broken service
    paths** before a disaster?
4.  Has anyone implemented **privacy-preserving need continuity without
    centralized intake identity**?
5.  Has anyone combined all four concepts into an operational
    disaster-response model?

The research below addresses each separately.

------------------------------------------------------------------------

# 2. INNOVATION 1 --- NEED → CAPABILITY RESPONSE COMPILER

## Draft 2.0 idea

Instead of returning a list of organizations:

``` text
Need
 ↓
Constraint reasoning
 ↓
Capability matching
 ↓
Multi-step response path
```

Example:

``` text
Evacuate
 ↓
Transportation
 ↓
Shelter
 ↓
Medication continuity
 ↓
Child/caregiver continuity
 ↓
Pet support
 ↓
Recovery
```

## Prior art found

### A. Dynamic emergency-response process composition already exists

A 2022 peer-reviewed framework, **"A Framework for Dynamic Composition
and Management of Emergency Response Processes,"** uses ontology-based
reasoning to identify actions, resource requirements and relevant
response organizations, then composes an executable emergency-response
process. It also supports adaptation when services fail or resource
availability changes.

This is very close to the generic idea of a "Response Compiler."

Therefore:

> **Automatically composing an emergency-response workflow is not new.**

### B. Automated disaster web-service composition is older

A 2013 study, **"Disaster planning using automated composition of
semantic OGC web services: A case study in sheltering,"** used semantic
service descriptions and AI planning to automatically compose
disaster-planning workflows.

Therefore the broader concept of:

``` text
goal → discover services → compose workflow
```

has significant prior art.

### C. Public-service recommendation from citizen needs also exists

A 2025 paper, **"A Framework for a Public Service Recommender System
Based on Neuro-Symbolic AI,"** combines knowledge graphs,
machine-readable service preconditions and automated reasoning to
recommend public services from citizen profiles.

The paper explicitly discusses a "No-Stop Government" model in which
relevant services can be proactively recommended rather than requiring
citizens to discover them manually.

### D. 211 and social-care systems already match needs to services

United Way 211 documents chatbot and smart-referral experiments,
including self-referral into closed-loop systems. Platforms such as
Unite Us and Findhelp perform social-needs screening, resource/referral
recommendations and cross-organization handoffs.

## Research conclusion

### NOT novel by itself

A generic:

> "AI understands needs and finds services"

claim is weak.

A generic:

> "system composes an emergency workflow"

claim is also weak.

## Potential Kahu Ola differentiation

The narrower opportunity is:

> **Household-level disaster human-services path compilation across
> multiple social needs, using a privacy-minimized Need State rather
> than a longitudinal client record, with explicit path survivability
> under degraded infrastructure.**

This specific combination was not identified in the targeted sources
reviewed.

### Draft 3 position

Rename the component internally from the overly broad:

**Response Compiler**

to:

## **Household Response Path Compiler (HRPC)**

Its job is not to command responders.

Its job is to answer:

> **Given this household's stated needs and constraints, does a viable
> sequence of authoritative service capabilities exist right now?**

------------------------------------------------------------------------

# 3. INNOVATION 2 --- RESILIENT SERVICE CAPABILITY GRAPH

## Draft 2.0 idea

Represent providers as capability nodes:

``` text
Provider
 ├── capability
 ├── eligibility/access conditions
 ├── geography
 ├── availability
 ├── dependencies
 ├── language
 ├── accessibility
 ├── handoffs
 └── fallback alternatives
```

Then reroute if a node or edge becomes unavailable.

## Prior art found

### A. Social-service ontologies already exist

The 2022 **Compass ontology** research formalizes:

-   stakeholders;
-   needs;
-   need satisfiers;
-   services;
-   events;
-   outcomes; and
-   resources

for analyzing social-service provisioning.

This is important prior art against claiming that modeling needs and
services as a graph is new.

### B. Emergency-resource knowledge graphs exist

Research has already constructed knowledge graphs for emergency
resources and disaster information.

Examples include:

-   **Construction of Knowledge Graph for Emergency Resources** (2024)
-   knowledge-graph approaches for natural-disaster emergency service
    scenarios
-   recent typhoon/disaster knowledge-graph systems

### C. Graph-based social-resource navigation exists

Projects such as **LifeGraph** use Neo4j plus AI agents to help foster
youth navigate fragmented social programs.

This is especially relevant because Kahu Ola's concept includes
foster/kinship households.

### D. Failure-aware process adaptation exists

The 2022 dynamic emergency-response composition framework explicitly
handles:

-   service failure/unavailability;
-   interface errors;
-   resource availability changes;
-   threat-zone changes; and
-   user-driven changes.

Therefore:

> **Graph/service rerouting after failure is not new by itself.**

### E. Closed-loop referral networks already model cross-organization care paths

Unite Us describes secure referrals across community partners, service
outcomes and a longitudinal client journey. Research on the Unite Texas
network during Winter Storm Uri shows that technology-assisted
social-care referral networks have already been studied under disaster
conditions.

## Research conclusion

### NOT novel by itself

Neither:

> "social-services knowledge graph"

nor:

> "reroute when a provider fails"

is sufficiently novel.

## Potential Kahu Ola differentiation

The graph should be designed around a different unit of analysis:

> **not organizations, not cases, but survivable capability paths.**

That means the graph's key object becomes an edge such as:

``` text
NEED
  ↓
CAPABILITY
  ↓
ACCESS CONDITION
  ↓
HANDOFF
  ↓
NEXT CAPABILITY
```

and every edge can carry operational properties:

``` yaml
status: available | uncertain | unavailable
authority: official | partner | community
freshness: timestamp
connectivity_required: true/false
phone_fallback: true/false
in_person_fallback: true/false
language_support: [...]
accessibility: [...]
dependency_edges: [...]
```

### Draft 3 position

Rename:

**Service Capability Graph**

to:

## **Resilient Human-Services Capability Graph (RHSCG)**

The graph's purpose is not merely discovery.

Its purpose is:

> **path existence + failure analysis.**

------------------------------------------------------------------------

# 4. INNOVATION 3 --- SYNTHETIC HOUSEHOLDS + RESPONSE GAP DIGITAL TWIN

## Draft 2.0 idea

Generate synthetic household archetypes such as:

``` text
Kūpuna + no vehicle + wildfire
Foster child + medication + pet
Vietnamese speaker + flood + degraded internet
Wheelchair user + evacuation + power outage
```

Then test whether each can reach a complete response path.

## Prior art found

This is the area where Draft 2.0 most clearly overlapped with active
2026 research.

### A. Disaster digital twins with synthetic populations already exist

A 2026 MITRE-led study built a **Miami-Dade digital twin with a
synthetic population** to test hurricane evacuation messaging.

The model combines:

-   demographics;
-   geographic layers;
-   environmental risk;
-   behavioral theory;
-   synthetic agents; and
-   simulated evacuation outcomes.

Therefore:

> **Synthetic populations + disaster digital twin is definitely not
> new.**

### B. Synthetic household evacuation digital twins also exist

A 2026 study on transferring household evacuation-choice behavioral
models builds synthetic populations for New Orleans with the goal of
supporting future storm-response simulation.

### C. Humanitarian synthetic populations exist

A 2026 Royal Society paper generates spatially disaggregated synthetic
populations for refugee and internally displaced-person settlements and
explicitly describes them as a foundation for digital twins and scenario
simulation for humanitarian planning.

### D. Digital twins for disaster-management process bottlenecks exist

A 2026 book chapter proposes descriptive, predictive and prescriptive
digital twins for disaster-management pipelines, including identifying
bottlenecks and failure conditions.

## What was NOT found in the targeted review

The reviewed systems focus primarily on:

-   evacuation behavior;
-   crisis messaging;
-   population modeling;
-   physical/operational emergency processes;
-   logistics; or
-   disaster-management workflow bottlenecks.

The targeted review did **not identify a clear example** whose primary
experiment is:

``` text
synthetic household
       ↓
multi-domain human-services needs
       ↓
service capability graph
       ↓
attempt complete assistance path
       ↓
remove providers/infrastructure
       ↓
identify exact broken service edge
```

That distinction matters.

## Draft 3 position

Do **not** call the innovation merely a "Disaster Digital Twin."

Use:

## **Household Path Resilience Simulator (HPRS)**

and reserve:

## **Human-Services Resilience Twin**

for the future mature system.

The research object is not:

> "Will this household evacuate?"

It is:

> **"If this household seeks help, can the service network actually
> carry it from need to viable assistance under degraded conditions?"**

That is a stronger and more precise research contribution.

------------------------------------------------------------------------

# 5. INNOVATION 4 --- PRIVACY-PRESERVING CONTINUITY TOKEN

## Draft 2.0 idea

Allow a household to carry a short-lived Need State:

``` text
caregiver
child
medication
housing
transportation
preferred language
```

between entry points without Kahu Ola maintaining a central identity
profile.

Possible representations:

-   local device state;
-   QR;
-   printed card;
-   short-lived token.

## Prior art found

This area has substantial prior art.

### A. ICRC-linked privacy-preserving humanitarian tokens

The 2023 research **"Not Yet Another Digital ID: Privacy-Preserving
Humanitarian Aid Distribution"**, developed in collaboration with the
International Committee of the Red Cross, proposes a decentralized
token-based humanitarian aid system designed to preserve recipient
privacy.

It includes smart-card and smartphone implementations.

Therefore:

> **Privacy-preserving humanitarian tokens are not new.**

### B. Privacy-preserving humanitarian wallets

Follow-up research proposes low-cost privacy-preserving digital wallets
for humanitarian aid distribution.

### C. Printed QR humanitarian credentials already exist

The humanitarian DIGID consortium reports a Kenya pilot where people
without phones could receive a **printed QR credential** for
humanitarian cash assistance.

Therefore:

> **Printed QR credentials for humanitarian assistance are not new.**

### D. Offline humanitarian wallets also exist

UNICEF has documented humanitarian cash-transfer prototypes designed to
operate without smartphones or Internet access.

### E. Self-sovereign / decentralized disaster-relief identity has prior art

Recent disaster-relief research combines decentralized identity,
self-sovereign identity and privacy-preserving verification.

## Research conclusion

### NOT novel by itself

Kahu Ola should not claim invention of:

-   privacy-preserving aid tokens;
-   QR humanitarian credentials;
-   decentralized humanitarian wallets;
-   offline aid credentials.

## Potential Kahu Ola differentiation

Kahu Ola's proposed object is different from an identity or entitlement
credential.

It should intentionally be a:

## **Need Continuity Capsule (NCC)**

rather than a "token" that sounds like identity, authorization or
benefits.

The capsule says:

> "These are the needs the household chose to carry forward."

It does **not** say:

> "This person is verified."

It does **not** say:

> "This person is eligible."

It does **not** say:

> "This person received benefit X."

And it should never substitute for provider-required verification.

Example:

``` yaml
schema: kahuola.need.v1
expires: 2026-09-20T12:00:00-10:00

needs:
  - medication_continuity
  - transportation
  - temporary_shelter

household_context:
  - caregiver
  - child
  - pet

communication:
  preferred_language: vi

identity: null
eligibility_claim: null
benefit_claim: null
```

This creates a cleaner conceptual boundary than Draft 2.0.

------------------------------------------------------------------------

# 6. INNOVATION 5 --- THE COMBINED ARCHITECTURE

The final question is the most important:

> Has anyone combined all of these into the same disaster human-services
> architecture?

## Adjacent systems found

### Closed-loop social-care platforms

Unite Us and Findhelp already provide:

-   needs screening;
-   service recommendations;
-   referrals;
-   partner networks;
-   follow-up;
-   outcome tracking;
-   analytics.

Some 211 systems also integrate closed-loop referrals.

These systems prove that cross-sector social-care coordination is mature
territory.

However, these models commonly operate around a client/care record and
partner referral network.

### Disaster-aware closed-loop referral research

The Unite Texas / Winter Storm Uri research demonstrates that a
technology-assisted social-care network can be analyzed before, during
and after a major disaster.

This is particularly important prior art.

### Dynamic emergency process composition

Academic work already dynamically composes operational
emergency-response processes and adapts them after service failures.

### Humanitarian privacy systems

Privacy-preserving humanitarian tokens, wallets and QR credentials
exist.

### Disaster digital twins

Synthetic-population disaster simulations and process digital twins
exist.

## Targeted-review finding

No source in this targeted search clearly demonstrated the following
full loop as one architecture:

``` text
HOUSEHOLD NEED STATE
        ↓
PRIVACY-MINIMIZED REPRESENTATION
        ↓
HUMAN-SERVICES CAPABILITY GRAPH
        ↓
MULTI-STEP HOUSEHOLD RESPONSE PATH
        ↓
FAILURE-AWARE PATH RECOMPOSITION
        ↓
OPTIONAL USER-CONTROLLED NEED HANDOFF
        ↓
SYNTHETIC HOUSEHOLD STRESS TESTING
        ↓
BROKEN CAPABILITY EDGE DETECTION
        ↓
PRE-DISASTER GAP ANALYSIS
```

That is the strongest Kahu Ola research hypothesis.

But the correct wording is:

> **"We did not identify this exact combination in our targeted
> prior-art review."**

Not:

> "Nobody has ever done this."

------------------------------------------------------------------------

# 7. THE DRAFT 3.0 INNOVATION THESIS

Draft 2.0 centered on:

> Privacy-Preserving Disaster Response Compiler

Draft 3.0 narrows and strengthens the thesis:

# **Kahu Ola --- No Door**

## **A Privacy-Minimized Resilient Human-Services Response Graph**

### Research hypothesis

> A disaster human-services network can be modeled as a failure-aware
> capability graph, allowing household needs to be compiled into service
> pathways without requiring Kahu Ola to maintain a centralized identity
> profile; the same graph can then be stress-tested with synthetic
> households to reveal broken assistance pathways before a disaster.

The innovation is **not any single technology**.

The potential innovation is the closed loop:

``` text
ROUTE PEOPLE
     +
TEST THE ROUTES
     +
REVEAL THE GAPS
     +
MINIMIZE CENTRALIZED IDENTITY
```

------------------------------------------------------------------------

# 8. THE NEW CORE --- PATH, NOT PROVIDER

Draft 3.0 changes the fundamental data object.

Draft 1:

``` text
resource
```

Draft 2:

``` text
provider capability
```

Draft 3:

``` text
PATH EDGE
```

Example:

``` text
Need:
medication_continuity

        ↓ requires

Capability:
prescription_replacement_guidance

        ↓ available through

Authoritative Provider

        ↓ requires

Communication channel

        ↓ fallback

phone / in-person / offline instruction
```

Each edge must be independently testable.

The central question becomes:

> **Can the household cross every required edge?**

------------------------------------------------------------------------

# 9. PATH CONTRACT

Every edge in a Kahu Ola response path should eventually expose a
machine-readable contract.

Conceptual example:

``` yaml
edge_id: medication-continuity-01

from:
  type: need
  id: medication_continuity

to:
  type: capability
  id: official_medication_guidance

conditions:
  islands:
    - maui

channels:
  web: true
  phone: true
  in_person: false
  offline_cached: true

languages:
  - en
  - vi

freshness:
  verified_at: 2026-09-17
  max_age_hours: 168

authority:
  level: official

fallback_edges:
  - medication-continuity-02
```

This enables both the live Response Path Compiler and the simulator to
use the same graph.

That is important:

> **The simulation should test the exact same graph used by the
> public-facing routing system.**

No separate "demo simulation model."

------------------------------------------------------------------------

# 10. HOUSEHOLD RESPONSE PATH COMPILER

Input:

``` yaml
hazard_context:
  type: wildfire

needs:
  - evacuation_information
  - transportation
  - medication_continuity
  - shelter

household_context:
  - caregiver
  - child
  - pet

communication:
  preferred_language: vi

connectivity:
  internet: degraded
```

Compiler:

``` text
1. Normalize needs
2. Expand required capabilities
3. Apply household constraints
4. Apply hazard constraints
5. Apply geography
6. Apply channel/connectivity constraints
7. Reject stale/unverified edges
8. Search viable paths
9. Prefer authoritative paths
10. Attach fallbacks
11. Explain path in user's language
```

Output:

``` text
PATH COMPLETE
```

or:

``` text
PATH INCOMPLETE

Missing capability:
accessible transportation

Affected downstream needs:
shelter access
medication continuity
```

The second result is just as important as the first.

Kahu Ola should never fabricate a complete path.

------------------------------------------------------------------------

# 11. HOUSEHOLD PATH RESILIENCE SIMULATOR

The simulator uses synthetic archetypes, never real household records.

Example archetypes:

``` text
A01
Kūpuna
no vehicle
wildfire
English

A02
Caregiver
foster/kinship child
medication
pet
no vehicle
Vietnamese

A03
Wheelchair user
power-dependent medical equipment
flood
degraded cellular

A04
Family with young children
temporary housing need
English
Internet unavailable
```

Then inject failures.

``` text
TEST 1
Provider node removed

TEST 2
Internet unavailable

TEST 3
Cellular degraded

TEST 4
Road corridor unavailable

TEST 5
Primary service at capacity

TEST 6
Language edge unavailable

TEST 7
Multiple failures simultaneously
```

For every scenario:

``` text
compile()
degrade()
recompile()
measure()
```

------------------------------------------------------------------------

# 12. NEW METRIC --- PATH SURVIVABILITY

Do not make "number of resources" the primary metric.

A county can have 200 listed resources and still have a broken system.

Draft 3.0 proposes metrics such as:

## Complete Path Rate

Percentage of synthetic household scenarios for which all required
capabilities have a viable path.

## Degraded Path Rate

Percentage retaining a viable path after a defined failure.

## Single-Point-of-Failure Count

Capabilities for which only one verified provider/channel exists.

## Handoff Burden

Number of organizational transitions required.

## Connectivity Dependency

Percentage of paths that fail when Internet connectivity disappears.

## Language Path Coverage

Percentage of complete paths usable in each supported language.

## Accessibility Path Coverage

Percentage of scenarios retaining a path under defined accessibility
constraints.

## Recovery Continuity

Whether the path continues beyond immediate response into recovery
routing.

These metrics transform the project from a directory into a measurable
resilience model.

------------------------------------------------------------------------

# 13. THE MOST IMPORTANT OUTPUT: BROKEN EDGE

A traditional dashboard might say:

``` text
Resources available: 47
```

Kahu Ola should be able to say:

``` text
SCENARIO

Caregiver
Child
Medication
No vehicle
Wildfire

RESULT

No complete path

BROKEN EDGE

Transportation
     ↓
Medication continuity

REASON

No verified fallback capability remains
under the simulated road/provider failure.
```

This is potentially useful to:

-   emergency managers;
-   human-services agencies;
-   community organizations;
-   preparedness planners;
-   funders;
-   researchers.

The system identifies the **gap**, not who should receive priority.

------------------------------------------------------------------------

# 14. NEED CONTINUITY CAPSULE

Draft 3.0 replaces "Continuity Token" with:

# **Need Continuity Capsule (NCC)**

Purpose:

> Reduce repeated explanation during handoffs without creating a Kahu
> Ola identity system.

Possible local representation:

``` yaml
schema: kahuola.need.v1

created_at: ...
expires_at: ...

needs:
  - medication_continuity
  - transportation
  - temporary_shelter

context:
  - caregiver
  - child
  - pet

language:
  - vi

identity: null
```

Possible forms:

-   QR;
-   local device record;
-   printable card;
-   short text code.

## NCC must NOT represent

-   identity verification;
-   custody;
-   immigration status;
-   medical authorization;
-   eligibility;
-   benefit entitlement;
-   case status.

Those remain with the authoritative provider.

------------------------------------------------------------------------

# 15. AI ROLE

AI is not the core safety authority.

Use AI where language flexibility helps:

``` text
natural language
      ↓
candidate Need State
      ↓
user confirmation
      ↓
deterministic graph reasoning
```

Preferred architecture:

``` text
LLM / language layer
        ↓
structured Need State
        ↓
VALIDATION
        ↓
deterministic / auditable path engine
        ↓
authoritative sources
```

AI should not silently invent:

-   providers;
-   eligibility;
-   operating status;
-   shelter status;
-   official directives;
-   missing graph edges.

Unknown remains unknown.

------------------------------------------------------------------------

# 16. COMPETITION DEMO --- DRAFT 3.0

Do not demo 20 features.

Demo one household.

## Scenario

> A grandmother caring for a foster/kinship child is evacuating during a
> wildfire.\
> The child requires medication.\
> They have a dog.\
> They do not have a vehicle.\
> The caregiver prefers Vietnamese.

### Scene 1 --- Need

No name.

No account.

No address.

Select the situation.

### Scene 2 --- Compile

Show:

``` text
HOUSEHOLD RESPONSE PATH

Evacuation guidance
      ↓
Transportation
      ↓
Shelter pathway
      ↓
Medication continuity
      ↓
Caregiver/child support
      ↓
Pet support
      ↓
Recovery
```

### Scene 3 --- Break it

Judge clicks:

> **SIMULATE PROVIDER FAILURE**

One capability disappears.

Graph recomputes.

### Scene 4 --- Break infrastructure

Judge clicks:

> **SIMULATE INTERNET OUTAGE**

Some edges disappear.

Offline/phone paths remain where verified.

### Scene 5 --- Expose the truth

If no alternative exists:

``` text
PATH BROKEN

Missing capability:
transportation

Kahu Ola will not fabricate a fallback.
```

### Scene 6 --- Continuity

Generate a Need Continuity Capsule.

Show that it contains needs/context but no identity.

### Scene 7 --- Zoom out

Run synthetic households.

Dashboard shows:

``` text
1,000 synthetic household scenarios
93% complete baseline paths
81% survive Internet loss
67% survive provider + road failure

Top broken edge:
accessible transportation
```

All numbers in an actual demo must come from the real prototype, not
fabricated examples.

### Closing screen

> **A resource directory tells us what exists.**
>
> **Kahu Ola tests whether a household can actually reach help.**

------------------------------------------------------------------------

# 17. COMPETITION FIT

The ACF challenge framing shown in the source material emphasizes:

-   disaster-ready human-services systems;
-   coordinated response;
-   multiple entry points;
-   service activation;
-   continuity before, during and after disasters;
-   caregiver/foster/kinship resilience;
-   implementable response models.

No Door should therefore be presented as a **Response Model**, not
primarily as an app.

Important organizational issue:

The challenge material also states that teams need a Response Model in
progress or ready to activate and at least one required state partner
with defined partner roles.

Therefore Kahu Ola should not assume that a solo software submission is
sufficient.

If pursuing the competition itself, partnership/eligibility verification
becomes a separate gating workstream.

Potential role structure:

``` text
Kahu Ola
technical response model / prototype

State or authorized public partner
official program/authority role

Community organizations
capability validation / service pathways

Human-services subject matter partners
workflow validation
```

Do not represent any organization as a partner until an actual
partnership exists.

------------------------------------------------------------------------

# 18. WHAT TO BUILD FIRST

Do not begin with AI.

Do not begin with blockchain.

Do not begin with 10,000 synthetic agents.

Build the smallest artifact that proves the thesis.

## Proof 1 --- Capability Graph

Maui only.

Three needs:

``` text
transportation
temporary shelter routing
medication continuity
```

Two household constraints:

``` text
caregiver + child
preferred language
```

One hazard:

``` text
wildfire
```

## Proof 2 --- Deterministic Compiler

Input a synthetic household.

Output a path.

## Proof 3 --- Failure

Delete one provider/channel.

Recompile.

## Proof 4 --- Broken Edge

Show exactly why the path fails.

## Proof 5 --- Simulation

Generate 50--100 synthetic household archetypes.

Measure path survivability.

Only after these five proofs work should Kahu Ola add a conversational
AI layer.

------------------------------------------------------------------------

# 19. REVISED PHASING

## Phase 0 --- Evidence

-   verify competition rules;
-   formalize prior-art matrix;
-   define claims Kahu Ola will **not** make;
-   define evaluation methodology.

## Phase 1 --- Graph MVP

-   Maui-only;
-   authoritative/verified services;
-   need taxonomy;
-   capability taxonomy;
-   edge schema;
-   freshness rules;
-   fallback relationships.

## Phase 2 --- Path Compiler

-   deterministic graph traversal;
-   constraints;
-   fail-closed stale edges;
-   explanations;
-   EN/VI.

## Phase 3 --- Failure Lab

-   provider outage;
-   Internet outage;
-   channel outage;
-   road/access constraint abstraction;
-   broken-edge reporting.

## Phase 4 --- Synthetic Households

-   archetype generator;
-   reproducible scenario definitions;
-   baseline simulation;
-   survivability metrics.

## Phase 5 --- Need Continuity Capsule

Only after privacy/security review:

-   local state;
-   expiration;
-   QR;
-   offline decode;
-   threat model.

## Phase 6 --- Human-Services Resilience Twin

-   larger scenario library;
-   multi-hazard degradation;
-   capacity constraints where trustworthy data exists;
-   partner validation;
-   longitudinal before/during/after simulation.

------------------------------------------------------------------------

# 20. CLAIMS MATRIX

  -----------------------------------------------------------------------
  Claim                               Draft 3 status
  ----------------------------------- -----------------------------------
  "First disaster knowledge graph"    **DO NOT CLAIM**

  "First automated emergency          **DO NOT CLAIM**
  workflow"                           

  "First privacy-preserving           **DO NOT CLAIM**
  humanitarian token"                 

  "First disaster digital twin"       **DO NOT CLAIM**

  "First synthetic disaster           **DO NOT CLAIM**
  population"                         

  "AI that finds social services"     **NOT DIFFERENTIATING**

  "Closed-loop referral"              **NOT DIFFERENTIATING**

  "Household-specific human-services  **PROMISING RESEARCH ANGLE**
  path survivability"                 

  "Broken capability edge detection   **PROMISING RESEARCH ANGLE**
  using the same graph used for       
  routing"                            

  "Privacy-minimized needs handoff +  **PROMISING COMBINATION; REQUIRES
  path compiler + resilience          FURTHER PRIOR-ART/PATENT REVIEW**
  simulation"                         
  -----------------------------------------------------------------------

------------------------------------------------------------------------

# 21. PRIOR-ART MATRIX

  ------------------------------------------------------------------------------
  Area                    Existing work found            Implication for Kahu
                                                         Ola
  ----------------------- ------------------------------ -----------------------
  Dynamic emergency       Ontology/service-composition   Compiler alone is not
  workflow composition    research                       novel

  Public-service          KG + neuro-symbolic            Need-to-service
  recommendation          citizen-service recommendation reasoning exists

  Closed-loop social      Unite Us, Findhelp, 211        Cross-agency referral
  referrals               integrations                   is mature

  Social-service          Compass ontology and related   Service graph alone is
  ontology/KG             systems                        not novel

  Disaster resource KG    Multiple academic systems      Emergency KG alone is
                                                         not novel

  Failure-aware emergency Dynamic recomposition research Rerouting alone is not
  process                                                novel

  Synthetic disaster      MITRE/Miami-Dade, New Orleans  Synthetic population
  population              research                       alone is not novel

  Humanitarian digital    Multiple 2026 research streams "Digital twin" alone is
  twin                                                   not novel

  Privacy-preserving      ICRC-linked academic research  Token alone is not
  humanitarian token                                     novel

  Printed humanitarian QR DIGID/Kenya                    Paper QR alone is not
  credential                                             novel

  Offline humanitarian    UNICEF-linked work             Offline alone is not
  digital assistance                                     novel

  Household service-path  No exact match identified in   Candidate
  survivability           targeted review                differentiator

  Broken human-services   No exact match identified in   Candidate
  capability edge         targeted review                differentiator
  analysis                                               

  Full combined           No exact match identified in   Strongest hypothesis,
  architecture            targeted review                not proven novelty
  ------------------------------------------------------------------------------

------------------------------------------------------------------------

# 22. SOURCES REVIEWED

## Emergency process composition / service reasoning

1.  **A Framework for Dynamic Composition and Management of Emergency
    Response Processes**\
    Peer-reviewed / PMC. Dynamic ontology-based composition of
    executable emergency-response processes and adaptation to
    service/resource failures.\
    https://pmc.ncbi.nlm.nih.gov/articles/PMC9364781/

2.  **Disaster planning using automated composition of semantic OGC web
    services: A case study in sheltering**\
    Computers, Environment and Urban Systems, 2013.\
    DOI: 10.1016/j.compenvurbsys.2013.06.003

3.  **A Framework for a Public Service Recommender System Based on
    Neuro-Symbolic AI**\
    Applied Sciences, 2025. Knowledge graphs + LLMs + machine-readable
    public-service preconditions and automated recommendation.\
    DOI: 10.3390/app152011235

## Social care / closed-loop referral

4.  **Unite Us Closed-Loop Referral System**\
    Social-needs screening, referrals, partner handoffs and outcomes.\
    https://uniteus.com/products/closed-loop-referral-system/

5.  **Social care best practices: Learnings from a technology-enabled
    closed-loop referral network**\
    Health Services Research, 2025.\
    https://pmc.ncbi.nlm.nih.gov/articles/PMC11972814/

6.  **Examining changes in social care referrals during the 2021 Winter
    Storm Uri in the Unite Texas network**\
    Disaster-period analysis of a technology-assisted social-care
    referral network.\
    Springer / Discover Public Health, 2025.

7.  **United Way 211 --- AI/chatbot and smart-referral examples**\
    Documents CARLA, smart referral networks and
    chatbot/resource-navigation experiments.\
    https://www.211.org/

## Social-service / emergency knowledge graphs

8.  **An Ontological Approach to Analysing Social Service
    Provisioning**\
    Compass ontology: stakeholders, needs, need satisfiers, services,
    events and outcomes.\
    arXiv:2206.11061

9.  **Construction of Knowledge Graph for Emergency Resources**\
    International Journal of Intelligent Systems, 2024.\
    DOI: 10.1155/2024/6668559

10. **LifeGraph: AI Social Resource Navigator**\
    Neo4j + AI agents for navigating fragmented programs for foster
    youth.\
    GitHub public project.

## Disaster digital twins / synthetic populations

11. **Digital twin simulations of theory-driven crisis messaging during
    hurricane evacuations in synthetic populations: a Miami-Dade County
    case study**\
    Frontiers in Artificial Intelligence, 2026. MITRE-led
    synthetic-population disaster digital twin.\
    DOI: 10.3389/frai.2026.1715883

12. **Transferring Household Evacuation Choice Behavioral Models to
    Create a Digital Twin for Future Storm Responses: Opportunities and
    Challenges**\
    Transportation Research Record, 2026. Synthetic populations and
    household evacuation modeling.\
    DOI: 10.1177/03611981251372094

13. **Foundations for digital twins: spatially disaggregated synthetic
    populations of refugee and internally displaced people settlements
    from national census data**\
    Royal Society Open Science, 2026.\
    DOI: 10.1098/rsos.251315

14. **Digital twins for disaster management: mitigating structural
    obstacles in the response pipeline**\
    2026 book chapter describing descriptive/predictive/prescriptive
    disaster-management digital twins.

## Privacy-preserving humanitarian systems

15. **Not Yet Another Digital ID: Privacy-Preserving Humanitarian Aid
    Distribution**\
    Wang, Lueks, Sukaitis, Narbel, Troncoso. Developed in collaboration
    with the ICRC; decentralized token-based privacy-preserving aid
    distribution.\
    arXiv:2303.17343

16. **A Low-Cost Privacy-Preserving Digital Wallet for Humanitarian Aid
    Distribution**\
    Privacy-preserving humanitarian wallet research.\
    arXiv:2410.15942

17. **DIGID Digital Wallet**\
    Humanitarian digital-ID/cash-assistance pilots including printed QR
    credentials for people without phones.\
    https://interoperability.ifrc.org/projects/digital-wallet/

18. **ICRC Handbook on Data Protection in Humanitarian Action**\
    Covers digital identity, blockchain, AI and connectivity risks in
    humanitarian settings.\
    https://www.icrc.org/en/data-protection-humanitarian-action-handbook

19. **UNICEF Office of Innovation --- humanitarian digital cash /
    offline systems**\
    Documents humanitarian cash-transfer prototypes designed for limited
    connectivity and device access.\
    https://www.unicef.org/innovation/

------------------------------------------------------------------------

# 23. RESEARCH LIMITATIONS

This review is intentionally described as a **targeted prior-art
review**, not an exhaustive novelty search.

It did not exhaustively search:

-   USPTO;
-   WIPO PATENTSCOPE;
-   Google Patents;
-   IEEE Xplore;
-   ACM Digital Library;
-   Scopus;
-   Web of Science;
-   ProQuest dissertations;
-   non-English patent databases;
-   proprietary emergency-management platforms;
-   internal government systems;
-   unpublished pilots.

Therefore the defensible conclusion is:

> **No exact match was identified in the reviewed sources.**

The indefensible conclusion is:

> **No one has ever done this.**

Before patent, grant, or competition language makes a formal novelty
claim, conduct a dedicated patent and systematic literature review.

------------------------------------------------------------------------

# 24. DRAFT 3.0 NORTH STAR

Kahu Ola should not try to win by having the largest resource directory.

It should answer a harder question:

> **When the system is under stress, can a particular kind of household
> still reach the capabilities it needs?**

And if the answer is no:

> **Where exactly does the path break?**

The long-term Kahu Ola loop becomes:

``` text
UNDERSTAND THE NEED
        ↓
COMPILE THE PATH
        ↓
TEST THE PATH
        ↓
BREAK THE PATH
        ↓
FIND THE GAP
        ↓
IMPROVE PREPAREDNESS
        ↓
REPEAT
```

with a privacy boundary:

``` text
MINIMIZE IDENTITY
MAXIMIZE PATH CLARITY
NEVER FABRICATE AUTHORITY
```

------------------------------------------------------------------------

# 25. ONE-SENTENCE POSITIONING

> **Kahu Ola No Door models disaster human services as a failure-aware
> capability graph, compiles household needs into auditable service
> paths, and stress-tests those same paths with synthetic households to
> reveal where access to help breaks before a real disaster does.**

------------------------------------------------------------------------

*Kahu Ola --- Guardian of Life · kahuola.org*\
*E mālama pono.*
