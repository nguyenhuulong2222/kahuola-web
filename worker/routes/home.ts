import { selectPrimaryEvent } from "../services/event-priority";
import { readJsonCache } from "../utils/cache";

export async function handleHome(_request: Request, env: any): Promise<Response> {
  const fireSignals = (await readJsonCache<any[]>(env.CACHE, "hazard:fire:hawaii")) ?? [];
  const floodSignals = (await readJsonCache<any[]>(env.CACHE, "hazard:flood:hawaii")) ?? [];
  const stormSignals = (await readJsonCache<any[]>(env.CACHE, "hazard:storm:hawaii")) ?? [];

  const primary = selectPrimaryEvent({
    degraded: false,
    fireSignals,
    floodSignals,
    stormSignals,
    regionScope: "statewide",
  });

  return Response.json({
    status: "ok",
    primary_event: primary,
    fire_count: fireSignals.length,
    flood_count: floodSignals.length,
    storm_count: stormSignals.length,
  });
}
