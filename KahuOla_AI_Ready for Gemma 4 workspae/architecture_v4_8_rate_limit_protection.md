<!-- SOURCE: docs/architecture/V4_8_RATE_LIMIT_PROTECTION.md -->
<!-- CATEGORY: architecture -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# V4.8 Rate Limit Protection

## Quota Safety, Retry Control, and Traffic Surge Protection

**Status:** Authoritative V4.8 Rate Limit Protection Spec\
**Audience:** Platform engineers, backend engineers, SRE, AI coding
agents

------------------------------------------------------------------------

# 1. Purpose

This document defines how Kahu Ola protects itself and upstream
providers from rate-limit failures.

The system must remain stable during:

-   major disasters
-   press coverage spikes
-   social media traffic surges
-   repeated refresh behavior
-   upstream quota constraints

Rate-limit safety is a core reliability requirement.

------------------------------------------------------------------------

# 2. Threat Model

Kahu Ola may face:

-   upstream provider quotas
-   burst traffic to homepage
-   burst traffic to live map
-   automatic client retries
-   repeated polling bugs
-   storm event traffic from all islands

Without protection, the system may: - overload upstream providers - lose
freshness - enter retry storms - degrade the public UX

------------------------------------------------------------------------

# 3. Core Protection Principles

Kahu Ola must protect rate limits through:

-   poller-time upstream access
-   cache-first serving
-   bounded retries
-   cooldown windows
-   endpoint-level backpressure
-   user-visible degraded but safe fallback

------------------------------------------------------------------------

# 4. Upstream Protection Rules

Upstream APIs must be treated as fragile shared resources.

## Required

-   scheduled polling
-   source-specific intervals
-   retry budgets
-   exponential backoff where appropriate
-   circuit breaking for repeatedly failing sources

## Forbidden

-   request-time fan-out from every page view
-   uncontrolled retries
-   retry on every client refresh
-   hammering sources during outages

------------------------------------------------------------------------

# 5. Client Protection Rules

Clients must not contribute to retry storms.

## Required

-   consume cached snapshots
-   respect degraded banners
-   avoid tight refresh loops
-   use cooldown after 429 or degraded state

## Recommended

-   disable repeated manual refresh briefly after repeated failures
-   show calm copy instead of error spam

------------------------------------------------------------------------

# 6. Polling Cadence by Source Class

Recommended starting ranges:

Fast feeds - 5--15 minutes

Medium feeds - 15--30 minutes

Slow feeds - 30--60 minutes

Polling intervals must be source-specific, not globally synchronized.

Staggered schedules are preferred to avoid burst clustering.

------------------------------------------------------------------------

# 7. Retry Policy

## Network errors

-   limited retry budget
-   jittered exponential backoff

## 429 responses

-   immediate cooldown
-   no rapid retry loop
-   preserve cached data if available

## Malformed data

-   do not retry blindly
-   log parse failure
-   wait for next scheduled poll

## Persistent source failure

-   open circuit
-   suppress repeated hits temporarily
-   surface degraded state to clients

------------------------------------------------------------------------

# 8. Cooldown Strategy

Cooldown is mandatory after repeated errors or 429 responses.

Recommended cooldown behaviors:

-   suppress repeated upstream fetches for a defined interval
-   keep serving cached or degraded-safe responses
-   expose degraded state in health metadata

Cooldown prevents self-inflicted collapse.

------------------------------------------------------------------------

# 9. Surge Protection

During major traffic spikes:

-   serve cached homepage summaries
-   serve cached island summaries
-   reduce expensive live-map recomposition
-   preserve official links
-   degrade gracefully if needed

The first goal is continuity, not perfect freshness at all costs.

------------------------------------------------------------------------

# 10. UI Behavior During Rate-Limit Stress

The UI must never panic the user.

Good copy: - Some data sources are delayed. - Showing the last available
verified snapshot. - Use official alerts for urgent decisions.

Bad copy: - Server overload - API quota exceeded - NOAA limit reached

Primary user-facing copy must remain calm and agency-neutral.

------------------------------------------------------------------------

# 11. Internal Rate Limit Metrics

The system should track:

-   requests per source per hour
-   429 counts
-   retry counts
-   cooldown activations
-   cache hit ratio
-   stale serve ratio
-   last successful fetch per source

These metrics should feed diagnostics and future optimization.

------------------------------------------------------------------------

# 12. Endpoint Backpressure

Public endpoints may apply backpressure when necessary.

Examples: - temporary cooldown on repeated refresh - downgraded map
detail - reduced diagnostics verbosity - delayed non-critical refresh
actions

Backpressure must preserve the core civic UX.

------------------------------------------------------------------------

# 13. Mobile App Considerations

Mobile clients must not attempt to outsmart rate-limit policy.

Apps should: - trust the server freshness contract - avoid self-managed
aggressive refresh loops - display degraded state honestly - preserve
official deep links when data is limited

------------------------------------------------------------------------

# 14. Forbidden Behaviors

Kahu Ola must never:

-   let every user request trigger many upstream calls
-   retry blindly after 429
-   hide rate-limit degradation
-   use panic styling for infrastructure failures
-   sacrifice stability for fake real-time behavior

------------------------------------------------------------------------

# 15. Final Requirement

All Kahu Ola implementations must include explicit rate-limit protection
before release, especially for statewide storm or wildfire traffic
conditions.
