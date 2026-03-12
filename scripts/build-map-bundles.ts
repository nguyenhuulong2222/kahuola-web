import { cacheKey, writeJsonCache } from "../worker/utils/cache";
import { DEFAULT_REGION } from "../worker/utils/constants";
import { nowIso } from "../worker/utils/time";

interface MapBundleEnv {
  CACHE: KVNamespace;
  REGION?: string;
}

export async function buildMapBundles(env: MapBundleEnv): Promise<{ ok: boolean; region: string }> {
  const region = env.REGION ?? DEFAULT_REGION;

  const bundle = {
    generated_at: nowIso(),
    region,
    // TODO: attach canonical+context layer snapshots once pollers are complete.
    layers: [],
    freshness_state: "STALE_OK",
  };

  await writeJsonCache(env.CACHE, cacheKey("context", "map-bundle", region), bundle, 300);

  return { ok: true, region };
}