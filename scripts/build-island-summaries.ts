import { cacheKey, writeJsonCache } from "../worker/utils/cache";
import { nowIso } from "../worker/utils/time";

interface IslandSummaryEnv {
  CACHE: KVNamespace;
}

const ISLANDS = ["hawaii", "maui", "oahu", "kauai", "molokai", "lanai"] as const;

export async function buildIslandSummaries(env: IslandSummaryEnv): Promise<{ ok: boolean; islands: number }> {
  for (const island of ISLANDS) {
    await writeJsonCache(
      env.CACHE,
      cacheKey("home", `island-summary-${island}`, island),
      {
        island,
        generated_at: nowIso(),
        // TODO: replace with real hazard aggregation once all pollers are active.
        hazard_state: "MONITORING",
        freshness_state: "STALE_OK",
      },
      300,
    );
  }

  return { ok: true, islands: ISLANDS.length };
}