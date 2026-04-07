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

const _VALID_SIGNAL_CLASS = ["satellite_detection", "derived_signal", "confirmed_observation", "official_hazard"] as const;
const _VALID_CONF = ["low", "nominal", "high"] as const;
const _VALID_FRESHNESS = ["FRESH", "STALE_OK", "STALE_DROP"] as const;
const _VALID_STATE = ["new", "active", "updating", "expired", "historical"] as const;
const _VALID_AGENCY = ["NASA_FIRMS", "NOAA_HMS", "NIFC_WFIGS", "NWS", "USGS", "PACIOOS", "KAHUOLA_DERIVED", "OTHER"] as const;

/**
 * Normalizes a raw cached fire item to FireSignalProps field names.
 * Supports both old FIRMS-style PascalCase fields and new FireSignalProps names.
 * Never drops items — always returns a usable record.
 */
function normalizeFireItem(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;

  // Coordinates: prefer new lowercase, fall back to old PascalCase
  const latitude =
    typeof r.latitude === "number" ? r.latitude :
    typeof r.Latitude === "number" ? r.Latitude : null;
  const longitude =
    typeof r.longitude === "number" ? r.longitude :
    typeof r.Longitude === "number" ? r.Longitude : null;

  // detection_confidence: prefer new field, fall back to old `confidence`
  const rawConf = (r.detection_confidence ?? r.confidence) as string | null | undefined;
  const confNorm = typeof rawConf === "string" ? rawConf.toLowerCase() : "";
  const detection_confidence = (_VALID_CONF as readonly string[]).includes(confNorm)
    ? confNorm : "nominal";

  // satellite: prefer new lowercase, fall back to old PascalCase
  const satellite =
    (typeof r.satellite === "string" && r.satellite.trim()) ? r.satellite.trim() :
    (typeof r.Satellite === "string" && r.Satellite.trim()) ? r.Satellite.trim() : "Unknown";

  // distance_to_nearest_place_miles: prefer new, fall back to old
  const distance_to_nearest_place_miles =
    typeof r.distance_to_nearest_place_miles === "number" ? r.distance_to_nearest_place_miles :
    typeof r.Distance_miles === "number" ? r.Distance_miles : null;

  // acq_datetime_utc: prefer new, fall back to old PascalCase
  const acq_datetime_utc =
    (typeof r.acq_datetime_utc === "string" && r.acq_datetime_utc.trim()) ? r.acq_datetime_utc.trim() :
    (typeof r.Acq_datetime_utc === "string" && r.Acq_datetime_utc.trim()) ? r.Acq_datetime_utc.trim() : null;

  // signal_id: preserve if present, do not generate
  const signal_id = (typeof r.signal_id === "string" && r.signal_id.trim()) ? r.signal_id.trim() : undefined;

  // New signal lifecycle fields — default to safe values if absent
  const signal_class = (_VALID_SIGNAL_CLASS as readonly string[]).includes(r.signal_class as string)
    ? r.signal_class : "satellite_detection";

  const freshness_status = (_VALID_FRESHNESS as readonly string[]).includes(r.freshness_status as string)
    ? r.freshness_status : "STALE_OK";

  const signal_state = (_VALID_STATE as readonly string[]).includes(r.signal_state as string)
    ? r.signal_state : "active";

  // Provenance: preserve existing or build sane upstream default
  const existingProv = r.provenance && typeof r.provenance === "object"
    ? r.provenance as Record<string, unknown> : null;
  const provAgency = existingProv?.source_agency;
  const provenance = existingProv && (_VALID_AGENCY as readonly string[]).includes(provAgency as string)
    ? existingProv
    : {
        source_agency: "NASA_FIRMS",
        source_agency_label: null,
        source_type: "satellite",
        source_reliability: "primary",
        processing_origin: "upstream_raw",
        upstream_ref: null,
      };

  return {
    ...r,
    latitude,
    longitude,
    detection_confidence,
    satellite,
    distance_to_nearest_place_miles,
    acq_datetime_utc,
    ...(signal_id !== undefined ? { signal_id } : {}),
    signal_class,
    freshness_status,
    signal_state,
    provenance,
  };
}

export async function handleHazards(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const region = url.searchParams.get("region") ?? env.REGION ?? DEFAULT_REGION;

  if (url.pathname.endsWith("/hazards/fire")) {
    const raw = await readHazardArray(env, region, "fire");
    const items = raw.map(normalizeFireItem);
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