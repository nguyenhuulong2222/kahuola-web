# Kahu Ola — Gemma 4 Integration Doctrine
**Version:** 1.0  
**Status:** Final  
**Document type:** Doctrine  
**Owner:** Long Nguyen · kahuola.org  
**Last updated:** 2026-04-07  
**Supersedes:** none (new document)

---

## Core Principle

> **Layer A owns truth. Layer B owns words.**

Gemma 4 is a language reasoning and summarization layer for Kahu Ola. It does not create hazard signals, does not determine severity, and does not replace official data from NASA FIRMS, NWS, NOAA, EPA, or USGS. All authoritative hazard truth comes from Layer A. Gemma 4 may only describe, summarize, translate, or draft language about information that Layer A has already validated.

---

## Three-Layer Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│  LAYER A — CANONICAL ENGINE                                     │
│  Cloudflare Worker · NASA FIRMS · NWS · NOAA · EPA · USGS      │
│                                                                 │
│  Responsibilities: truth, severity, freshness, source labels    │
│  Output: validated canonical JSON                               │
└────────────────────────────┬────────────────────────────────────┘
                             │ canonical JSON only
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER B — GEMMA 4 REASONING                                    │
│  n8n pipeline · AnythingLLM · Mac Mini M4 (local)              │
│                                                                 │
│  Responsibilities: summarize, translate, draft copy, triage     │
│  Input: canonical JSON from Layer A only                        │
│  Output: structured JSON conforming to schema v1                │
└────────────────────────────┬────────────────────────────────────┘
                             │ structured JSON output
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER C — SAFETY WRAPPER                                       │
│                                                                 │
│  Schema validation → forbidden-terms scan → source validation   │
│  → disclosure label append → fallback decision                  │
│                                                                 │
│  If any check fails → deterministic Layer A fallback            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Approved Use Cases

### 1. Morning Brief Automation

**Priority:** Highest  
**Execution mode:** n8n async pipeline

**Description:** Gemma 4 receives canonical JSON from `/api/hazards/summary` and drafts a Morning Brief using a civic summary format: Maui-first, island-by-island, exact HST timestamp, source-aware wording, and platform-specific character limits.

**Required input shape:**
```json
{
  "generated_at": "ISO8601",
  "fire": { "detections": 0, "nearest": "None", "freshness": "FRESH" },
  "flood": { "active": false, "source": "NWS" },
  "tsunami": { "active": false },
  "wind": { "red_flag": false }
}
```

**n8n flow:**
```text
[Schedule 6AM HST]
  → [Fetch /api/hazards/summary]
  → [Gemma 4: morning_brief]
  → [Layer C: safety_wrapper]
  → [Facebook / Telegram post]
```

**Constraint:** If `generated_at` is older than 30 minutes at posting time, cancel the post and log the reason.

---

### 2. Operator Copilot

**Priority:** High  
**Execution mode:** Internal only

**Description:** Runs through AnythingLLM + local Gemma 4 for operator review. Used to compare sources, review anomalies, and draft copy before publication.

**Allowed inputs:**
- canonical JSON snapshots from the Worker
- doctrine files
- current build and progress documents

**Not allowed:** Operator Copilot must not be exposed as a public-facing assistant and must not make autonomous publication decisions.

**Example tasks:**
- "MRMS and FIRMS do not align on Maui windward — is this a review anomaly?"
- "Draft Facebook copy for the current flash flood watch"
- "Review `/api/hazards/fire-weather` for fail-safe path completeness"

---

### 3. Multilingual Civic Copy

**Priority:** High  
**Execution mode:** Public-facing only after Layer C checks

**Description:** Gemma 4 may translate civic hazard copy into community languages used in Hawaiʻi.

**Priority languages:** English · Vietnamese · Ilocano · Tagalog · Japanese · Hawaiian

**Sensitive-question rule:**
If a user asks whether an area is safe, Gemma 4 must not answer with a direct safe/unsafe conclusion.

**Required response template:**
```text
Current status: [signal from canonical JSON]
Source: [source label]
Updated: [timestamp HST]
Kahu Ola does not replace official guidance.
Refer to HIEMA, NWS, and County Emergency Management.
```

---

### 4. Coding Copilot

**Priority:** High  
**Execution mode:** Internal only

**Description:** Supports engineering review and draft implementation work for the current Kahu Ola stack.

**Current stack focus:** Cloudflare Worker TypeScript, HTML/JS, n8n, media automation, GitHub workflow support.

**Appropriate tasks:**
- review Worker routes and fail-safe paths
- audit schema validation logic
- refine stale/freshness policy wording and implementation
- audit map layer isolation
- assist with n8n workflows and media pipeline contracts
- support CI checks and docs sync

**Out of scope by default:** Firebase, Codemagic, and Cloud Functions are not part of the current primary production stack unless explicitly adopted later.

---

### 5. Agentic Internal Automation

**Priority:** Medium  
**Execution mode:** Internal, asynchronous only

**Description:** Used for internal orchestration around media and project workflows.

**Allowed actions:**
- update GitHub issues or project notes
- draft Slack or Telegram summaries
- generate status reports
- read canonical hazard snapshots and produce internal reports
- update operator-facing dashboards

**Not allowed:**
- calling non-canonical upstream sources outside the approved source registry
- computing public evacuation routes
- inserting agentic logic into live user request paths
- making real-time public safety decisions

---

