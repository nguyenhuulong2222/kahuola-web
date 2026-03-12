import { readJsonCache, cacheKey } from "../utils/cache";
import { DEFAULT_REGION } from "../utils/constants";
import { nowIso } from "../utils/time";

export async function handleHealth(_request: Request, env: Env): Promise<Response> {
  const region = env.REGION ?? DEFAULT_REGION;

  const sourceHealthSummary = {
    fire_cache_available:
      (await readJsonCache<unknown[]>(env.CACHE, cacheKey("hazard", "fire", region))) !== null,
    flood_cache_available:
      (await readJsonCache<unknown[]>(env.CACHE, cacheKey("context", "flood", region))) !== null,
    storm_cache_available:
      (await readJsonCache<unknown[]>(env.CACHE, cacheKey("context", "storm", region))) !== null,
  };

  const status = Object.values(sourceHealthSummary).every(Boolean) ? "healthy" : "degraded";

  return Response.json({
    status,
    service: env.PROJECT_NAME ?? "Kahu Ola",
    version: env.PROJECT_VERSION ?? "4.8",
    environment: env.ENVIRONMENT ?? "unknown",
    generated_at: nowIso(),
    freshness: status === "healthy" ? "FRESH" : "STALE_OK",
    source_health_summary: sourceHealthSummary,
  });
}