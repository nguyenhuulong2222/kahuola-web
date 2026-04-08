# Kahu Ola — AI Output Schema v1
**Version:** 1.0  
**Status:** Final  
**Document type:** Schema Specification  
**Owner:** Long Nguyen · kahuola.org  
**Last updated:** 2026-04-07  
**Supersedes:** none (new document)

---

## Purpose

This document defines the canonical output schema for all AI-generated content produced within the Kahu Ola system.

It exists to ensure that:
- AI output is structured
- safety checks are enforceable
- source attribution is preserved
- fallback behavior is deterministic
- AI-generated context never overrides Layer A truth

This schema applies to any Layer B output that may enter Layer C for review, filtering, validation, or publication.

---

## Core Rule

> **If output does not conform to schema, it is rejected.**

No free-form AI output may be published, rendered, cached, or reused in production without passing schema validation.

---

## Scope

This schema covers AI-generated output for:

- morning briefs
- operator notes
- multilingual civic copy
- vision triage summaries
- coding review notes
- internal automation summaries
- AI-generated context cards

This schema does **not** define:
- Layer A hazard truth
- upstream payload shapes
- raw user uploads
- transport format for external APIs

---

## Schema Identifier

All valid AI output must include:

```json
{
  "schema": "kahuola_ai_output_v1"
}
```

Any other schema identifier must be rejected unless explicitly supported by a future version contract.

---

## Canonical JSON Shape

```json
{
  "schema": "kahuola_ai_output_v1",
  "generated_at": "ISO8601",
  "input_snapshot_id": "canonical snapshot identifier",
  "output_type": "morning_brief | operator_note | multilingual | triage | coding_review | automation_summary | context_card",
  "language": "en | vi | tl | ilo | ja | haw",
  "audience": "public | internal",
  "content": "text content",
  "summary_title": "optional short title",
  "sources_cited": ["NASA FIRMS", "NWS"],
  "confidence": "high | medium | low",
  "disclosure_required": true,
  "disclosure_label_appended": true,
  "forbidden_terms_passed": true,
  "glossary_terms_passed": true,
  "semantic_drift_check_passed": true,
  "fallback_required": false,
  "review_status": "auto_pass | needs_review | rejected",
  "notes": "optional internal notes"
}
```

---

## Field Definitions

### `schema`
**Type:** string  
**Required:** yes

Must equal:

```text
kahuola_ai_output_v1
```

---

### `generated_at`
**Type:** string  
**Required:** yes

Timestamp for when the AI output was created.  
Must be valid ISO 8601.

**Example:**
```text
2026-04-07T16:05:00Z
```

---

### `input_snapshot_id`
**Type:** string  
**Required:** yes

Identifier for the canonical Layer A snapshot used as input.

This must map back to a validated hazard snapshot, summary payload, or approved canonical context package.

---

### `output_type`
**Type:** enum string  
**Required:** yes

Allowed values:

- `morning_brief`
- `operator_note`
- `multilingual`
- `triage`
- `coding_review`
- `automation_summary`
- `context_card`

Unknown values must be rejected.

---

### `language`
**Type:** enum string  
**Required:** yes

Allowed values:

- `en`
- `vi`
- `tl`
- `ilo`
- `ja`
- `haw`

If a language is unsupported for the requested path, the system must fall back safely.

---

### `audience`
**Type:** enum string  
**Required:** yes

Allowed values:

- `public`
- `internal`

**Rule:**  
`public` output must pass all Layer C checks and disclosure rules.  
`internal` output may still be rejected if it violates prohibited safety boundaries.

---

### `content`
**Type:** string  
**Required:** yes

The main body text produced by Layer B.

**Rules:**
- must not be empty
- must not exceed product-specific limits for the target surface
- must not include prohibited civic directives unless explicitly allowed by canonical policy
- must preserve source meaning from the input snapshot

---

### `summary_title`
**Type:** string  
**Required:** no

Optional short label or title for cards, summaries, or operator notes.

**Rules:**
- must remain semantically aligned with `content`
- must not introduce stronger claims than the body

---

### `sources_cited`
**Type:** array of strings  
**Required:** yes

List of source labels used in the generated output.

**Rules:**
- must be a subset of the canonical source labels in the input snapshot
- must not invent or add sources
- must preserve exact source naming where glossary-locked

**Example:**
```json
["NASA FIRMS", "NWS"]
```

---

### `confidence`
**Type:** enum string  
**Required:** yes

Allowed values:

- `high`
- `medium`
- `low`

**Rule:**  
Confidence here refers to confidence in the AI-generated wording or classification task, not to hazard truth itself.

---

### `disclosure_required`
**Type:** boolean  
**Required:** yes

Indicates whether the output requires a visible AI disclosure label.

**Rule:**  
Usually `true` for public-facing dynamic content and AI-generated context.

---

### `disclosure_label_appended`
**Type:** boolean  
**Required:** yes

Indicates whether the required disclosure label has been appended or otherwise bound to the rendering path.

If `disclosure_required` is `true` and this field is `false`, the output must be rejected for public use.

---

### `forbidden_terms_passed`
**Type:** boolean  
**Required:** yes

Indicates whether the output passed the forbidden terms scanner.

If `false`, the output must be rejected.

---

### `glossary_terms_passed`
**Type:** boolean  
**Required:** yes

Indicates whether glossary-locked terms were preserved correctly.

If `false`, the output must be rejected or downgraded to review.

---

### `semantic_drift_check_passed`
**Type:** boolean  
**Required:** yes

Indicates whether the multilingual or rewritten content preserved the original meaning.

If `false`, the output must not be published.

---

### `fallback_required`
**Type:** boolean  
**Required:** yes

Signals that the output should not be shown and the system should render a deterministic fallback instead.

