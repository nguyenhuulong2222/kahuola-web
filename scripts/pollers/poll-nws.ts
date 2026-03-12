import { parseNwsAlerts } from "../../worker/parsers/nws";

interface PollEnv {
  CACHE: KVNamespace;
  NWS_ALERTS_ENDPOINT: string;
  REGION?: string;
}

async function writeJsonCache<T>(
  cache: KVNamespace,
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  await cache.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
}

export async function pollNws(env: PollEnv): Promise<{
  ok: boolean;
  floodCount: number;
  stormCount: number;
  floodDropped: number;
  stormDropped: number;
  errors: string[];
}> {
  const region = env.REGION ?? "hawaii";

  const res = await fetch(env.NWS_ALERTS_ENDPOINT, {
    method: "GET",
    headers: {
      "accept": "application/geo+json,application/json,*/*",
      "user-agent": "Kahu-Ola/4.8 (civic hazard platform)",
    },
  });

  if (!res.ok) {
    throw new Error(`NWS upstream error: ${res.status}`);
  }

  const payload = await res.json();
  const parsed = parseNwsAlerts(payload, region);

  await writeJsonCache(env.CACHE, `hazard:flood:${region}`, parsed.floodSignals.items, 10 * 60);
  await writeJsonCache(env.CACHE, `hazard:storm:${region}`, parsed.stormSignals.items, 10 * 60);

  return {
    ok: true,
    floodCount: parsed.floodSignals.items.length,
    stormCount: parsed.stormSignals.items.length,
    floodDropped: parsed.floodSignals.dropped,
    stormDropped: parsed.stormSignals.dropped,
    errors: [...parsed.floodSignals.errors, ...parsed.stormSignals.errors],
  };
}
