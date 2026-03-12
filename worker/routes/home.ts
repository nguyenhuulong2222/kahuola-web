import { readJsonCache, writeJsonCache, cacheKey } from "../utils/cache";
import { selectPrimaryEvent, type PrimaryEventState } from "../services/event-priority";
import { DEFAULT_REGION, TTL } from "../utils/constants";
import { nowIso } from "../utils/time";

type MaybeFreshSignal = {
  freshness?: { state?: "FRESH" | "STALE_OK" | "STALE_DROP" };
};

interface HomeSummaryResponse {
  status: "ok";
  region: string;
  generated_at: string;
  freshness_state: "FRESH" | "STALE_OK" | "STALE_DROP";
  primary_event: PrimaryEventState;
  primary_hazard: PrimaryEventState;
  fire_count: number;
  flood_count: number;
  storm_count: number;
  degraded: boolean;
  stale_labeled: boolean;
  source: string;
  sources: Array<{ name: string; count: number }>;
  actions: Array<{ id: string; label: string; href: string }>;
}

function summarizeFreshness(groups: MaybeFreshSignal[][]): "FRESH" | "STALE_OK" | "STALE_DROP" {
  const states = groups
    .flat()
    .map((s) => s.freshness?.state)
    .filter(Boolean) as Array<"FRESH" | "STALE_OK" | "STALE_DROP">;

  if (states.length === 0) return "STALE_DROP";
  if (states.includes("FRESH")) return "FRESH";
  if (states.includes("STALE_OK")) return "STALE_OK";
  return "STALE_DROP";
}

export async function handleHome(_request: Request, env: Env): Promise<Response> {
  const region = env.REGION ?? DEFAULT_REGION;

  const fireSignals =
    (await readJsonCache<MaybeFreshSignal[]>(
      env.CACHE,
      cacheKey("hazard", "fire", region),
    )) ?? [];

  const floodSignals =
    (await readJsonCache<MaybeFreshSignal[]>(
      env.CACHE,
      cacheKey("hazard", "flood", region),
    )) ?? [];

  const stormSignals =
    (await readJsonCache<MaybeFreshSignal[]>(
      env.CACHE,
      cacheKey("hazard", "storm", region),
    )) ?? [];

  const degraded =
    fireSignals.length === 0 && floodSignals.length === 0 && stormSignals.length === 0;

  const freshness_state = summarizeFreshness([fireSignals, floodSignals, stormSignals]);
  const primary_event = selectPrimaryEvent({
    degraded,
    fireSignals: fireSignals as never[],
    floodSignals: floodSignals as never[],
    stormSignals: stormSignals as never[],
    regionScope: "statewide",
  });

  const summary: HomeSummaryResponse = {
    status: "ok",
    region,
    generated_at: nowIso(),
    freshness_state,
    primary_event,
    primary_hazard: primary_event,
    fire_count: fireSignals.length,
    flood_count: floodSignals.length,
    storm_count: stormSignals.length,
    degraded,
    stale_labeled: freshness_state !== "FRESH",
    source: "Kahu Ola Worker Aggregator",
    sources: [
      { name: "NASA FIRMS", count: fireSignals.length },
      { name: "NWS", count: floodSignals.length + stormSignals.length },
    ],
    actions: [
      { id: "view-live-map", label: "View Live Map", href: "/live-map.html" },
      { id: "official-alerts", label: "Official Alerts", href: "https://www.weather.gov/hfo/" },
    ],
  };

  await writeJsonCache(env.CACHE, cacheKey("home", "summary", region), summary, TTL.HOME_SUMMARY_SECONDS);

  return Response.json(summary, {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}