If `true`, UI and downstream publication logic must ignore `content` for public rendering.

---

### `review_status`
**Type:** enum string  
**Required:** yes

Allowed values:

- `auto_pass`
- `needs_review`
- `rejected`

**Rules:**
- `auto_pass` may proceed if all required checks passed
- `needs_review` must not auto-publish on public surfaces
- `rejected` must be discarded or logged only internally

---

### `notes`
**Type:** string  
**Required:** no

Optional internal metadata for operator workflows, debugging, or review context.

**Rule:**  
Must not contain personal data or raw upstream payloads.

---

## Minimum Required Fields

At minimum, every valid payload must include:

```json
{
  "schema": "kahuola_ai_output_v1",
  "generated_at": "ISO8601",
  "input_snapshot_id": "string",
  "output_type": "allowed_enum",
  "language": "allowed_enum",
  "audience": "public | internal",
  "content": "string",
  "sources_cited": ["source"],
  "confidence": "high | medium | low",
  "disclosure_required": true,
  "disclosure_label_appended": true,
  "forbidden_terms_passed": true,
  "glossary_terms_passed": true,
  "semantic_drift_check_passed": true,
  "fallback_required": false,
  "review_status": "auto_pass | needs_review | rejected"
}
```

---

## Public Output Rules

For `audience = public`, all of the following must be true:

- `forbidden_terms_passed = true`
- `glossary_terms_passed = true`
- `semantic_drift_check_passed = true`
- `fallback_required = false`
- `review_status = auto_pass`
- `sources_cited` is valid
- disclosure label is present when required

If any of the above fail, the output must not render publicly.

---

## Internal Output Rules

For `audience = internal`, the schema may allow:

- `review_status = needs_review`
- `disclosure_label_appended = false` for internal drafts only

However, internal output must still not:

- invent upstream sources
- claim official authority
- override Layer A truth
- contain prohibited safety directives as accepted fact

---

## Example Valid Payload — Morning Brief

```json
{
  "schema": "kahuola_ai_output_v1",
  "generated_at": "2026-04-07T16:05:00Z",
  "input_snapshot_id": "2026-04-07T16:00:00Z",
  "output_type": "morning_brief",
  "language": "en",
  "audience": "public",
  "content": "Maui remains under monitoring this morning. No new high-confidence fire detections were reported in the latest NASA FIRMS snapshot. Flood alerts should still be checked through NWS updates.",
  "summary_title": "Maui Morning Brief",
  "sources_cited": ["NASA FIRMS", "NWS"],
  "confidence": "medium",
  "disclosure_required": true,
  "disclosure_label_appended": true,
  "forbidden_terms_passed": true,
  "glossary_terms_passed": true,
  "semantic_drift_check_passed": true,
  "fallback_required": false,
  "review_status": "auto_pass",
  "notes": "Generated by morning brief pipeline"
}
```

---

## Example Valid Payload — Internal Operator Note

```json
{
  "schema": "kahuola_ai_output_v1",
  "generated_at": "2026-04-07T16:08:00Z",
  "input_snapshot_id": "2026-04-07T16:00:00Z",
  "output_type": "operator_note",
  "language": "en",
  "audience": "internal",
  "content": "Review recommended for Maui windward. FIRMS detections and contextual weather signals appear directionally inconsistent and may warrant operator review.",
  "sources_cited": ["NASA FIRMS", "NWS"],
  "confidence": "low",
  "disclosure_required": false,
  "disclosure_label_appended": false,
  "forbidden_terms_passed": true,
  "glossary_terms_passed": true,
  "semantic_drift_check_passed": true,
  "fallback_required": false,
  "review_status": "needs_review",
  "notes": "Internal triage only"
}
```

---

## Example Rejected Cases

### Rejected — schema mismatch
```json
{
  "schema": "random_output_v7"
}
```

### Rejected — forbidden terms failed
```json
{
  "forbidden_terms_passed": false
}
```

### Rejected — public output missing disclosure
```json
{
  "audience": "public",
  "disclosure_required": true,
  "disclosure_label_appended": false
}
```

### Rejected — invented source
```json
{
  "sources_cited": ["NASA FIRMS", "OpenWeather"]
}
```

### Rejected — semantic drift
```json
{
  "semantic_drift_check_passed": false
}
```

---

## Validation Order

Layer C should validate in this order:

```text
1. schema identifier check
2. required field presence
3. enum validity
4. timestamp validity
5. source subset validation
6. forbidden terms scan
7. glossary lock validation
8. semantic drift validation
9. disclosure requirement validation
10. audience/path publication rule check
11. fallback decision
```

---

## Fallback Contract

If validation fails at any required step:

```text
AI output rejected
  → mark fallback_required = true
  → do not render invalid content
  → do not cache invalid content for public use
  → log rejection reason internally
  → render deterministic Layer A fallback if needed
```

**Principle:**  
Structured rejection is safer than ambiguous AI output.

---

## Recommended Repository Placement

**Primary path:** `docs/doctrine/AI_OUTPUT_SCHEMA_V1.md`

This file should sit next to:
- `docs/doctrine/GEMMA4_INTEGRATION_DOCTRINE.md`
- `docs/doctrine/MULTILINGUAL_TRANSLATION_DOCTRINE.md`
- `docs/doctrine/TRANSLATION_GLOSSARY_SEED.md`

---

## Alignment with Kahu Ola Doctrine

- **Invariant I:** AI output cites only canonical sources
- **Invariant II:** schema failure falls back safely
- **Invariant III:** missing structure cannot be invented
- **Invariant IV:** no PII enters or exits schema payloads
- **Invariant V:** AI-generated content never impersonates official hazard authority

---

*Kahu Ola — Guardian of Life · kahuola.org*  
*If output does not conform to schema, it is rejected.*
