import { readJsonCache, cacheKey } from "../utils/cache";
import { DEFAULT_REGION } from "../utils/constants";
import { nowIso } from "../utils/time";

interface HazardEnvelope<T> {
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

async function readHazardArray(env: Env, region: string, type: string): Promise<unknown[]> {
  return (await readJsonCache<unknown[]>(env.CACHE, cacheKey("hazard", type, region))) ?? [];
}

function responseFor<T>(region: string, source: string, items: T[]): Response {
  const typed = items as Array<{ freshness?: { state?: string } }>;
  const body: HazardEnvelope<T> = {
    status: "ok",
    region,
    generated_at: nowIso(),
    freshness_state: freshnessFromItems(typed),
    source,
    items,
    count: items.length,
  };

  return Response.json(body, {
    headers: { "cache-control": "no-store" },
  });
}

export async function handleHazards(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const region = url.searchParams.get("region") ?? env.REGION ?? DEFAULT_REGION;

  if (url.pathname.endsWith("/hazards/fire")) {
    const items = await readHazardArray(env, region, "fire");
    return responseFor(region, "NASA FIRMS", items);
  }

  if (url.pathname.endsWith("/hazards/smoke")) {
    const items = await readHazardArray(env, region, "smoke");
    return responseFor(region, "NOAA HMS", items);
  }

  if (url.pathname.endsWith("/hazards/perimeters")) {
    const items = await readHazardArray(env, region, "perimeter");
    return responseFor(region, "WFIGS/NIFC", items);
  }

  return new Response("Not Found", { status: 404 });
}