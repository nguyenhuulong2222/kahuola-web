import type { FreshnessMeta, FreshnessState } from "../models";
import { nowIso, parseDateSafe, ageSecondsFrom } from "../utils/time";

export interface FreshnessPolicy {
  fresh_seconds: number;
  stale_ok_seconds: number;
}

export function classifyFreshness(
  observedAtIso: string | null,
  policy: FreshnessPolicy,
): FreshnessState {
  if (!observedAtIso) return "STALE_DROP";

  const observed = parseDateSafe(observedAtIso);
  if (!observed) return "STALE_DROP";

  const age = ageSecondsFrom(observed);

  if (age <= policy.fresh_seconds) return "FRESH";
  if (age <= policy.stale_ok_seconds) return "STALE_OK";
  return "STALE_DROP";
}

export function buildFreshnessMeta(
  observedAtIso: string | null,
  policy: FreshnessPolicy,
): FreshnessMeta {
  return {
    state: classifyFreshness(observedAtIso, policy),
    generated_at: nowIso(),
    last_checked_at: observedAtIso ?? nowIso(),
    stale_after_seconds: policy.fresh_seconds,
  };
}