### 6. Vision Triage for Community Images

**Priority:** Pilot only  
**Execution mode:** Internal review tool first

**Description:** Gemma 4 vision may analyze community-submitted images for preliminary triage.

**Allowed outputs:**
- `smoke_present: true/false`
- `likely_plume_direction: "northwest"` when visually clear
- `visibility_obstruction: true/false`
- `hazard_related: true/false`
- `confidence: "high/medium/low"`

**Required label on every vision output:**
```text
Community-submitted · Unverified · AI-generated context · Not an official hazard signal
```

**Not allowed:**
- determining fuel type
- estimating hazard severity from a single image
- confirming an active wildfire from community imagery alone
- providing evacuation advice

**Deployment rule:** Internal pilot first. Public-facing upload flows may only be considered after internal validation.

---

## Prohibited Uses — Absolute Red Lines

| Action | Risk | Violated invariant |
|---|---|---|
| Determining hazard severity | fabrication risk | Invariant III |
| Overriding freshness state | truth manipulation | Invariant III |
| Consuming raw upstream payloads directly | bypass of canonical engine | Invariant I |
| Issuing evacuation advice | high-risk civic domain | Invariant V |
| Classifying an area as safe or unsafe | insufficient real-time certainty | Invariant III |
| Computing public evacuation routes | requires tightly verified closure/traffic systems | Invariant III |
| Making the final false-positive decision | removes signal from system truth | Invariant III |
| Adding severity not present in canonical JSON | fabrication | Invariant III |

---

## Layer B Output Schema — v1

All Gemma 4 output must conform to this schema before Layer C processing.

```json
{
  "schema": "kahuola_ai_output_v1",
  "generated_at": "ISO8601",
  "input_snapshot_id": "canonical snapshot identifier",
  "output_type": "morning_brief | operator_note | multilingual | triage | coding_review",
  "language": "en | vi | fil | ilo | ja | haw",
  "content": "text content",
  "sources_cited": ["NASA FIRMS", "NWS"],
  "confidence": "high | medium | low",
  "forbidden_terms_passed": true,
  "disclosure_label_appended": true,
  "fallback_required": false
}
```

**Validation rules:**
- `sources_cited` must be a subset of canonical `source_label` values from the input
- `forbidden_terms_passed: false` → Layer C rejects the output entirely
- `fallback_required: true` → UI uses deterministic Layer A copy
- `input_snapshot_id` must match the canonical snapshot used for generation

---

## Layer C Forbidden Terms Scanner

Layer C must scan the `content` field and reject output if any of the following terms appear without an explicitly corresponding canonical basis and approved template path:

```text
evacuate
evacuation route
official order
official directive
confirmed fire
confirmed flood
confirmed tsunami
safe to return
area is safe
immediately leave
mandatory evacuation
voluntary evacuation
shelter in place
```

**Required disclosure label for all public-facing AI output:**
```text
AI-generated context · Sources: [sources_cited] · Not an official alert · Follow official guidance from HIEMA, NWS, and County Emergency Management.
```

---

## Degraded Behavior and Fallback

When Gemma 4 times out, errors, or produces invalid output:

```text
Gemma 4 failure
  → Layer C marks fallback_required: true, or receives no valid payload
  → UI renders deterministic Layer A copy
  → no AI error is shown to the user
  → no user-facing AI status banner is required
  → internal logs record timestamp, error_type, and input_snapshot_id
```

**Principle:** AI failure must never degrade civic usability.

**Deterministic fallback template:**
```text
[Island] · [Hazard type]: [active/no active signal]
Source: [source_label] · Updated: [timestamp HST]
Kahu Ola aggregates public hazard signals and does not issue emergency orders.
```

---

## False-Positive Review Boundary

Gemma 4 must not make the final decision to remove a signal from the system.

**Correct Kahu Ola pattern:**
```text
Layer A: rule-based filtering
  → threshold / geofence / known industrial hotspots
  → land-cover / elevation / wind / confidence logic
  → this layer determines system truth

Layer B: Gemma 4 reviews Layer A output and may say
  → "this point resembles a fixed heat source"
  → "review recommended"
  → "insufficient evidence to confirm"

Final decision: operator review or Layer A policy, never Gemma 4 alone
```

---

## Civic Trust Requirements

All public-facing AI output must:

1. display the label **AI-generated context**
2. cite only sources already present in canonical JSON
3. avoid certainty language about hazard status
4. direct users back to official authorities when relevant

**Users must never mistake AI-generated context for an official government signal.**

---

## Alignment with Kahu Ola Doctrine

- **Invariant I:** Client never calls upstream directly → Gemma 4 receives canonical JSON from the Worker only
- **Invariant II:** UI renders under all failure conditions → Layer B failure must fall back cleanly
- **Invariant III:** Parse fail means drop → Gemma 4 must not infer missing structured truth
- **Invariant IV:** Zero PII → Gemma 4 must not receive or emit personal user location data
- **Invariant V:** Estimated perimeter is not official → Gemma 4 must not reclassify perimeter status

---

## Recommended Repository Placement

**Primary path:** `docs/doctrine/GEMMA4_INTEGRATION_DOCTRINE.md`

This document is a doctrine and governance file, not just an implementation note. It should be linked from the project’s main doctrine index and any architecture or source-of-truth index files.

---

*Kahu Ola — Guardian of Life · kahuola.org*  
*Layer A owns truth. Layer B owns words.*
