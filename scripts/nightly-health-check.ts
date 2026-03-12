import { cacheKey, readJsonCache, writeJsonCache } from "../worker/utils/cache";
import { DEFAULT_REGION } from "../worker/utils/constants";
import { nowIso } from "../worker/utils/time";

interface HealthCheckEnv {
  CACHE: KVNamespace;
  REGION?: string;
}

export async function runNightlyHealthCheck(env: HealthCheckEnv): Promise<{ ok: boolean; status: string }> {
  const region = env.REGION ?? DEFAULT_REGION;

  const fire = await readJsonCache<unknown[]>(env.CACHE, cacheKey("hazard", "fire", region));
  const flood = await readJsonCache<unknown[]>(env.CACHE, cacheKey("hazard", "flood", region));
  const storm = await readJsonCache<unknown[]>(env.CACHE, cacheKey("hazard", "storm", region));

  const status = fire && flood && storm ? "healthy" : "degraded";

  await writeJsonCache(
    env.CACHE,
    cacheKey("system", "nightly-health", region),
    {
      generated_at: nowIso(),
      status,
      checks: {
        fire_cache: fire !== null,
        flood_cache: flood !== null,
        storm_cache: storm !== null,
      },
    },
    24 * 60 * 60,
  );

  return { ok: true, status };
}