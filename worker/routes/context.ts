import { readJsonCache, cacheKey } from "../utils/cache";
import { DEFAULT_REGION } from "../utils/constants";
import { nowIso } from "../utils/time";

interface ContextEnvelope<T> {
  status: "ok";
  region: string;
  generated_at: string;
  freshness_state: "FRESH" | "STALE_OK" | "STALE_DROP";
  source: string;
  items: T[];
  count: number;
}

function freshnessFromItems(items: Array<{ freshness?: { state?: string } }>): "FRESH" | "STALE_OK" | "STALE_DROP" {
  const states = items.map((i) => i.freshness?.state);
  if (states.includes("FRESH")) return "FRESH";
  if (states.includes("STALE_OK")) return "STALE_OK";
  return "STALE_DROP";
}

function envelope<T>(region: string, source: string, items: T[]): Response {
  const body: ContextEnvelope<T> = {
    status: "ok",
    region,
    generated_at: nowIso(),
    freshness_state: freshnessFromItems(items as Array<{ freshness?: { state?: string } }>),
    source,
    items,
    count: items.length,
  };

  return Response.json(body, {
    headers: { "cache-control": "no-store" },
  });
}

async function fromCache(env: Env, region: string, key: string): Promise<unknown[]> {
  return (await readJsonCache<unknown[]>(env.CACHE, cacheKey("context", key, region))) ?? [];
}

export async function handleContext(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const region = url.searchParams.get("region") ?? env.REGION ?? DEFAULT_REGION;

  if (url.pathname.endsWith("/context/flood")) {
    return envelope(region, "NWS/NOAA", await fromCache(env, region, "flood"));
  }

  if (url.pathname.endsWith("/context/storm")) {
    return envelope(region, "NWS/NOAA", await fromCache(env, region, "storm"));
  }

  if (url.pathname.endsWith("/context/radar")) {
    return envelope(region, "NOAA Radar", await fromCache(env, region, "radar"));
  }

  if (url.pathname.endsWith("/context/air")) {
    return envelope(region, "EPA AirNow", await fromCache(env, region, "air"));
  }

  if (url.pathname.endsWith("/context/ocean")) {
    return envelope(region, "PacIOOS", await fromCache(env, region, "ocean"));
  }

  return new Response("Not Found", { status: 404 });
}