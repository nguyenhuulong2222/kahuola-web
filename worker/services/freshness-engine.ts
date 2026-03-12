import type { FreshnessMeta, FreshnessState } from "../models";
import { nowIso, parseDateSafe, ageSecondsFrom } from "../utils/time";

export interface FreshnessPolicy {
  fresh_seconds: number;
  stale_ok_seconds: number;
}

function validatePolicy(policy: FreshnessPolicy): FreshnessPolicy {
  if (!Number.isFinite(policy.fresh_seconds) || policy.fresh_seconds <= 0) {
    throw new Error(`Invalid fresh_seconds: ${policy.fresh_seconds}`);
  }
  if (
    !Number.isFinite(policy.stale_ok_seconds) ||
    policy.stale_ok_seconds < policy.fresh_seconds
  ) {
    throw new Error(`Invalid stale_ok_seconds: ${policy.stale_ok_seconds}`);
  }
  return {
    fresh_seconds: Math.floor(policy.fresh_seconds),
    stale_ok_seconds: Math.floor(policy.stale_ok_seconds),
  };
}

export function classifyFreshness(
  observedAtIso: string | null,
  policy: FreshnessPolicy,
  now = new Date(),
): FreshnessState {
  const safePolicy = validatePolicy(policy);
  if (!observedAtIso) return "STALE_DROP";

  const observed = parseDateSafe(observedAtIso);
  if (!observed) return "STALE_DROP";

  const ageSeconds = ageSecondsFrom(observed, now);

  if (ageSeconds <= safePolicy.fresh_seconds) return "FRESH";
  if (ageSeconds <= safePolicy.stale_ok_seconds) return "STALE_OK";
  return "STALE_DROP";
}

export function buildFreshnessMeta(
  observedAtIso: string | null,
  policy: FreshnessPolicy,
  now = new Date(),
): FreshnessMeta {
  const safePolicy = validatePolicy(policy);
  return {
    state: classifyFreshness(observedAtIso, safePolicy, now),
    generated_at: nowIso(now),
    last_checked_at: observedAtIso ?? nowIso(now),
    stale_after_seconds: safePolicy.fresh_seconds,
  };
}

export function isSignalUsable(freshness: FreshnessMeta): boolean {
  return freshness.state !== "STALE_DROP";
}