<!-- SOURCE: docs/ux/V4_8_DEGRADED_STATE_UX_SPEC.md -->
<!-- CATEGORY: ux -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# V4.8 Degraded State UX Specification

## Behavior When Hazard Data Sources Fail

Status: Authoritative V4.8 UX Spec

------------------------------------------------------------------------

# Purpose

Kahu Ola must remain usable even when upstream data sources fail.

Failure examples: - API outage - network timeout - malformed JSON -
stale cache

The platform must **never render a blank screen**.

------------------------------------------------------------------------

# Design Rules

1.  UI must still render
2.  Show calm degraded banner
3.  Display last verified snapshot if allowed
4.  Provide official emergency links

Example banner:

⚠ Hazard data temporarily limited\
Some upstream sources are delayed. Use official alerts for urgent
decisions.
