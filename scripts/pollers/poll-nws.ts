import { parseNwsAlerts } from "../../worker/parsers/nws";
import { cacheKey, writeJsonCache } from "../../worker/utils/cache";
import { DEFAULT_REGION, FRESHNESS_POLICY } from "../../worker/utils/constants";

interface PollEnv {
  CACHE: KVNamespace;
  NWS_ALERTS_ENDPOINT: string;
  REGION?: string;
}

export interface PollNwsResult {
  ok: boolean;
  floodCount: number;
  stormCount: number;
  floodDropped: number;
  stormDropped: number;
  errors: string[];
}

export async function pollNws(env: PollEnv): Promise<PollNwsResult> {
  const region = env.REGION ?? DEFAULT_REGION;

  const res = await fetch(env.NWS_ALERTS_ENDPOINT, {
    method: "GET",
    headers: {
      accept: "application/geo+json,application/json,*/*",
      "user-agent": "Kahu-Ola/4.8 (civic hazard platform)",
    },
  });

  if (!res.ok) {
    throw new Error(`NWS upstream error: ${res.status}`);
  }

  const payload = await res.json();
  const parsed = parseNwsAlerts(payload, region);

  // Hazard cache (for event-priority / home)
  await writeJsonCache(
    env.CACHE,
    cacheKey("hazard", "flood", region),
    parsed.floodSignals.items,
    FRESHNESS_POLICY.flood.fresh_seconds,
  );
  await writeJsonCache(
    env.CACHE,
    cacheKey("hazard", "storm", region),
    parsed.stormSignals.items,
    FRESHNESS_POLICY.storm.fresh_seconds,
  );

  // Context cache (for /v1/context routes)
  await writeJsonCache(
    env.CACHE,
    cacheKey("context", "flood", region),
    parsed.floodSignals.items,
    FRESHNESS_POLICY.flood.fresh_seconds,
  );
  await writeJsonCache(
    env.CACHE,
    cacheKey("context", "storm", region),
    parsed.stormSignals.items,
    FRESHNESS_POLICY.storm.fresh_seconds,
  );

  return {
    ok: true,
    floodCount: parsed.floodSignals.items.length,
    stormCount: parsed.stormSignals.items.length,
    floodDropped: parsed.floodSignals.dropped,
    stormDropped: parsed.stormSignals.dropped,
    errors: [...parsed.floodSignals.errors, ...parsed.stormSignals.errors],
  };
}