# Kahu Ola — Doctrine Index
**Version:** 1.0  
**Status:** Final  
**Document type:** Index  
**Owner:** Long Nguyen · kahuola.org  
**Last updated:** 2026-04-07  
**Supersedes:** none (new document)

---

## Purpose

This index defines the current doctrine set for Kahu Ola’s AI, multilingual, and translation governance layer.

It exists to:
- keep doctrine files discoverable
- define reading order
- reduce duplication
- clarify which file governs which decision
- support consistent implementation across repo, automation, and operator workflows

This index should be treated as the entry point for the current AI-related doctrine set.

---

## Core Doctrine Set

### 1. `docs/doctrine/GEMMA4_INTEGRATION_DOCTRINE.md`
**Role:** Primary governance document for Gemma 4 inside Kahu Ola.

**Covers:**
- Layer A / Layer B / Layer C separation
- approved Gemma 4 use cases
- prohibited uses
- civic trust boundary
- fallback behavior
- repository placement guidance

**Read this first** if the question is:
- what Gemma 4 is allowed to do
- what Gemma 4 must never do
- how AI fits into Kahu Ola architecture

---

### 2. `docs/doctrine/MULTILINGUAL_TRANSLATION_DOCTRINE.md`
**Role:** Governance document for multilingual behavior.

**Covers:**
- translation as access, not reinterpretation
- translation layers
- content classes
- AI translation boundaries
- sensitive question handling
- fallback policy for translation

**Read this first** if the question is:
- how multilingual output should behave
- what AI may translate
- how safety boundaries carry across languages

---

### 3. `docs/doctrine/TRANSLATION_GLOSSARY_SEED.md`
**Role:** Locked terminology seed for multilingual Kahu Ola output.

**Covers:**
- glossary-locked terms
- restricted terms
- prohibited terms
- English preservation rules
- staged rollout guidance by language

**Read this first** if the question is:
- whether a term may be translated freely
- which wording must stay fixed
- which phrases are too risky to localize loosely

---

### 4. `docs/doctrine/AI_OUTPUT_SCHEMA_V1.md`
**Role:** Structured schema contract for Layer B output entering Layer C.

**Covers:**
- required JSON fields
- validation logic
- public vs internal output rules
- rejection cases
- fallback contract
- schema field definitions

**Read this first** if the question is:
- what valid AI output must look like
- how Layer C validates AI output
- when output must be rejected

---

## Recommended Reading Order

For a new operator, engineer, or AI workflow builder, read in this order:

1. `GEMMA4_INTEGRATION_DOCTRINE.md`
2. `MULTILINGUAL_TRANSLATION_DOCTRINE.md`
3. `TRANSLATION_GLOSSARY_SEED.md`
4. `AI_OUTPUT_SCHEMA_V1.md`

**Why this order works:**
- first define AI boundaries
- then define multilingual boundaries
- then lock critical wording
- then enforce output structure

---

## Decision Map

Use this section to find the correct doctrine file quickly.

### If the question is about...
**“Can Gemma 4 do this?”**  
→ `GEMMA4_INTEGRATION_DOCTRINE.md`

**“Can this sentence be translated by AI?”**  
→ `MULTILINGUAL_TRANSLATION_DOCTRINE.md`

**“Should this term stay in English?”**  
→ `TRANSLATION_GLOSSARY_SEED.md`

**“Why was this AI output rejected?”**  
→ `AI_OUTPUT_SCHEMA_V1.md`

**“Can this output go public?”**  
→ Start with `AI_OUTPUT_SCHEMA_V1.md`, then confirm against `GEMMA4_INTEGRATION_DOCTRINE.md`

**“Can this wording appear on a public hazard surface?”**  
→ Start with `TRANSLATION_GLOSSARY_SEED.md`, then confirm against `MULTILINGUAL_TRANSLATION_DOCTRINE.md`

---

## Governance Principles Across All Four Files

These files share the following common principles:

1. **Layer A owns truth**
2. **AI never determines hazard truth**
3. **Translation must never alter hazard meaning**
4. **Disclosure is required where AI-generated context is public-facing**
5. **Fallback must always be safe and deterministic**
6. **Canonical source attribution must be preserved**
7. **Kahu Ola must not sound like an official government issuer when it is not**

---

## Minimum Implementation Rules

Any new AI or multilingual feature added to Kahu Ola must:

- reference this doctrine index
- identify which doctrine file governs the feature
- define whether output is public or internal
- define fallback behavior
- define whether glossary-lock applies
- define whether schema validation is required
- document any review gate before rollout

If a feature cannot map to these doctrine files cleanly, it is not ready for production.

---

## Repository Placement

**Primary path:** `docs/doctrine/DOCTRINE_INDEX.md`

Recommended neighboring files:

- `docs/doctrine/GEMMA4_INTEGRATION_DOCTRINE.md`
- `docs/doctrine/MULTILINGUAL_TRANSLATION_DOCTRINE.md`
- `docs/doctrine/TRANSLATION_GLOSSARY_SEED.md`
- `docs/doctrine/AI_OUTPUT_SCHEMA_V1.md`

---

## Suggested Linking Pattern

This index should be linked from:

- main doctrine or source-of-truth index
- architecture index
- operator handoff notes
- AI workflow implementation notes
- multilingual rollout notes

Suggested short label:

```text
AI / Translation Doctrine Set
```

---

## Change Management

When updating this doctrine set:

- update the relevant doctrine file first
- then update this index if the scope or file list changed
- do not add implementation details here unless they affect doctrine navigation
- do not duplicate large sections from the individual files

This file should stay concise and navigational.

---

## Current Status

As of 2026-04-07, the doctrine set covers:

- Gemma 4 integration boundaries
- multilingual translation boundaries
- glossary seed rules
- AI output schema validation

Not yet covered in this set:
- production prompt contracts
- exact Layer C validator implementation
- operator QA checklist by language
- public UI labeling spec for multilingual surfaces

Those may be added later as separate documents.

---

*Kahu Ola — Guardian of Life · kahuola.org*  
*Doctrine should be easy to find, easy to read, and hard to misapply.*
