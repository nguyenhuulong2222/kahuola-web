import { cacheKey, readJsonCache, writeJsonCache } from "../worker/utils/cache";
import { DEFAULT_REGION, TTL } from "../worker/utils/constants";
import { nowIso } from "../worker/utils/time";

interface SnapshotEnv {
  CACHE: KVNamespace;
  REGION?: string;
}

export async function buildHomeSnapshot(env: SnapshotEnv): Promise<{ ok: boolean; region: string }> {
  const region = env.REGION ?? DEFAULT_REGION;

  const fire = (await readJsonCache<unknown[]>(env.CACHE, cacheKey("hazard", "fire", region))) ?? [];
  const flood = (await readJsonCache<unknown[]>(env.CACHE, cacheKey("hazard", "flood", region))) ?? [];
  const storm = (await readJsonCache<unknown[]>(env.CACHE, cacheKey("hazard", "storm", region))) ?? [];

  const snapshot = {
    generated_at: nowIso(),
    region,
    fire_count: fire.length,
    flood_count: flood.length,
    storm_count: storm.length,
  };

  await writeJsonCache(env.CACHE, cacheKey("home", "snapshot", region), snapshot, TTL.HOME_SUMMARY_SECONDS);

  return { ok: true, region };
}