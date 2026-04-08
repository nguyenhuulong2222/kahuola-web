# Kahu Ola — Multilingual Translation Doctrine
**Version:** 1.0  
**Status:** Final  
**Document type:** Doctrine  
**Owner:** Long Nguyen · kahuola.org  
**Last updated:** 2026-04-07  
**Supersedes:** none (new document)

---

## Core Principle

> **Canonical hazard truth stays stable across languages. Translation must never alter hazard meaning.**

Kahu Ola may support multilingual content to improve civic access across Hawaiʻi communities. Translation exists to improve comprehension, not to reinterpret hazard truth. All public-facing multilingual output must preserve the meaning, severity, freshness, source attribution, and civic posture already established by the canonical English output.

---

## Translation Doctrine

### 1. Source of Truth

The canonical source of truth remains the validated Layer A hazard output in English.  
All translations must derive from canonical Layer A output or from approved Layer B AI-generated context that has already passed Layer C safety checks.

**Translation must never:**
- change severity
- add certainty
- remove safety qualifiers
- introduce new hazard facts
- add sources not present in the canonical payload

---

### 2. Translation Layers

```text
LAYER A — Canonical English Hazard Output
  ↓
LAYER B — Translation Generation
  - static translation dictionary
  - approved template translations
  - Gemma 4 multilingual translation for allowed dynamic content
  ↓
LAYER C — Translation Safety Wrapper
  - glossary enforcement
  - forbidden phrase scan
  - source label preservation
  - fallback decision
  ↓
User-facing multilingual output
```

---

## Content Classes

### Class A — Fixed System Copy
These strings must be translated through a locked translation file, not by free-form AI generation.

**Examples:**
- navigation labels
- buttons
- footer copy
- privacy/legal text
- source names
- system labels
- freshness labels
- disclaimers
- hazard category names

**Rule:** Human-approved or glossary-locked only.

---

### Class B — Structured Civic Templates
These strings may use template-based translations with controlled variables.

**Examples:**
- No active signal
- Monitoring
- Updated at [time]
- Source: [agency]
- Data may be stale
- View official guidance
- Not an official alert

**Rule:** Template translation only. Variables must be preserved exactly.

---

### Class C — Dynamic Explanatory Content
These strings may be translated by Gemma 4 only after the source content is already approved.

**Examples:**
- morning brief summaries
- short civic explanations
- outreach copy
- operator-reviewed multilingual posts
- AI-generated context cards

**Rule:** Gemma 4 may translate or rewrite only within the approved meaning boundary.

---

## Approved Languages — Initial Priority

Kahu Ola should prioritize languages that improve public comprehension across Hawaiʻi communities.

**Initial language priority:**
1. English
2. Vietnamese
3. Tagalog
4. Ilocano
5. Japanese
6. Hawaiian

Additional languages may be added later only after glossary and QA coverage are ready.

---

## Glossary Lock Rules

Certain terms must never be freely paraphrased by AI unless an approved glossary explicitly defines the target-language equivalent.

**Glossary-locked examples:**
- Red Flag Warning
- Flash Flood Warning
- Flood Watch
- Tsunami Warning
- Tsunami Advisory
- Source
- Updated
- Monitoring
- Data may be stale
- AI-generated context
- Not an official alert
- Follow official guidance
- County Emergency Management
- HIEMA
- NWS
- NOAA
- NASA FIRMS
- EPA
- USGS

**Rule:**  
If an approved translated term exists in the glossary, it must be used exactly.  
If no approved translated term exists, preserve the English original until reviewed.

---

## Public-Facing Translation Rules

All multilingual output must preserve:

- hazard meaning
- severity meaning
- freshness meaning
- agency attribution
- timestamp meaning
- civic uncertainty
- non-official posture where applicable

**Translation must not convert cautious language into certainty language.**

### Examples of forbidden semantic drift
Not allowed:
- turning “monitoring” into “safe”
- turning “possible fire signal” into “confirmed fire”
- turning “data may be stale” into “no issue”
- turning “not an official alert” into language that sounds official

---

## AI Translation Rules for Gemma 4

Gemma 4 may be used for multilingual translation only in these cases:

### Allowed
- translate approved dynamic summaries
- translate AI-generated context already cleared for publication
- produce alternate language outreach drafts
- help operators compare tone and clarity across languages

### Not allowed
- translate raw upstream feeds directly
- translate unvalidated hazard payloads
- reinterpret hazard meaning
- generate safety advice beyond the approved template
- decide whether a translated version is semantically safe without Layer C checks

---

## Sensitive Question Rule

If a user asks in any language whether a place is safe, translation must preserve the same safety boundary as English.

**Required response pattern:**
```text
Current status: [canonical signal]
Source: [agency]
Updated: [timestamp]
Kahu Ola does not replace official guidance.
Follow HIEMA, NWS, and County Emergency Management.
```

**Never translate this into a direct safe/unsafe conclusion unless the canonical system explicitly supports that exact wording.**

---

## Required Disclosure for AI-Generated Context

Whenever dynamic multilingual content comes from Gemma 4, the output must preserve the public label:

```text
AI-generated context · Sources: [sources_cited] · Not an official alert
```

This label may be translated only through the approved glossary or approved legal/civic wording file.

---

## Translation Safety Wrapper — Layer C

Before publishing multilingual content, Layer C must verify:

1. all source labels are preserved
2. all timestamps remain correct
3. all glossary-locked terms are respected
4. no forbidden certainty language appears
5. no prohibited civic instruction is added
6. required disclosure labels are present where applicable

If any check fails, the system must fall back to:
- canonical English
- or a locked template translation
- or no translation shown

---

## Forbidden Translation Outcomes

The system must reject multilingual output if it:

- upgrades uncertainty to certainty
- downgrades severity
- removes freshness warnings
- removes source attributions
- invents instructions
- adds evacuation language without canonical basis
- changes agency names
- changes timestamps or time meaning
- sounds like an official government directive when it is not

---

## Fallback Policy

If translation fails, times out, or fails validation:

```text
Translation failure
  → do not publish invalid translation
  → show canonical English
  → or show locked template translation only
  → never show broken or ambiguous hazard wording
```

**Principle:**  
A missing translation is acceptable.  
A misleading translation is not.

---

## QA Requirements

Before enabling a language publicly, Kahu Ola should test:

- glossary consistency
- civic tone consistency
- timestamp formatting
- hazard severity preservation
- disclaimer preservation
- source label preservation
- back-translation spot checks
- native-speaker review where possible

---

## Recommended Repository Placement

**Primary path:** `docs/doctrine/MULTILINGUAL_TRANSLATION_DOCTRINE.md`

This file should sit next to:
- `docs/doctrine/GEMMA4_INTEGRATION_DOCTRINE.md`

It should also be linked from the doctrine index and any multilingual system design notes.

---

## Alignment with Kahu Ola Doctrine

- **Invariant I:** Client never calls upstream directly → translation consumes canonical output only
- **Invariant II:** UI renders under all failure conditions → translation failure must fall back safely
- **Invariant III:** Parse fail means drop → translation must not invent missing structure
- **Invariant IV:** Zero PII → translation layer must not add personal location or identity data
- **Invariant V:** Estimated or contextual output must not be mistaken for official government guidance

---

*Kahu Ola — Guardian of Life · kahuola.org*  
*Translation improves access. It must never change truth.*
