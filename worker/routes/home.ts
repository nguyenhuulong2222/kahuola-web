import { readJsonCache, writeJsonCache, cacheKey } from "../utils/cache";
import { selectPrimaryEvent } from "../services/event-priority";

interface HomeSummary {
  status: "ok";
  region: string;
  generated_at: string;
  primary_event:
    | "DEGRADED"
    | "FIRE_ACTIVE"
    | "FLOOD_WARNING"
    | "FLOOD_WATCH"
    | "STORM_ACTIVE"
    | "MONITORING";
  fire_count: number;
  flood_count: number;
  storm_count: number;
  degraded: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function handleHome(_request: Request, env: Env): Promise<Response> {
  const region = env.REGION ?? "hawaii";

  const fireSignals =
    (await readJsonCache<any[]>(env.CACHE, cacheKey("hazard", "fire", region))) ?? [];

  const floodSignals =
    (await readJsonCache<any[]>(env.CACHE, cacheKey("hazard", "flood", region))) ?? [];

  const stormSignals =
    (await readJsonCache<any[]>(env.CACHE, cacheKey("hazard", "storm", region))) ?? [];

  const degraded =
    fireSignals.length === 0 &&
    floodSignals.length === 0 &&
    stormSignals.length === 0;

  const primary_event = selectPrimaryEvent({
    degraded,
    fireSignals,
    floodSignals,
    stormSignals,
    regionScope: "statewide",
  });

  const summary: HomeSummary = {
    status: "ok",
    region,
    generated_at: nowIso(),
    primary_event,
    fire_count: fireSignals.length,
    flood_count: floodSignals.length,
    storm_count: stormSignals.length,
    degraded,
  };

  // optional cached summary snapshot
  await writeJsonCache(
    env.CACHE,
    cacheKey("home", "summary", region),
    summary,
    60,
  );

  return Response.json(summary, {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
