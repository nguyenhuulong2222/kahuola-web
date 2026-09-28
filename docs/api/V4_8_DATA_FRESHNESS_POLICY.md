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

------------------------------------------------------------------------

# 8. Fire detections (acquisition clock)

Fire detections are classified on the ACQUISITION clock — when the satellite
observed the pixel — never on fetch time. These two are different questions and
were once conflated: a detection acquired 12 hours earlier displayed as "LIVE"
two minutes after a successful poll.

FRESH        age <= 1 hour
STALE_OK     age <= 12 hours
STALE_DROP   age > 12 hours
UNKNOWN      acquisition timestamp missing or unparseable

Signal state follows: FRESH -> active, STALE_OK -> aging, STALE_DROP ->
historical, UNKNOWN -> no state.

These thresholds deliberately override the 5-15 minute window in section 3.
That window is a FETCH/CACHE interval — how often we ask upstream. Applied to
acquisition time it would mark almost every detection stale on arrival, because
FIRMS direct-broadcast latency for Hawaiʻi is 20-30 minutes.

Rolling window

The upstream FIRMS query returns whole UTC CALENDAR days, so at 00:00 UTC
(14:00 HST) every detection from the previous UTC day disappears. Kahu Ola
requests one extra calendar day and then keeps only detections inside a rolling
24 hours on the acquisition clock. Detections whose acquisition time cannot be
parsed are dropped and counted, never kept.

UI behaviour

STALE_DROP detections are shown de-emphasised and labeled with their age, and
are excluded from counts, severity, nearest-distance and alerts — see Invariant
4. They are not hidden: a resident is entitled to know that something was seen
yesterday afternoon and nothing since.
