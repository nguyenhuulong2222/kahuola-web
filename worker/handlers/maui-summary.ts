/**
 * Kahu Ola — Maui Aggregated Summary Endpoint (handler module) — REVISED
 * Phase 3 wiring. Lives in the MAIN Worker (worker/), NOT the widget Worker.
 *
 * This revision matches the REAL worker/ cache API as reported from the repo:
 *   readJsonCache<unknown[]>(env.CACHE, cacheKey("hazard", type, region))
 *   keys: hazard:<type>:<region>  (statewide region)
 *   types seen: fire, flood, storm, smoke, perimeter, fire-weather, local-hazards
 *
 * It does NOT assume a snapshot:maui key (none exists yet) and does NOT
 * assume AirNow ingestion (none exists yet). AQI is read from an OPTIONAL
 * key hazard:airquality:<region>; if absent, aqi is null — honest, never
 * fabricated (Invariant III). A separate AirNow deliverable can add that
 * key later with zero change to this handler.
 *
 * Consumed by: kahuola-widget (via widget Worker /v1/status) and
 *              generate_insights.js (via KAHUOLA_INSIGHTS_URL).
 *
 * DOCTRINE:
 *  - Layer A owns truth: numbers come only from already-validated cached
 *    hazard arrays. This handler does NOT call upstream APIs.
 *  - Maui-first: statewide arrays are filtered to a Maui bbox so the
 *    summary is genuinely Maui-scoped (not statewide-as-Maui).
 *  - Invariant II/III: missing/invalid cache -> well-formed body with nulls
 *    + freshness STALE_DROP, HTTP 200, so consumers degrade deterministically.
 *  - No PII. Caller supplies no location; region is a fixed literal.
 *
 * INTEGRATION (STEP 5 — done against the real worker/ router):
 *   import { handleMauiSummary } from './handlers/maui-summary';
 *   if (url.pathname === '/api/hazards/summary') {
 *     return handleMauiSummary(request, env);
 *   }
 * Uses worker/'s real cacheKey + readJsonCache + DEFAULT_REGION + ambient Env
 * type, so this handler cannot drift from the repo's cache conventions.
 */

import { readJsonCache, cacheKey } from '../utils/cache';
import { DEFAULT_REGION } from '../utils/constants';

/**
 * Maui island bounding box (approx). Generous enough not to clip coastal
 * detections, tight enough to exclude Oahu / Hawaii Island / Kauai.
 * lat 20.45-21.05, lon -156.75 to -155.95.
 */
const MAUI_BBOX = { minLat: 20.45, maxLat: 21.05, minLon: -156.75, maxLon: -155.95 };

interface MauiSummary {
  region: 'maui';
  generated_at: string;
  freshness: 'FRESH' | 'STALE_OK' | 'STALE_DROP';
  source_fetched_at: string | null;
  aqi: number | null;
  fire_risk: 'Low' | 'Moderate' | 'High' | '\u2014';
  air_quality: { wailuku: number | null; lahaina: number | null };
  fires: Array<{ location: string; confidence: string }>;
  weather: Record<string, unknown>;
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://kahuola.org',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Vary': 'Origin',
};

function emptySummary(freshness: MauiSummary['freshness']): MauiSummary {
  return {
    region: 'maui',
    generated_at: new Date().toISOString(),
    freshness,
    source_fetched_at: null,
    aqi: null,
    fire_risk: '\u2014',
    air_quality: { wailuku: null, lahaina: null },
    fires: [],
    weather: {},
  };
}

/** Read + Array.isArray guard around worker/'s readJsonCache. Never throws. */
async function readJsonArray(
  cache: KVNamespace,
  key: string,
): Promise<unknown[] | null> {
  const parsed = await readJsonCache<unknown>(cache, key);
  return Array.isArray(parsed) ? parsed : null; // Invariant III: drop non-arrays.
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Pull [lon, lat] from a GeoJSON-ish record without throwing. */
function coordsOf(rec: Record<string, unknown>): [number, number] | null {
  const g = rec['geometry'];
  if (g && typeof g === 'object') {
    const c = (g as Record<string, unknown>)['coordinates'];
    if (Array.isArray(c) && c.length >= 2) {
      const lon = num(c[0]);
      const lat = num(c[1]);
      if (lon != null && lat != null) return [lon, lat];
    }
  }
  const lat = num(rec['lat'] ?? rec['latitude']);
  const lon = num(rec['lon'] ?? rec['lng'] ?? rec['longitude']);
  if (lat != null && lon != null) return [lon, lat];
  return null;
}

function inMaui(rec: Record<string, unknown>): boolean {
  const c = coordsOf(rec);
  if (!c) return false; // no coords -> cannot claim Maui -> exclude
  const [lon, lat] = c;
  return (
    lat >= MAUI_BBOX.minLat &&
    lat <= MAUI_BBOX.maxLat &&
    lon >= MAUI_BBOX.minLon &&
    lon <= MAUI_BBOX.maxLon
  );
}

export async function handleMauiSummary(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  const region = env.REGION ?? DEFAULT_REGION;
  const out = emptySummary('FRESH');

  const fireArr = await readJsonArray(
    env.CACHE,
    cacheKey('hazard', 'fire', region),
  );
  if (fireArr == null) {
    // No fire cache at all -> cannot vouch for anything -> degrade honestly.
    return new Response(JSON.stringify(emptySummary('STALE_DROP')), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=120',
        ...CORS,
      },
    });
  }

  const mauiFires = fireArr
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .filter(inMaui);

  out.fires = mauiFires
    .map((f) => {
      const loc = f['location'] ?? f['name'] ?? f['place'];
      const conf = f['confidence'];
      return {
        location:
          typeof loc === 'string' && loc.trim()
            ? loc.trim()
            : 'Maui (detection)',
        confidence: typeof conf === 'string' ? conf : 'n/a',
      };
    })
    .slice(0, 20);

  let redFlag = false;
  const fwArr = await readJsonArray(
    env.CACHE,
    cacheKey('hazard', 'fire-weather', region),
  );
  if (fwArr) {
    redFlag = fwArr
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .filter(inMaui)
      .some((x) => {
        const s = JSON.stringify(x).toLowerCase();
        return s.includes('red flag') || x['red_flag_warning'] === true;
      });
  }
  out.fire_risk = redFlag ? 'High' : out.fires.length > 0 ? 'Moderate' : 'Low';

  // AQI: OPTIONAL key. Absent today (no AirNow ingest) -> stays null. Honest.
  const aqArr = await readJsonArray(
    env.CACHE,
    cacheKey('hazard', 'airquality', region),
  );
  if (aqArr) {
    const pick = (town: string): number | null => {
      const hit = aqArr
        .filter(
          (x): x is Record<string, unknown> => !!x && typeof x === 'object',
        )
        .find((x) => {
          const n = (x['location'] ?? x['name'] ?? '') as unknown;
          return typeof n === 'string' && n.toLowerCase().includes(town);
        });
      return hit ? num(hit['aqi'] ?? hit['value']) : null;
    };
    out.air_quality.wailuku = pick('wailuku');
    out.air_quality.lahaina = pick('lahaina');
    const vals = [out.air_quality.wailuku, out.air_quality.lahaina].filter(
      (x): x is number => x != null,
    );
    out.aqi = vals.length ? Math.max(...vals) : null;
  }

  return new Response(JSON.stringify(out), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=120',
      ...CORS,
    },
  });
}
