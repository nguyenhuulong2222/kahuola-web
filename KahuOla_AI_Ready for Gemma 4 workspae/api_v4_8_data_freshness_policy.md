<!-- SOURCE: docs/api/V4_8_DATA_FRESHNESS_POLICY.md -->
<!-- CATEGORY: api -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# V4.8 Data Freshness Policy

Status: Canonical Freshness Standard for Hazard Signals

------------------------------------------------------------------------

# 1. Purpose

Hazard intelligence platforms must clearly communicate the **age and
reliability of data**.

The Freshness Policy defines how signals are classified and displayed.

------------------------------------------------------------------------

# 2. Freshness States

Every signal must belong to exactly one freshness class.

FRESH STALE_OK STALE_DROP

------------------------------------------------------------------------

# 3. FRESH

Definition

Data is recent enough to support operational awareness.

Example TTL windows

Fire hotspots: 5--15 minutes\
Weather alerts: 5--10 minutes\
Air quality: 15--30 minutes\
Fire perimeters: 30--60 minutes

UI Behavior

Display normally.

Badge example:

Updated 6 minutes ago

------------------------------------------------------------------------

# 4. STALE_OK

Definition

Data is older than ideal but still useful for situational awareness.

Example

Satellite feed delayed but last reading still meaningful.

UI Behavior

Signal remains visible but must show:

May be stale

or

Last verified 32 minutes ago

The user must never believe stale data is current.

------------------------------------------------------------------------

# 5. STALE_DROP

Definition

Data is too old to support safe interpretation.

Examples

Upstream outage lasting several hours\
Corrupted response\
Invalid schema

UI Behavior

Signal must not be used.

The interface must fall back to:

neutral state\
or last-known verified state (if policy allows)

------------------------------------------------------------------------

# 6. Freshness Decision Flow

Fetch Source

↓

Validate Schema

↓

Check Timestamp

↓

Determine Age

↓

Assign Freshness Class

↓

Write to Cache

------------------------------------------------------------------------

# 7. UI Labeling Rules

Every visible signal must show:

Source Timestamp Freshness state

Examples

Source: NASA FIRMS\
Last checked: 8 minutes ago

or

Last verified: 42 minutes ago (may be stale)

------------------------------------------------------------------------

# 8. Never Allowed

The system must never:

show stale data as fresh\
hide data age\
guess timestamps\
display signals without provenance

Transparency is mandatory for civic trust.
