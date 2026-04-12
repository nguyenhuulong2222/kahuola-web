/**
 * Kahu Ola — Worker V4.8 · Hawaiʻi Civic Hazard Intelligence
 * Routes: kahuola.org/api/*
 * Notes:
 * - All upstream calls server-side — browser never contacts NASA/NOAA/NWS directly
 * - MRMS + Rain Radar: live NEXRAD data from Iowa State Mesonet (PHMO/PHKM/PHWA/PHKI)
 * - Graceful fallback to terrain context when NEXRAD upstream unavailable
 * - Silent when dry: no false-persistence badges on clear days
 */

import { getZoneById, type ZoneDynamicState, type RiskLevel } from "./zones";
import {
  generateZoneBrief,
  generateFallbackBrief,
  type HouseholdProfile,
  type ZoneBrief,
} from "./zone-brief";
import {
  briefCacheKey,
  getCachedBrief,
  putCachedBrief,
  writeSnapshot,
  computeSnapshotDelta,
  formatDelta,
} from "./cache";
import {
  generateBrief as generateGemmaBrief,
  generateSocialPost,
  GEMMA_MODEL,
} from "./gemma";

export interface Env {
  NASA_FIRMS_MAP_KEY: string;
  AIRNOW_API_KEY?: string;
  MEDIA_BRIEF_WEBHOOK?: string;
  MEDIA_BRIEF_WEBHOOK_TOKEN?: string;
  // Phase 2 bindings (Workers AI + KV). Declared as loose types so this
  // file does not need to pull the full @cloudflare/workers-types surface
  // in — existing code in the file already works this way.
  AI: { run(model: string, input: unknown): Promise<unknown> };
  KAHUOLA_CACHE: unknown;
}

type CorsHeaders = Record<string, string>;
type JsonMap = Record<string, unknown>;
type Feature = { type: 'Feature'; geometry: any; properties: Record<string, unknown> };

type IslandCell = {
  id: string;
  island: string;
  zone: string;
  ring: [number, number][];
  terrain: 'WINDWARD' | 'LEEWARD' | 'VALLEY' | 'COASTAL' | 'UPSLOPE' | 'URBAN_LOWLAND';
  coastalExposure: 'LOW' | 'MODERATE' | 'HIGH';
  runoff: 'LOW' | 'MODERATE' | 'HIGH';
  drainage: string;
};

const ALLOWED_ORIGINS = [
  'https://kahuola.org',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
];
const FETCH_TIMEOUT = 8_000;

function corsHeaders(origin: string | null): CorsHeaders {
  const base: CorsHeaders = { Vary: 'Origin' };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    base['Access-Control-Allow-Origin'] = origin;
    base['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS';
    base['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return base;
}

function jsonResp(body: unknown, status = 200, extraHeaders: CorsHeaders = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function err(status: number, msg: string, cors: CorsHeaders): Response {
  return jsonResp({ error: msg }, status, cors);
}

function optionsResp(origin: string | null): Response {
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
  }
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

// P1-B hardening: return a cached response only if its Content-Type is JSON.
// A non-JSON or missing content-type would surface as a raw-parse failure in
// the client (triggering the red "Data format error" banner), so fall through
// to a fresh upstream fetch by returning null.
function cachedJsonResponse(
  cached: Response | undefined,
  cors: CorsHeaders,
  statusOverride?: number,
): Response | null {
  if (!cached) return null;
  const ct = (cached.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('json')) return null;
  const headers = new Headers(cached.headers);
  Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
  headers.set('Content-Type', 'application/json');
  headers.set('X-Kahuola-Cache', 'HIT');
  return new Response(cached.body, {
    status: statusOverride ?? cached.status ?? 200,
    headers,
  });
}

const SMART_HAWAII_CELLS: IslandCell[] = [
  {
    id: 'kauai-north-windward', island: 'Kauaʻi', zone: 'North Windward', terrain: 'WINDWARD', coastalExposure: 'MODERATE', runoff: 'HIGH', drainage: 'Hanalei and north shore drainages',
    ring: [[-159.75, 22.20], [-159.40, 22.23], [-159.32, 22.02], [-159.56, 21.94], [-159.78, 22.03], [-159.75, 22.20]],
  },
  {
    id: 'kauai-south-lowland', island: 'Kauaʻi', zone: 'South Coastal Lowland', terrain: 'COASTAL', coastalExposure: 'HIGH', runoff: 'MODERATE', drainage: 'Poʻipū to Līhuʻe lowlands',
    ring: [[-159.70, 21.96], [-159.42, 21.98], [-159.34, 21.84], [-159.53, 21.75], [-159.72, 21.82], [-159.70, 21.96]],
  },
  {
    id: 'oahu-windward', island: 'Oʻahu', zone: 'Koʻolau Windward', terrain: 'WINDWARD', coastalExposure: 'MODERATE', runoff: 'HIGH', drainage: 'Kāneʻohe and Koʻolau valleys',
    ring: [[-158.15, 21.59], [-157.67, 21.58], [-157.60, 21.40], [-157.78, 21.28], [-158.05, 21.33], [-158.15, 21.59]],
  },
  {
    id: 'oahu-honolulu-lowland', island: 'Oʻahu', zone: 'Honolulu Urban Lowland', terrain: 'URBAN_LOWLAND', coastalExposure: 'HIGH', runoff: 'MODERATE', drainage: 'Honolulu stormwater corridor',
    ring: [[-158.08, 21.37], [-157.70, 21.37], [-157.67, 21.22], [-157.91, 21.19], [-158.09, 21.26], [-158.08, 21.37]],
  },
  {
    id: 'molokai-east', island: 'Molokaʻi', zone: 'East Valley Slopes', terrain: 'VALLEY', coastalExposure: 'MODERATE', runoff: 'HIGH', drainage: 'East Molokaʻi stream gullies',
    ring: [[-156.98, 21.18], [-156.48, 21.19], [-156.42, 21.01], [-156.65, 20.94], [-156.95, 20.99], [-156.98, 21.18]],
  },
  {
    id: 'lanai-south', island: 'Lānaʻi', zone: 'South Slope', terrain: 'LEEWARD', coastalExposure: 'MODERATE', runoff: 'LOW', drainage: 'Lānaʻi south slope runoff',
    ring: [[-157.08, 20.88], [-156.80, 20.89], [-156.76, 20.69], [-156.97, 20.63], [-157.10, 20.75], [-157.08, 20.88]],
  },
  {
    id: 'maui-windward', island: 'Maui', zone: 'Hāna / East Windward', terrain: 'WINDWARD', coastalExposure: 'MODERATE', runoff: 'HIGH', drainage: 'Hāna and east slope drainages',
    ring: [[-156.20, 20.98], [-155.86, 20.97], [-155.78, 20.74], [-155.98, 20.61], [-156.22, 20.73], [-156.20, 20.98]],
  },
  {
    id: 'maui-central-lowland', island: 'Maui', zone: 'Central Maui Lowland', terrain: 'URBAN_LOWLAND', coastalExposure: 'HIGH', runoff: 'MODERATE', drainage: 'Kahului / Wailuku drainage plain',
    ring: [[-156.63, 20.97], [-156.28, 20.97], [-156.22, 20.74], [-156.48, 20.67], [-156.66, 20.78], [-156.63, 20.97]],
  },
  {
    id: 'maui-west-gulch', island: 'Maui', zone: 'West Maui Gulches', terrain: 'VALLEY', coastalExposure: 'MODERATE', runoff: 'HIGH', drainage: 'West Maui gulch systems',
    ring: [[-156.86, 21.03], [-156.56, 21.05], [-156.47, 20.86], [-156.62, 20.74], [-156.84, 20.82], [-156.86, 21.03]],
  },
  {
    id: 'hawaii-hilo-hamakua', island: 'Hawaiʻi Island', zone: 'Hilo / Hāmākua Windward', terrain: 'WINDWARD', coastalExposure: 'MODERATE', runoff: 'HIGH', drainage: 'Hilo urban streams and Hāmākua gulches',
    ring: [[-155.34, 20.34], [-154.86, 20.34], [-154.82, 19.98], [-155.04, 19.80], [-155.30, 19.92], [-155.34, 20.34]],
  },
  {
    id: 'hawaii-kona-leeward', island: 'Hawaiʻi Island', zone: 'Kona Leeward Slope', terrain: 'LEEWARD', coastalExposure: 'MODERATE', runoff: 'LOW', drainage: 'Kona leeward runoff corridors',
    ring: [[-156.18, 19.99], [-155.78, 19.99], [-155.70, 19.56], [-155.95, 19.42], [-156.15, 19.65], [-156.18, 19.99]],
  },
  {
    id: 'hawaii-kau-coastal', island: 'Hawaiʻi Island', zone: 'Kaʻū Coastal Plain', terrain: 'COASTAL', coastalExposure: 'HIGH', runoff: 'MODERATE', drainage: 'Kaʻū coastal drainages and low crossings',
    ring: [[-155.86, 19.54], [-155.28, 19.56], [-155.18, 19.14], [-155.55, 19.00], [-155.84, 19.16], [-155.86, 19.54]],
  },
];

function closeRing(ring: [number, number][]): [number, number][] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

function polygonFromRing(ring: [number, number][]) {
  return { type: 'Polygon', coordinates: [closeRing(ring)] };
}

function resolveRegion(url: URL): string {
  return (url.searchParams.get('region') || 'hawaii').toLowerCase();
}

function regionAllowsIsland(region: string, island: string): boolean {
  const key = region.toLowerCase();
  if (key === 'hawaii' || key === 'statewide' || key === 'all') return true;
  if (key === 'big-island') return island === 'Hawaiʻi Island';
  if (key === 'oahu') return island === 'Oʻahu';
  if (key === 'kauai') return island === 'Kauaʻi';
  if (key === 'maui') return island === 'Maui';
  if (key === 'molokai') return island === 'Molokaʻi';
  if (key === 'lanai') return island === 'Lānaʻi';
  return true;
}

function terrainWeight(terrain: IslandCell['terrain']): number {
  switch (terrain) {
    case 'WINDWARD': return 3;
    case 'VALLEY': return 3;
    case 'UPSLOPE': return 2;
    case 'URBAN_LOWLAND': return 2;
    case 'COASTAL': return 2;
    default: return 1;
  }
}

function runoffWeight(level: IslandCell['runoff']): number {
  return level === 'HIGH' ? 3 : level === 'MODERATE' ? 2 : 1;
}

function coastalWeight(level: IslandCell['coastalExposure']): number {
  return level === 'HIGH' ? 2 : level === 'MODERATE' ? 1 : 0;
}

function intensityFromScore(score: number): 'LIGHT' | 'MODERATE' | 'HEAVY' {
  if (score >= 7) return 'HEAVY';
  if (score >= 5) return 'MODERATE';
  return 'LIGHT';
}

function riskFromScore(score: number): 'LOW' | 'MODERATE' | 'ELEVATED' | 'HIGH' {
  if (score >= 8) return 'HIGH';
  if (score >= 6) return 'ELEVATED';
  if (score >= 4) return 'MODERATE';
  return 'LOW';
}

function saturationFromScore(score: number): 'LOW' | 'ELEVATED' | 'HIGH' {
  if (score >= 8) return 'HIGH';
  if (score >= 5) return 'ELEVATED';
  return 'LOW';
}

function buildHazardEnvelope(layer: string, source: string, region: string, signals: Feature[], summary: JsonMap, extra: JsonMap = {}) {
  return {
    ok: true,
    layer,
    source,
    region,
    generated_at: new Date().toISOString(),
    stale_after_seconds: 300,
    schema_version: 'v1',
    signals,
    summary,
    ...extra,
  };
}

async function fetchNwsAlerts(cors: CorsHeaders): Promise<any> {
  const nwsUrl = new URL('https://api.weather.gov/alerts/active');
  nwsUrl.searchParams.set('area', 'HI');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(nwsUrl.toString(), {
      signal: controller.signal,
      headers: {
        Accept: 'application/geo+json',
        'User-Agent': 'Kahu Ola / Maui Civic Hazard Intelligence (contact: long@kahuola.org)',
      },
    });
    if (!res.ok) return { ok: false, error: `HTTP_${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function handleFlashFlood(url: URL, cors: CorsHeaders): Promise<Response> {
  const region = resolveRegion(url);
  const upstream = await fetchNwsAlerts(cors);
  if (!upstream.ok) {
    return jsonResp(
      buildHazardEnvelope(
        'flash-flood', 'NWS', region, [],
        { status: 'unavailable', count: 0, message: 'NWS alerts endpoint temporarily unavailable. No flash flood data in this snapshot.' },
        { authority: 'official', note: 'Live NWS integration via api.weather.gov alerts endpoint.', upstream_error: upstream.error },
      ),
      200, cors,
    );
  }

  const rawFeatures = Array.isArray(upstream.data?.features) ? upstream.data.features : [];
  const signals: Feature[] = rawFeatures
    .filter((f: any) => {
      const event = String(f?.properties?.event || '').toLowerCase();
      return event.includes('flash flood warning') || event.includes('flash flood watch') || event.includes('flash flood statement');
    })
    .map((f: any, idx: number) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        id: f?.id || f?.properties?.id || `nws-flash-flood-${idx}`,
        source: 'NWS',
        event: f?.properties?.event || '',
        severity: f?.properties?.severity || '',
        urgency: f?.properties?.urgency || '',
        certainty: f?.properties?.certainty || '',
        headline: f?.properties?.headline || '',
        sent: f?.properties?.sent || '',
        onset: f?.properties?.onset || '',
        ends: f?.properties?.ends || '',
        areaDesc: f?.properties?.areaDesc || '',
        instruction: f?.properties?.instruction || '',
        response: f?.properties?.response || '',
      },
    }))
    .filter((f: Feature) => !!f.geometry);

  const warningCount = signals.filter(
    (f) => String(f.properties.event || '').toLowerCase().includes('warning')
  ).length;

  const watchCount = signals.filter(
    (f) => String(f.properties.event || '').toLowerCase().includes('watch')
  ).length;

  return jsonResp(
    buildHazardEnvelope(
      'flash-flood',
      'NWS',
      region,
      signals,
      {
        status: signals.length > 0 ? 'active' : 'none',
        count: signals.length,
        warning_count: warningCount,
        watch_count: watchCount,
        message: signals.length > 0
          ? 'Active National Weather Service flash flood polygons are available in this snapshot.'
          : 'No active National Weather Service flash flood watch or warning polygons were returned in this snapshot.',
      },
      {
        authority: 'official',
        note: 'Live NWS integration via api.weather.gov alerts endpoint.',
      },
    ),
    200,
    cors,
  );
}

function computeRadarScore(cell: IslandCell): number {
  return terrainWeight(cell.terrain) + runoffWeight(cell.runoff) + coastalWeight(cell.coastalExposure);
}

function buildRadarSignals(region: string): Feature[] {
  return SMART_HAWAII_CELLS
    .filter((cell) => regionAllowsIsland(region, cell.island))
    .map((cell) => {
      const score = computeRadarScore(cell);
      const intensity = intensityFromScore(score);
      const mmPerHr = intensity === 'HEAVY' ? 18 : intensity === 'MODERATE' ? 8 : 3;
      return {
        type: 'Feature',
        geometry: polygonFromRing(cell.ring),
        properties: {
          id: `radar-${cell.id}`,
          island: cell.island,
          zone: cell.zone,
          source: 'NOAA',
          intensity,
          mm_per_hr_est: mmPerHr,
          confidence: 'LOW',
          derived: true,
          terrain: cell.terrain,
          runoff: cell.runoff,
          coastal_exposure: cell.coastalExposure,
          note: 'Smart statewide Hawaiʻi radar context cell derived by Kahu Ola civic logic.',
        },
      };
    });
}

// Hawaii NEXRAD station IDs covered by Iowa State Mesonet
// PHMO = Molokai, PHKM = Kamuela (Big Island), PHWA = Waimea, PHKI = Kauai
const HAWAII_NEXRAD_STATIONS = ['PHMO', 'PHKM', 'PHWA', 'PHKI'];

// dBZ → intensity mapping (standard WSR-88D scale)
function dbzToIntensity(dbz: number): 'NONE' | 'LIGHT' | 'MODERATE' | 'HEAVY' | 'INTENSE' {
  if (dbz < 15) return 'NONE';
  if (dbz < 30) return 'LIGHT';
  if (dbz < 40) return 'MODERATE';
  if (dbz < 50) return 'HEAVY';
  return 'INTENSE';
}

// dBZ → estimated mm/hr (Marshall-Palmer approximation)
function dbzToMmHr(dbz: number): number {
  if (dbz <= 0) return 0;
  return Math.round(Math.pow(10, (dbz - 23.0) / 16.6) * 10) / 10;
}

async function handleRainRadar(url: URL, cors: CorsHeaders): Promise<Response> {
  const region = resolveRegion(url);
  const cacheKey = 'https://kahuola.org/cache/nexrad-hawaii-v1';
  const cache = caches.default;
  const cached = await cache.match(new Request(cacheKey));
  const cachedJson = cachedJsonResponse(cached, cors, 200);
  if (cachedJson) return cachedJson;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    // Iowa State Mesonet — current NEXRAD attributes for all US stations
    const res = await fetch('https://mesonet.agron.iastate.edu/geojson/nexrad_attr.geojson', {
      signal: controller.signal,
      headers: { 'User-Agent': 'Kahu Ola / kahuola.org', Accept: 'application/geo+json' },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Mesonet HTTP ${res.status}`);

    const data: any = await res.json();
    const rawFeatures: any[] = Array.isArray(data?.features) ? data.features : [];

    // Filter to Hawaii stations only
    const hawaiiFeatures = rawFeatures.filter((f: any) =>
      HAWAII_NEXRAD_STATIONS.includes(String(f?.properties?.nexrad || '').toUpperCase())
    );

    const now = new Date().toISOString();
    const signals: Feature[] = hawaiiFeatures
      .map((f: any) => {
        const p = f?.properties || {};
        const stationId = String(p.nexrad || '').toUpperCase();
        const dbz = typeof p.max_dbz === 'number' ? p.max_dbz : null;
        if (dbz === null) return null;
        const intensity = dbzToIntensity(dbz);
        if (intensity === 'NONE') return null; // Silent when dry — no false persistence

        const mmPerHr = dbzToMmHr(dbz);
        // Find matching island cell for geometry — use station position
        const matchingCell = SMART_HAWAII_CELLS.find((cell) => {
          if (stationId === 'PHMO') return cell.island === 'Molokaʻi';
          if (stationId === 'PHKM') return cell.island === 'Hawaiʻi Island' && cell.zone.includes('Kona');
          if (stationId === 'PHWA') return cell.island === 'Hawaiʻi Island' && cell.zone.includes('Hilo');
          if (stationId === 'PHKI') return cell.island === 'Kauaʻi';
          return false;
        });
        if (!matchingCell) return null;

        return {
          type: 'Feature',
          geometry: polygonFromRing(matchingCell.ring),
          properties: {
            id: `nexrad-${stationId.toLowerCase()}`,
            station_id: stationId,
            island: matchingCell.island,
            zone: matchingCell.zone,
            source: 'NEXRAD',
            source_provider: 'NEXRAD_LIVE',
            source_label: 'NEXRAD Live',
            intensity,
            mm_per_hr_est: mmPerHr,
            dbz,
            confidence: 'HIGH',
            derived: false,
            event_time: now,
            note: `Live NEXRAD observation from station ${stationId}. dBZ: ${dbz}.`,
          },
        };
      })
      .filter(Boolean) as Feature[];

    const heavyCount = signals.filter((f) =>
      f.properties.intensity === 'HEAVY' || f.properties.intensity === 'INTENSE'
    ).length;

    const envelope = buildHazardEnvelope(
      'rain-radar', 'NEXRAD_LIVE', region, signals,
      {
        status: signals.length ? 'detected' : 'none',
        count: signals.length,
        heavy_count: heavyCount,
        data_source: 'NEXRAD_LIVE',
        message: signals.length
          ? `Live NEXRAD rainfall detected at ${signals.length} Hawaiʻi station(s).`
          : 'No significant precipitation detected at Hawaiʻi NEXRAD stations.',
      },
      {
        authority: 'observational',
        note: 'Live NEXRAD reflectivity from Iowa State Mesonet. Hawaii stations: PHMO, PHKM, PHWA, PHKI.',
      },
    );

    const response = new Response(
      JSON.stringify({ ...envelope, stale_after_seconds: 120 }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120', 'X-Kahuola-Cache': 'MISS', ...cors } },
    );
    await cache.put(new Request(cacheKey), response.clone());
    return response;

  } catch (e: unknown) {
    // Fallback: terrain scoring clearly labeled as FALLBACK, not real data
    const msg = e instanceof Error ? e.message : 'unknown';
    const fallbackSignals = buildRadarSignals(region).map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        source_provider: 'NEXRAD_TERRAIN_FALLBACK',
        source_label: 'Terrain Context (NEXRAD unavailable)',
        confidence: 'LOW',
        note: `Live NEXRAD unavailable (${msg}). Showing terrain-based context only.`,
      },
    }));
    return jsonResp(
      buildHazardEnvelope('rain-radar', 'NEXRAD_FALLBACK', region, fallbackSignals,
        {
          status: fallbackSignals.length ? 'degraded' : 'none',
          count: fallbackSignals.length,
          data_source: 'NEXRAD_TERRAIN_FALLBACK',
          message: 'Live NEXRAD unavailable. Showing terrain-based rainfall context.',
        },
        { authority: 'contextual', note: `Fallback reason: ${msg}` },
      ),
      200, cors,
    );
  }
}

async function handleLocalHazards(url: URL, cors: CorsHeaders): Promise<Response> {
  const region = resolveRegion(url);
  const upstreamUrl = new URL('https://mesonet.agron.iastate.edu/geojson/lsr.php');
  upstreamUrl.searchParams.set('wfo', 'HFO');

  const cacheKey = `https://mesonet.agron.iastate.edu/geojson/lsr.php?wfo=HFO`;
  const cache = caches.default;
  const cacheReq = new Request(cacheKey);
  const cached = await cache.match(cacheReq);

  const cachedJson = cachedJsonResponse(cached, cors);
  if (cachedJson) return cachedJson;

  let raw: any;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const res = await fetch(upstreamUrl.toString(), {
      signal: controller.signal,
      headers: {
        Accept: 'application/geo+json, application/json;q=0.9, */*;q=0.8',
        'User-Agent': 'Kahu Ola / Hawaiʻi Civic Hazard Intelligence',
      },
    });

    clearTimeout(timer);

    if (!res.ok) {
      return err(502, `Local hazards upstream failed: HTTP_${res.status}`, cors);
    }

    raw = await res.json();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return err(504, `Local hazards fetch failed: ${msg}`, cors);
  }

  const rawFeatures = Array.isArray(raw?.features) ? raw.features : [];

  // Fail-closed parsing:
  // - only keep records with usable geometry
  // - only pass through explicit known fields
  const signals: Feature[] = rawFeatures
    .filter((f: any) => {
      const geomType = String(f?.geometry?.type || '');
      return !!f?.geometry && (
        geomType === 'Point' ||
        geomType === 'MultiPoint' ||
        geomType === 'Polygon' ||
        geomType === 'MultiPolygon' ||
        geomType === 'LineString' ||
        geomType === 'MultiLineString'
      );
    })
    .map((f: any, idx: number) => {
      const p = f?.properties || {};
      return {
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          id: p?.id || f?.id || `local-hazard-${idx}`,
          source: 'NWS Honolulu / IEM',
          source_label: 'NWS Local Storm Reports',
          report_type: p?.typetext || 'REPORT',
          typetext: p?.typetext || 'REPORT',
          remark: p?.remark || '',
          city: p?.city || '',
          county: p?.county || '',
          state: p?.state || '',
          magnitude: p?.magnitude ?? null,
          unit: p?.unit || '',
          valid: p?.valid || '',
          utcvalid: p?.utcvalid || '',
          wfo: p?.wfo || 'HFO',
          note: 'Official local storm report distributed through Iowa State Mesonet for NWS Honolulu.',
        },
      };
    });

  const envelope = buildHazardEnvelope(
    'local-hazards',
    'NWS Honolulu / IEM',
    region,
    signals,
    {
      status: signals.length > 0 ? 'detected' : 'none',
      count: signals.length,
      message: signals.length > 0
        ? 'Recent NWS Honolulu local storm reports are available in this snapshot.'
        : 'No recent NWS Honolulu local storm reports were returned in this snapshot.',
    },
    {
      authority: 'official-report',
      note: 'Source: Iowa State Mesonet GeoJSON relay for NWS Honolulu local storm reports.',
    },
  );

  const response = new Response(
    JSON.stringify({ ...envelope, stale_after_seconds: 600 }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'X-Kahuola-Cache': 'MISS',
        ...cors,
      },
    },
  );

  await cache.put(cacheReq, response.clone());
  return response;
}


async function handleMrmsQpe(url: URL, cors: CorsHeaders): Promise<Response> {
  const region = resolveRegion(url);
  const cacheKey = 'https://kahuola.org/cache/mrms-hawaii-v1';
  const cache = caches.default;
  const cached = await cache.match(new Request(cacheKey));
  const cachedJson = cachedJsonResponse(cached, cors, 200);
  if (cachedJson) return cachedJson;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    // Iowa State Mesonet — NEXRAD attributes (same source, used as QPE proxy for Hawaii)
    // NEXRAD max_dbz per station → per-cell QPE estimate
    const res = await fetch('https://mesonet.agron.iastate.edu/geojson/nexrad_attr.geojson', {
      signal: controller.signal,
      headers: { 'User-Agent': 'Kahu Ola / kahuola.org', Accept: 'application/geo+json' },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Mesonet HTTP ${res.status}`);

    const data: any = await res.json();
    const rawFeatures: any[] = Array.isArray(data?.features) ? data.features : [];
    const now = new Date().toISOString();

    // Build a station → dbz lookup for Hawaii stations
    const stationDbz: Record<string, number> = {};
    rawFeatures.forEach((f: any) => {
      const sid = String(f?.properties?.nexrad || '').toUpperCase();
      if (HAWAII_NEXRAD_STATIONS.includes(sid) && typeof f?.properties?.max_dbz === 'number') {
        stationDbz[sid] = f.properties.max_dbz;
      }
    });

    // Map each island cell to the best nearby NEXRAD station
    const stationForCell = (cell: IslandCell): string | null => {
      if (cell.island === 'Molokaʻi' || cell.island === 'Lānaʻi') return 'PHMO';
      if (cell.island === 'Maui') return 'PHMO';
      if (cell.island === 'Kauaʻi') return 'PHKI';
      if (cell.island === 'Oʻahu') return 'PHKI';
      if (cell.island === 'Hawaiʻi Island') {
        return cell.zone.includes('Hilo') || cell.zone.includes('Hāmākua') ? 'PHWA' : 'PHKM';
      }
      return null;
    };

    const signals: Feature[] = SMART_HAWAII_CELLS
      .filter((cell) => regionAllowsIsland(region, cell.island))
      .map((cell) => {
        const sid = stationForCell(cell);
        const dbz = sid ? (stationDbz[sid] ?? null) : null;

        // No data for this cell's station → skip (silent when unknown)
        if (dbz === null) return null;

        const intensity = dbzToIntensity(dbz);
        // Only surface LIGHT+ cells — silent when dry
        if (intensity === 'NONE') return null;

        const qpeMm = dbzToMmHr(dbz);
        const qpeIn = Math.round(qpeMm / 25.4 * 100) / 100;

        // Severity mapping consistent with rest of system
        const severity =
          intensity === 'INTENSE' ? 'HIGH' :
            intensity === 'HEAVY' ? 'HIGH' :
              intensity === 'MODERATE' ? 'ELEVATED' : 'LOW';

        return {
          type: 'Feature',
          geometry: polygonFromRing(cell.ring),
          properties: {
            id: `mrms-${cell.id}`,
            source: 'NEXRAD_MRMS',
            source_provider: 'NEXRAD_MRMS',
            source_label: 'NEXRAD QPE',
            island: cell.island,
            zone: cell.zone,
            station_id: sid,
            band: '1H',
            qpe_mm: qpeMm,
            qpe_in: qpeIn,
            dbz,
            intensity,
            risk_index: severity,
            severity,
            event_time: now,
            fetched_at: now,
            note: `Live NEXRAD-derived QPE from station ${sid}. dBZ: ${dbz}. Intensity: ${intensity}.`,
          },
        };
      })
      .filter(Boolean) as Feature[];

    const heavyCount = signals.filter((f) =>
      f.properties.severity === 'HIGH'
    ).length;

    const envelope = buildHazardEnvelope(
      'mrms-rain', 'NEXRAD_MRMS', region, signals,
      {
        status: signals.length ? 'detected' : 'none',
        count: signals.length,
        heavy_count: heavyCount,
        radar_flood_trigger: heavyCount > 0,
        data_source: 'NEXRAD_LIVE',
        message: signals.length
          ? `NEXRAD QPE: rainfall detected across ${signals.length} Hawaiʻi zone(s).`
          : 'No significant rainfall detected at Hawaiʻi NEXRAD stations.',
      },
      {
        authority: 'observational',
        note: 'NEXRAD-derived QPE proxy. Advisory only — not official NOAA MRMS product.',
      },
    );

    const response = new Response(
      JSON.stringify({ ...envelope, stale_after_seconds: 120 }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120', 'X-Kahuola-Cache': 'MISS', ...cors } },
    );
    await cache.put(new Request(cacheKey), response.clone());
    return response;

  } catch (e: unknown) {
    // Fallback: terrain context clearly labeled, NOT passing as real QPE
    const msg = e instanceof Error ? e.message : 'unknown';
    return jsonResp(
      buildHazardEnvelope('mrms-rain', 'TERRAIN_FALLBACK', region, [],
        {
          status: 'unavailable',
          count: 0,
          data_source: 'UNAVAILABLE',
          message: 'NEXRAD QPE data temporarily unavailable.',
        },
        { authority: 'contextual', note: `Upstream unavailable: ${msg}` },
      ),
      200, cors,
    );
  }
}


function buildFloodContextSignals(region: string, officialSignals: Feature[]): Feature[] {
  const officialMultiplier = officialSignals.length > 0 ? 3 : 0;
  return SMART_HAWAII_CELLS
    .filter((cell) => regionAllowsIsland(region, cell.island))
    .map((cell) => {
      const score = computeRadarScore(cell) + officialMultiplier;
      const risk = riskFromScore(score);
      const saturation = saturationFromScore(score);
      return {
        type: 'Feature',
        geometry: polygonFromRing(cell.ring),
        properties: {
          id: `context-${cell.id}`,
          island: cell.island,
          zone: cell.zone,
          source: 'NWS + Kahu Ola Terrain',
          risk_index: risk,
          watershed_saturation: saturation,
          stream_context: cell.drainage,
          terrain: cell.terrain,
          runoff: cell.runoff,
          coastal_exposure: cell.coastalExposure,
          derived: true,
          note: officialSignals.length > 0
            ? 'Context score elevated because official NWS flash-flood geometry is active somewhere in Hawaiʻi.'
            : 'Estimated local flood context from island terrain, runoff, and coastal exposure logic.',
        },
      };
    });
}

async function handleFloodContext(url: URL, cors: CorsHeaders): Promise<Response> {
  const region = resolveRegion(url);
  const upstream = await fetchNwsAlerts(cors);
  const officialSignals: Feature[] = upstream.ok
    ? (Array.isArray(upstream.data?.features) ? upstream.data.features : [])
      .filter((f: any) => {
        const event = String(f?.properties?.event || '').toLowerCase();
        return event.includes('flash flood warning') || event.includes('flash flood watch') || event.includes('flash flood statement');
      })
      .map((f: any, idx: number) => ({
        type: 'Feature',
        geometry: f.geometry,
        properties: { id: f?.id || `nws-context-${idx}` },
      }))
      .filter((f: Feature) => !!f.geometry)
    : [];

  const signals = buildFloodContextSignals(region, officialSignals);
  const highCount = signals.filter((f) => f.properties.risk_index === 'HIGH').length;
  const elevatedCount = signals.filter((f) => f.properties.risk_index === 'ELEVATED').length;

  const envelope = buildHazardEnvelope(
    'flood-context',
    'NWS + Kahu Ola Terrain',
    region,
    signals,
    {
      status: signals.length ? 'detected' : 'none',
      count: signals.length,
      high_count: highCount,
      elevated_count: elevatedCount,
      message: signals.length
        ? 'Smart statewide Hawaiʻi flood context is available in civic mode.'
        : 'No flood context cells were returned in this snapshot.',
    },
    {
      authority: 'contextual',
      note: 'Flood context is derived from island terrain, runoff, coastal exposure, and official NWS state alert presence when available.',
    },
  );
  // Override stale_after_seconds to match signal TTL (1800s = 30 min)
  return jsonResp({ ...envelope, stale_after_seconds: 1800 }, 200, cors);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // P1-B hardening: a single outer try/catch guarantees the Worker never
    // emits a Cloudflare HTML error page (1101 / 522 / 524). Any unhandled
    // exception becomes a valid JSON envelope so the client parser never
    // throws PARSE_ERROR and the red "Data format error" banner can't fire.
    let cors: CorsHeaders = { Vary: 'Origin' };
    try {
      const url = new URL(request.url);
      const origin = request.headers.get('Origin');
      cors = corsHeaders(origin);
      const path = url.pathname;

      if (request.method === 'OPTIONS') return optionsResp(origin);

      // POST /api/brief — n8n server-to-server content generation.
      // Carved out BEFORE the GET/HEAD guard because n8n is a backend
      // caller, not a browser. Auth is via MEDIA_BRIEF_WEBHOOK_TOKEN
      // bearer header; origin check is skipped because n8n will not send
      // an Origin header on server-initiated requests.
      if (request.method === 'POST' && path === '/api/brief') {
        return handleBriefPost(request, env, cors);
      }

      if (!['GET', 'HEAD'].includes(request.method)) return err(405, 'Method not allowed', cors);
      if (origin && !ALLOWED_ORIGINS.includes(origin)) return err(403, 'Forbidden', cors);

      if (path === '/api/tiles/health' || path === '/api/health') return handleHealth(env, cors);
      if (path === '/api/hazards/flash-flood' || path === '/hazards/flash-flood') return handleFlashFlood(url, cors);
      if (path === '/api/hazards/flood-context' || path === '/hazards/flood-context') return handleFloodContext(url, cors);
      if (path === '/api/hazards/rain-radar' || path === '/hazards/rain-radar') return handleRainRadar(url, cors);
      if (path === '/api/hazards/mrms-qpe' || path === '/hazards/mrms-qpe') return handleMrmsQpe(url, cors);
      if (path === '/api/hazards/landslide' || path === '/hazards/landslide') return handleLandslide(url, cors);
      if (path === '/api/hazards/smoke' || path === '/hazards/smoke') return handleSmoke(url, cors);
      if (path === '/api/hazards/perimeters' || path === '/hazards/perimeters') return handlePerimeters(url, cors);
      if (path === '/api/media/morning-brief' || path === '/media/morning-brief') return handleMorningBrief(url, env, cors);
      if (path === '/api/media/push-now' || path === '/media/push-now') return handlePushNow(url, env, cors);
      if (path === '/api/hazards/local-hazards' || path === '/hazards/local-hazards') return handleLocalHazards(url, cors);
      if (path === '/api/firms/hotspots') return handleFirmsHotspots(url, env, cors);

      const wmsMatch = path.match(/^\/api\/tiles\/wms\/([a-z_]+)$/);
      if (wmsMatch) return handleWms(wmsMatch[1], url, env, cors);

      const xyzMatch = path.match(/^\/api\/tiles\/xyz\/airnow\/(\d+)\/(\d+)\/(\d+)\.png$/);
      if (xyzMatch) return handleAirnowXyz(xyzMatch[1], xyzMatch[2], xyzMatch[3], env, cors);

      // Support both:
      //   /api/tiles/radar/{z}/{x}/{y}
      //   /api/tiles/radar/{z}/{x}/{y}.png
      const radarTileMatch = path.match(/^\/api\/tiles\/radar\/(\d+)\/(\d+)\/(\d+)(?:\.png)?$/);
      if (radarTileMatch) return handleRadarTile(radarTileMatch[1], radarTileMatch[2], radarTileMatch[3], cors);

      const geoMatch = path.match(/^\/api\/tiles\/geojson\/([a-z_-]+)$/);
      if (geoMatch) return handleGeojson(geoMatch[1], cors);

      // fire-weather context (NWS + RAWS derived)
      if (path === '/api/hazards/fire-weather' || path === '/hazards/fire-weather')
        return handleFireWeather(url, cors);

      // Tsunami alerts — NWS Tsunami Warning Center
      if (path === '/api/hazards/tsunami' || path === '/hazards/tsunami')
        return handleTsunami(cors);

      // Hurricane tracks — NHC active storms
      if (path === '/api/hazards/hurricane' || path === '/hazards/hurricane')
        return handleHurricane(cors);

      // Zone brief — static zone profile + live NWS alerts → template,
      // upgraded to Gemma 4 reasoning when the AI binding is available.
      // Template fallback stays the primary safety net.
      const zoneMatch = path.match(/^\/api\/hazards\/zone\/([a-z0-9_]+)$/);
      if (zoneMatch) return handleZoneBrief(zoneMatch[1], url, env, cors);

      return err(404, 'Not found', cors);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'unknown';
      console.error('Unhandled worker exception:', msg);
      return jsonResp(
        {
          ok: false,
          error: 'worker_internal',
          message: 'Worker encountered an unexpected error. Data temporarily unavailable.',
          detail: msg,
          generated_at: new Date().toISOString(),
        },
        200, // Invariant II: never break the UI with a 5xx/HTML page
        cors,
      );
    }
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Chạy mỗi 6AM HST — build brief và push to Apps Script
    const url = new URL('https://kahuola.org/api/media/push-now');
    const cors: CorsHeaders = {};
    try {
      const brief = await buildMorningBrief(url, env, cors);
      await postBriefToWebhook(brief, env);
    } catch (e) {
      // Fail silently — cron never crashes Worker
    }
  },
};

function handleHealth(env: Env, cors: CorsHeaders): Response {
  return jsonResp({
    status: 'ok',
    generated_at: new Date().toISOString(),
    upstreams: {
      firms: !!env.NASA_FIRMS_MAP_KEY,
      hms: true,
      smoke: true,
      perimeters: true,
      goes: true,
      pacioos: true,
      airnow: !!env.AIRNOW_API_KEY,
      wfigs: true,
      nws: true,
    },
  }, 200, cors);
}

type BriefStatus = 'ACTIVE' | 'MONITORING' | 'UNAVAILABLE' | 'TIMEOUT';

type MorningBrief = {
  schema_version: 'v1';
  generated_at: string;
  region: 'hawaii';
  timezone: 'Pacific/Honolulu';
  summary: {
    headline: string;
    civic_note: string;
  };
  wildfire: {
    status: BriefStatus;
    detections: number;
    nearest_km: number | null;
    note: string;
    source: string;
  };
  flood: {
    status: BriefStatus;
    active_watch: boolean;
    active_warning: boolean;
    note: string;
    source: string;
  };
  rainfall: {
    status: BriefStatus;
    radar_active: boolean;
    max_rate_mmhr: number | null;
    note: string;
    source: string;
  };
  tsunami: {
    status: BriefStatus;
    active: boolean;
    note: string;
    source: string;
  };
  hurricane: {
    status: BriefStatus;
    active: boolean;
    storms_tracked: number;
    note: string;
    source: string;
  };
  landslide: {
    status: BriefStatus;
    elevated: boolean;
    note: string;
    source: string;
  };
  disclaimer: string;
};

function asBool(v: unknown): boolean {
  return !!v;
}

function asNumberOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function inferBriefStatusFromSettled<T>(
  settled: PromiseSettledResult<T>,
  hasActiveSignal: boolean
): BriefStatus {
  if (settled.status === 'rejected') {
    const msg = settled.reason instanceof Error ? settled.reason.message : String(settled.reason || '');
    if (/abort|timeout/i.test(msg)) return 'TIMEOUT';
    return 'UNAVAILABLE';
  }
  return hasActiveSignal ? 'ACTIVE' : 'MONITORING';
}

async function fetchJsonSafe(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Kahu Ola / kahuola.org' }
    });
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── buildMorningBrief — direct handler calls, no self-loopback HTTP ──────
// Root cause fix: Cloudflare Workers cannot reliably self-fetch their own
// route via https://kahuola.org/api/*. All handler functions are called
// directly and their Response bodies are parsed in-process.
async function buildMorningBrief(url: URL, env: Env, cors: CorsHeaders): Promise<MorningBrief> {
  const regionUrl = new URL(url.toString());
  regionUrl.searchParams.set('region', 'hawaii');

  const [
    fireJson,
    floodJson,
    rainJson,
    tsunamiJson,
    hurricaneJson,
    landslideJson
  ] = await Promise.allSettled([
    handleFirmsHotspots(
      new URL('https://kahuola.org/api/firms/hotspots?bbox=-161.2,18.5,-154.5,22.5&days=1&limit=200'),
      env, cors
    ).then(r => r.json()),
    handleFlashFlood(regionUrl, cors).then(r => r.json()),
    handleRainRadar(regionUrl, cors).then(r => r.json()),
    handleTsunami(cors).then(r => r.json()),
    handleHurricane(cors).then(r => r.json()),
    handleLandslide(regionUrl, cors).then(r => r.json()),
  ]);

  const fire = fireJson.status === 'fulfilled' ? fireJson.value : null;
  const flood = floodJson.status === 'fulfilled' ? floodJson.value : null;
  const rain = rainJson.status === 'fulfilled' ? rainJson.value : null;
  const tsunami = tsunamiJson.status === 'fulfilled' ? tsunamiJson.value : null;
  const hurricane = hurricaneJson.status === 'fulfilled' ? hurricaneJson.value : null;
  const landslide = landslideJson.status === 'fulfilled' ? landslideJson.value : null;

  const wildfireDetections = Array.isArray(fire?.features) ? fire.features.length : 0;
  const tsunamiSignals = Array.isArray(tsunami?.signals) ? tsunami.signals.length : 0;
  const hurricaneSignals = Array.isArray(hurricane?.signals) ? hurricane.signals.length : 0;
  const landslideSignals = Array.isArray(landslide?.signals) ? landslide.signals.length : 0;
  const rainSignals = Array.isArray(rain?.signals) ? rain.signals.length : 0;

  const floodWarningCount = Number(flood?.summary?.warning_count || 0);
  const floodWatchCount = Number(flood?.summary?.watch_count || 0);
  const floodActive = floodWarningCount > 0 || floodWatchCount > 0;

  const headline =
    wildfireDetections > 0
      ? 'Wildfire detections are present in the current Hawaiʻi snapshot.'
      : floodWarningCount > 0
        ? 'Flood warning conditions are active in parts of Hawaiʻi.'
        : 'No statewide primary hazard escalation is active in the current snapshot.';

  return {
    schema_version: 'v1',
    generated_at: new Date().toISOString(),
    region: 'hawaii',
    timezone: 'Pacific/Honolulu',
    summary: {
      headline,
      civic_note: 'Use this brief for situational awareness only.'
    },
    wildfire: {
      status: inferBriefStatusFromSettled(fireJson, wildfireDetections > 0),
      detections: wildfireDetections,
      nearest_km: asNumberOrNull(fire?.properties?.nearest_km),
      note:
        fireJson.status === 'rejected'
          ? 'Wildfire source could not be verified right now.'
          : wildfireDetections > 0
            ? `${wildfireDetections} wildfire detections are present in the current snapshot.`
            : 'No wildfire detections were returned in the current snapshot.',
      source: 'NASA FIRMS via Kahu Ola Worker'
    },
    flood: {
      status: inferBriefStatusFromSettled(floodJson, floodActive),
      active_watch: floodWatchCount > 0,
      active_warning: floodWarningCount > 0,
      note:
        floodJson.status === 'rejected'
          ? 'Flood source could not be verified right now.'
          : flood?.summary?.message || 'No active flash flood geometry was returned in this snapshot.',
      source: 'NWS alerts + Kahu Ola flood context'
    },
    rainfall: {
      status: inferBriefStatusFromSettled(rainJson, rainSignals > 0),
      radar_active: rainSignals > 0,
      max_rate_mmhr: asNumberOrNull(rain?.summary?.max_rate_mmhr),
      note:
        rainJson.status === 'rejected'
          ? 'Rainfall radar source could not be verified right now.'
          : rain?.summary?.message || 'Rainfall radar context is currently being monitored.',
      source: 'NOAA radar context via Kahu Ola Worker'
    },
    tsunami: {
      status: inferBriefStatusFromSettled(tsunamiJson, tsunamiSignals > 0),
      active: tsunamiSignals > 0,
      note:
        tsunamiJson.status === 'rejected'
          ? 'Tsunami source could not be verified right now.'
          : tsunami?.summary?.message || 'No active tsunami alerts for Hawaiʻi right now.',
      source: 'NWS Tsunami Warning Center'
    },
    hurricane: {
      status: inferBriefStatusFromSettled(hurricaneJson, hurricaneSignals > 0),
      active: hurricaneSignals > 0,
      storms_tracked: hurricaneSignals,
      note:
        hurricaneJson.status === 'rejected'
          ? 'Hurricane source could not be verified right now.'
          : hurricane?.summary?.message || 'No active tropical cyclone hazard affecting Hawaiʻi right now.',
      source: 'NHC Pacific basin'
    },
    landslide: {
      status: inferBriefStatusFromSettled(landslideJson, landslideSignals > 0),
      elevated: landslideSignals > 0,
      note:
        landslideJson.status === 'rejected'
          ? 'Landslide source could not be verified right now.'
          : landslide?.summary?.message || 'No elevated landslide signal is active right now.',
      source: 'Terrain + rainfall context'
    },
    disclaimer:
      'This report is provided for situational awareness only. Always follow official county, state, and federal guidance.'
  };
}

async function handleMorningBrief(url: URL, env: Env, cors: CorsHeaders): Promise<Response> {
  try {
    const brief = await buildMorningBrief(url, env, cors);

    return new Response(JSON.stringify(brief), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'X-Kahuola-Route': 'morning-brief',
        ...cors,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    const degradedStatus: BriefStatus = /abort|timeout/i.test(String(msg)) ? 'TIMEOUT' : 'UNAVAILABLE';

    const degraded: MorningBrief = {
      schema_version: 'v1',
      generated_at: new Date().toISOString(),
      region: 'hawaii',
      timezone: 'Pacific/Honolulu',
      summary: {
        headline: 'Morning brief is temporarily degraded.',
        civic_note: 'Some live hazard sources could not be verified right now.',
      },
      wildfire: {
        status: degradedStatus,
        detections: 0,
        nearest_km: null,
        note: 'Wildfire source could not be verified right now.',
        source: 'NASA FIRMS via Kahu Ola Worker',
      },
      flood: {
        status: degradedStatus,
        active_watch: false,
        active_warning: false,
        note: 'Flood source could not be verified right now.',
        source: 'NWS alerts + Kahu Ola flood context',
      },
      rainfall: {
        status: degradedStatus,
        radar_active: false,
        max_rate_mmhr: null,
        note: 'Rainfall radar source could not be verified right now.',
        source: 'NOAA radar context via Kahu Ola Worker',
      },
      tsunami: {
        status: degradedStatus,
        active: false,
        note: 'Tsunami source could not be verified right now.',
        source: 'NWS Tsunami Warning Center',
      },
      hurricane: {
        status: degradedStatus,
        active: false,
        storms_tracked: 0,
        note: 'Hurricane source could not be verified right now.',
        source: 'NHC Pacific basin',
      },
      landslide: {
        status: degradedStatus,
        elevated: false,
        note: 'Landslide source could not be verified right now.',
        source: 'Terrain + rainfall context',
      },
      disclaimer:
        'This report is provided for situational awareness only. Always follow official county, state, and federal guidance.',
    };

    return new Response(JSON.stringify(degraded), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Kahuola-Route': 'morning-brief-degraded',
        ...cors,
      },
    });
  }
}

async function postBriefToWebhook(brief: MorningBrief, env: Env): Promise<void> {
  if (!env.MEDIA_BRIEF_WEBHOOK) return;

  // Apps Script reads token from e.parameter.token (URL query param)
  const webhookUrl = env.MEDIA_BRIEF_TOKEN
    ? `${env.MEDIA_BRIEF_WEBHOOK}?token=${encodeURIComponent(env.MEDIA_BRIEF_TOKEN)}`
    : env.MEDIA_BRIEF_WEBHOOK;

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(brief),
  });
}

async function handlePushNow(url: URL, env: Env, cors: CorsHeaders): Promise<Response> {
  try {
    const brief = await buildMorningBrief(url, env, cors);
    await postBriefToWebhook(brief, env);
    return jsonResp({ ok: true, pushed_at: new Date().toISOString() }, 200, cors);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return err(500, `Push now failed: ${msg}`, cors);
  }
}

function resolveFirmsBBox(url: URL): [number, number, number, number] | null {
  const bboxRaw = (url.searchParams.get('bbox') || '').trim();
  if (bboxRaw) {
    const parts = bboxRaw.split(',').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return null;
    const [west, south, east, north] = parts;
    if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
      return null;
    }
    return [west, south, east, north];
  }

  const scope = (url.searchParams.get('scope') || '').toLowerCase();
  if (scope === 'hawaii') return [-161.2, 18.5, -154.5, 22.5];
  if (scope === 'usa') return [-125.0, 24.0, -66.5, 49.5];

  return null;
}

async function handleFirmsHotspots(url: URL, env: Env, cors: CorsHeaders): Promise<Response> {
  if (!env.NASA_FIRMS_MAP_KEY) return err(503, 'NASA_FIRMS_MAP_KEY not configured', cors);

  const dataset = url.searchParams.get('dataset') || 'VIIRS_SNPP_NRT';
  const days = Math.min(10, Math.max(1, parseInt(url.searchParams.get('days') || '1', 10)));
  const limit = Math.min(5000, Math.max(1, parseInt(url.searchParams.get('limit') || '1000', 10)));

  const bbox = resolveFirmsBBox(url);
  if (!bbox) {
    return err(400, 'bbox must be WEST,SOUTH,EAST,NORTH or scope must be hawaii|usa', cors);
  }

  const [west, south, east, north] = bbox;

  const firmsUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${env.NASA_FIRMS_MAP_KEY}/${dataset}/${west},${south},${east},${north}/${days}`;
  const cacheUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/_/${dataset}/${west},${south},${east},${north}/${days}`;
  const cache = caches.default;
  const cacheReq = new Request(cacheUrl);
  const cached = await cache.match(cacheReq);
  const cachedJson = cachedJsonResponse(cached, cors);
  if (cachedJson) return cachedJson;

  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  // MODIS cross-reference for multi-satellite confirmation (VIIRS primary only)
  const modisXrefUrl = dataset === 'VIIRS_SNPP_NRT'
    ? `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${env.NASA_FIRMS_MAP_KEY}/MODIS_NRT/${west},${south},${east},${north}/${days}`
    : null;

  let csvText = '';
  let modisCsv = '';
  try {
    const [primaryRes, modisText] = await Promise.all([
      fetch(firmsUrl, { signal: controller.signal }),
      modisXrefUrl
        ? fetch(modisXrefUrl, { signal: controller.signal }).then(r => r.ok ? r.text() : '').catch(() => '')
        : Promise.resolve(''),
    ]);
    clearTimeout(timer);
    if (!primaryRes.ok) return err(502, `FIRMS upstream error: ${primaryRes.status}`, cors);
    csvText = await primaryRes.text();
    modisCsv = modisText;
  } catch (e: unknown) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : 'unknown';
    return err(504, `FIRMS fetch failed: ${msg}`, cors);
  }

  const geojson = firmsCsvToGeojson(csvText, limit, modisCsv);
  const body = {
    ...geojson,
    properties: {
      returnedRecords: geojson.features.length,
      dataset,
      days,
      bbox: { west, south, east, north },
      upstreamLatencyMs: Date.now() - t0,
      generated_at: new Date().toISOString(),
    },
  };

  const response = new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/geo+json',
      'Cache-Control': 'public, max-age=300',
      'X-Kahuola-Cache': 'MISS',
      ...cors,
    },
  });
  await cache.put(cacheReq, response.clone());
  return response;
}


function buildModisSet(modisCsv: string): Set<string> {
  if (!modisCsv) return new Set();
  const lines = modisCsv.trim().split('\n');
  if (lines.length < 2) return new Set();
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const latIdx = headers.indexOf('latitude');
  const lngIdx = headers.indexOf('longitude');
  if (latIdx < 0 || lngIdx < 0) return new Set();
  const set = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',');
    const lat = parseFloat(vals[latIdx] || '');
    const lng = parseFloat(vals[lngIdx] || '');
    if (!isNaN(lat) && !isNaN(lng)) {
      // Round to 0.1° (~11 km) for loose spatial matching between satellites
      set.add(`${Math.round(lat * 10)},${Math.round(lng * 10)}`);
    }
  }
  return set;
}

function firmsCsvToGeojson(csv: string, limit: number, modisCsv = ''): { type: string; features: unknown[] } {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return { type: 'FeatureCollection', features: [] };

  const modisSet = buildModisSet(modisCsv);
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const features: unknown[] = [];

  for (let i = 1; i < lines.length && features.length < limit; i++) {
    const vals = lines[i].split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    if (vals.length < headers.length) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] ?? ''; });

    const lat = parseFloat(row.latitude || row.lat || '');
    const lng = parseFloat(row.longitude || row.lon || row.lng || '');
    if (isNaN(lat) || isNaN(lng)) continue;

    // Night detection: acq_time is HHMM UTC, night = 2000-2359 or 0000-0559
    const acqTimeInt = parseInt((row.acq_time || '0000').padStart(4, '0'), 10);
    const is_night_detection = acqTimeInt >= 2000 || acqTimeInt < 600;

    // Multi-satellite confirmation: high confidence if MODIS also detected hotspot nearby
    const modisKey = `${Math.round(lat * 10)},${Math.round(lng * 10)}`;
    const detection_confidence = modisSet.size > 0 && modisSet.has(modisKey)
      ? 'high'
      : (row.confidence || '');

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        brightness: row.bright_ti4 || row.brightness || '',
        bright_ti4: row.bright_ti4 || '',
        bright_ti5: row.bright_ti5 || '',
        frp: row.frp || '',
        confidence: row.confidence || '',
        detection_confidence,
        is_night_detection,
        acq_date: row.acq_date || '',
        acq_time: row.acq_time || '',
        satellite: row.satellite || '',
        instrument: row.instrument || '',
        daynight: row.daynight || '',
        track: row.track || '',
        scan: row.scan || '',
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

const WMS_UPSTREAMS: Record<string, { url: string; ttl: number; keySecret?: keyof Env; keyParam?: string }> = {
  firms: { url: 'https://firms.modaps.eosdis.nasa.gov/mapserver/wms/South_America/', ttl: 300, keySecret: 'NASA_FIRMS_MAP_KEY', keyParam: 'MAP_KEY' },
  hms: { url: 'https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/', ttl: 900 },
  goes: { url: 'https://opengeo.ncep.noaa.gov/geoserver/conus/ows', ttl: 600 },
  pacioos: { url: 'https://pae-paha.pacioos.hawaii.edu/thredds/wms/dhw_5km', ttl: 3600 },
};

async function handleWms(id: string, url: URL, env: Env, cors: CorsHeaders): Promise<Response> {
  const upstream = WMS_UPSTREAMS[id];
  if (!upstream) return err(404, `Unknown WMS source: ${id}`, cors);

  const service = (url.searchParams.get('SERVICE') || '').toUpperCase();
  const request = (url.searchParams.get('REQUEST') || '').toUpperCase();

  // Bare health/probe call (no params) → forward GetCapabilities so audit returns 200
  if (!service && !request) {
    const capUrl = `${upstream.url}?SERVICE=WMS&REQUEST=GetCapabilities`;
    return proxyFetch(capUrl, capUrl, upstream.ttl, cors);
  }

  if (service !== 'WMS') return err(400, 'SERVICE=WMS required', cors);
  if (!['GETMAP', 'GETCAPABILITIES'].includes(request)) return err(400, 'REQUEST must be GetMap or GetCapabilities', cors);

  if (request === 'GETMAP') {
    const w = parseInt(url.searchParams.get('WIDTH') || '0', 10);
    const h = parseInt(url.searchParams.get('HEIGHT') || '0', 10);
    const fmt = url.searchParams.get('FORMAT') || '';
    const bbox = url.searchParams.get('BBOX') || '';
    const crs = url.searchParams.get('CRS') || url.searchParams.get('SRS') || '';
    if (w < 1 || h < 1 || w > 2048 || h > 2048) return err(400, 'WIDTH/HEIGHT must be 1–2048', cors);
    if (!['image/png', 'image/jpeg'].includes(fmt)) return err(400, 'FORMAT must be image/png or image/jpeg', cors);
    if (!bbox) return err(400, 'BBOX required', cors);
    if (!crs) return err(400, 'CRS or SRS required', cors);
  }

  if (upstream.keySecret && !env[upstream.keySecret]) return err(503, 'Service temporarily unavailable', cors);
  const cacheParams = new URLSearchParams(url.searchParams);
  const cacheUrl = `${upstream.url}?${cacheParams.toString()}`;
  const fetchParams = new URLSearchParams(url.searchParams);
  if (upstream.keySecret && upstream.keyParam) fetchParams.set(upstream.keyParam, env[upstream.keySecret]);
  const fetchUrl = `${upstream.url}?${fetchParams.toString()}`;
  return proxyFetch(fetchUrl, cacheUrl, upstream.ttl, cors);
}

async function handleAirnowXyz(z: string, x: string, y: string, env: Env, cors: CorsHeaders): Promise<Response> {
  const zi = parseInt(z, 10), xi = parseInt(x, 10), yi = parseInt(y, 10);
  if (isNaN(zi) || isNaN(xi) || isNaN(yi)) return err(400, 'z/x/y must be integers', cors);
  if (zi < 0 || zi > 18) return err(400, 'z must be 0–18', cors);

  // tiles.airnowtech.org is defunct; AQICN distributes EPA AirNow data as public XYZ tiles
  const tileUrl = `https://tiles.aqicn.org/tiles/usepa-aqi/${zi}/${xi}/${yi}.png`;
  return proxyFetch(tileUrl, tileUrl, 600, cors);
}

// Iowa Mesonet is a public NEXRAD tile aggregator (CORS *, no auth required).
// TTL 300 s — tiles update roughly every 5 minutes.
async function handleRadarXyz(z: string, x: string, y: string, cors: CorsHeaders): Promise<Response> {
  const zi = parseInt(z, 10), xi = parseInt(x, 10), yi = parseInt(y, 10);
  if (isNaN(zi) || isNaN(xi) || isNaN(yi)) return err(400, 'z/x/y must be integers', cors);
  if (zi < 0 || zi > 18) return err(400, 'z must be 0–18', cors);
  const url = `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/${zi}/${xi}/${yi}.png`;
  return proxyFetch(url, url, 300, cors);
}

const GEOJSON_UPSTREAMS: Record<string, { url: string; ttl: number }> = {
  wfigs: {
    url: 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson&resultRecordCount=500',
    ttl: 600,
  },
};

async function handleGeojson(id: string, cors: CorsHeaders): Promise<Response> {
  const upstream = GEOJSON_UPSTREAMS[id];
  if (!upstream) return err(404, `Unknown GeoJSON source: ${id}`, cors);
  return proxyFetch(upstream.url, upstream.url, upstream.ttl, cors);
}

// ── SMOKE SIGNALS — NOAA HMS Smoke Polygons ──────────────────────────────
async function handleSmoke(url: URL, cors: CorsHeaders): Promise<Response> {
  const region = resolveRegion(url);
  const cacheKey = 'https://kahuola.org/cache/smoke-hawaii-v1';
  const cache = caches.default;
  const cached = await cache.match(new Request(cacheKey));
  const cachedJson = cachedJsonResponse(cached, cors, 200);
  if (cachedJson) return cachedJson;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    // NOAA HMS smoke polygons — daily GeoJSON feed
    const res = await fetch(
      'https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/GeoJSON/hms_smoke_latest.json',
      {
        signal: controller.signal,
        headers: { 'User-Agent': 'Kahu Ola / kahuola.org', Accept: 'application/geo+json' },
      },
    );
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HMS HTTP ${res.status}`);

    const data: any = await res.json();
    const rawFeatures: any[] = Array.isArray(data?.features) ? data.features : [];
    const now = new Date().toISOString();

    // Hawaii bounding box filter: lon [-161.5, -154.5], lat [18.5, 22.8]
    const signals: Feature[] = rawFeatures
      .filter((f: any) => {
        const geomType = String(f?.geometry?.type || '');
        if (!['Polygon', 'MultiPolygon'].includes(geomType)) return false;
        // Basic bbox overlap check using first coordinate
        const coords = f.geometry.type === 'Polygon'
          ? f.geometry.coordinates[0]
          : f.geometry.coordinates[0][0];
        if (!Array.isArray(coords) || coords.length === 0) return false;
        const lons = coords.map((c: number[]) => c[0]);
        const lats = coords.map((c: number[]) => c[1]);
        const minLon = Math.min(...lons), maxLon = Math.max(...lons);
        const minLat = Math.min(...lats), maxLat = Math.max(...lats);
        return maxLon >= -161.5 && minLon <= -154.5 && maxLat >= 18.5 && minLat <= 22.8;
      })
      .map((f: any, idx: number) => {
        const p = f?.properties || {};
        const densityRaw = String(p.Density || p.density || p.smoke_density || 'Light').toLowerCase();
        const density = densityRaw.includes('heavy') ? 'heavy' :
          densityRaw.includes('medium') ? 'medium' : 'light';
        const severity = density === 'heavy' ? 'WARNING' : density === 'medium' ? 'WATCH' : 'INFO';
        return {
          type: 'Feature',
          geometry: f.geometry,
          properties: {
            id: `smoke-${idx}`,
            smoke_density: density,
            density,
            severity,
            source: 'NOAA HMS',
            source_provider: 'NOAA_HMS',
            source_label: 'NOAA HMS',
            event_time: p.Start || p.start || now,
            advisory: 'Smoke detected in area. Air quality may be reduced.',
          },
        };
      });

    const envelope = buildHazardEnvelope(
      'smoke', 'NOAA HMS', region, signals,
      {
        status: signals.length > 0 ? 'detected' : 'none',
        count: signals.length,
        message: signals.length > 0
          ? `${signals.length} smoke polygon(s) detected near Hawaiʻi.`
          : 'No significant smoke polygons detected near Hawaiʻi.',
      },
      { authority: 'observational', note: 'NOAA HMS satellite smoke detection. Advisory only.' },
    );

    const response = new Response(
      JSON.stringify({ ...envelope, stale_after_seconds: 900 }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600', 'X-Kahuola-Cache': 'MISS', ...cors } },
    );
    await cache.put(new Request(cacheKey), response.clone());
    return response;

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return jsonResp(
      buildHazardEnvelope('smoke', 'NOAA HMS', region, [],
        { status: 'unavailable', count: 0, message: 'Smoke data temporarily unavailable.' },
        { authority: 'observational', note: `Upstream unavailable: ${msg}` },
      ),
      200, cors,
    );
  }
}

// ── FIRE PERIMETERS — NIFC WFIGS ─────────────────────────────────────────
async function handlePerimeters(url: URL, cors: CorsHeaders): Promise<Response> {
  const region = resolveRegion(url);
  const cacheKey = 'https://kahuola.org/cache/perimeters-hawaii-v1';
  const cache = caches.default;
  const cached = await cache.match(new Request(cacheKey));
  const cachedJson = cachedJsonResponse(cached, cors, 200);
  if (cachedJson) return cachedJson;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    // NIFC WFIGS current incident perimeters — Hawaii bbox filter via query
    const wfigsUrl =
      'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query' +
      '?where=1%3D1&geometry=-161.5%2C18.5%2C-154.5%2C22.8&geometryType=esriGeometryEnvelope' +
      '&spatialRel=esriSpatialRelIntersects&outFields=*&f=geojson&resultRecordCount=100';

    const res = await fetch(wfigsUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Kahu Ola / kahuola.org', Accept: 'application/geo+json' },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`WFIGS HTTP ${res.status}`);

    const data: any = await res.json();
    const rawFeatures: any[] = Array.isArray(data?.features) ? data.features : [];
    const now = new Date().toISOString();

    const signals: Feature[] = rawFeatures
      .filter((f: any) => {
        const geomType = String(f?.geometry?.type || '');
        return ['Polygon', 'MultiPolygon'].includes(geomType);
      })
      .map((f: any, idx: number) => {
        const p = f?.properties || {};
        const incidentName = p.IncidentName || p.incident_name || p.INCIDENTNAME || 'Unnamed Fire';
        const acres = typeof p.GISAcres === 'number' ? Math.round(p.GISAcres) :
          typeof p.GIS_ACRES === 'number' ? Math.round(p.GIS_ACRES) : null;
        const containment = typeof p.PercentContained === 'number' ? p.PercentContained :
          typeof p.PERCENTCONTAINED === 'number' ? p.PERCENTCONTAINED : null;
        const discoveryDate = p.DiscoveryAcres || p.FireDiscoveryDateTime || p.FIREDISCOVERYDATETIME || null;
        return {
          type: 'Feature',
          geometry: f.geometry,
          properties: {
            id: f.id || `perimeter-${idx}`,
            incident_name: incidentName,
            // WFIGS data is official — from NIFC interagency perimeters
            official: true,
            acres,
            containment_pct: containment,
            status: containment === 100 ? 'contained' : 'active',
            discovery_date: discoveryDate,
            source: 'NIFC WFIGS',
            source_provider: 'NIFC',
            source_label: 'NIFC Interagency Perimeters',
            event_time: discoveryDate || now,
            note: 'Official NIFC interagency fire perimeter. Verify with county emergency management.',
          },
        };
      });

    const envelope = buildHazardEnvelope(
      'perimeters', 'NIFC WFIGS', region, signals,
      {
        status: signals.length > 0 ? 'detected' : 'none',
        count: signals.length,
        message: signals.length > 0
          ? `${signals.length} active fire perimeter(s) in Hawaiʻi.`
          : 'No active fire perimeters in Hawaiʻi.',
      },
      { authority: 'official', note: 'NIFC WFIGS interagency perimeters — official fire boundaries.' },
    );

    const response = new Response(
      JSON.stringify({ ...envelope, stale_after_seconds: 600 }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600', 'X-Kahuola-Cache': 'MISS', ...cors } },
    );
    await cache.put(new Request(cacheKey), response.clone());
    return response;

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return jsonResp(
      buildHazardEnvelope('perimeters', 'NIFC WFIGS', region, [],
        { status: 'unavailable', count: 0, message: 'Perimeter data temporarily unavailable.' },
        { authority: 'official', note: `Upstream unavailable: ${msg}` },
      ),
      200, cors,
    );
  }
}

// Fire Weather Context — NWS Red Flag + RAWS wind/humidity derived scoring
// Uses same SMART_HAWAII_CELLS terrain logic as flood context
async function handleFireWeather(url: URL, cors: CorsHeaders): Promise<Response> {
  const corsHeaders = cors;

  // NWS endpoints — no API key needed, fully public
  const NWS_RED_FLAG_URL = "https://api.weather.gov/alerts/active?area=HI&event=Red+Flag+Warning";
  const NWS_FIRE_WATCH_URL = "https://api.weather.gov/alerts/active?area=HI&event=Fire+Weather+Watch";

  const generatedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    // Fetch both Red Flag Warning and Fire Weather Watch in parallel
    const [rfResp, fwResp] = await Promise.allSettled([
      fetch(NWS_RED_FLAG_URL, { signal: controller.signal, headers: { "User-Agent": "KahuOla/1.0 kahuola.org" } }),
      fetch(NWS_FIRE_WATCH_URL, { signal: controller.signal, headers: { "User-Agent": "KahuOla/1.0 kahuola.org" } }),
    ]);
    clearTimeout(timeout);

    // Parse responses safely
    const rfAlerts: any[] = rfResp.status === "fulfilled" && rfResp.value.ok
      ? (await rfResp.value.json().catch(() => ({ features: [] }))).features ?? []
      : [];
    const fwAlerts: any[] = fwResp.status === "fulfilled" && fwResp.value.ok
      ? (await fwResp.value.json().catch(() => ({ features: [] }))).features ?? []
      : [];

    const allAlerts = [...rfAlerts, ...fwAlerts];

    // ── Build GeoJSON features from real NWS alerts ──────────
    const signals: any[] = allAlerts.map((alert: any, i: number) => {
      const props = alert.properties ?? {};
      const isRedFlag = props.event === "Red Flag Warning";
      const severity = isRedFlag ? "HIGH" : "ELEVATED";

      // NWS alerts have geometry OR affected zones
      const geometry = alert.geometry ?? {
        type: "Point",
        coordinates: [-157.8, 20.5], // Hawaii center fallback
      };

      return {
        type: "Feature",
        geometry,
        properties: {
          id: `fire-weather-nws-${i}`,
          event: props.event,
          headline: props.headline ?? props.event,
          area: props.areaDesc ?? "Hawaiʻi",
          severity: severity,
          risk_index: severity,
          red_flag_active: isRedFlag,
          source: "NWS Official",
          source_label: "NWS Official",
          official: true,
          onset: props.onset ?? generatedAt,
          expires: props.expires ?? null,
          urgency: props.urgency ?? "Unknown",
          event_time: props.sent ?? generatedAt,
          note: props.description?.substring(0, 200) ?? props.headline ?? "",
        },
      };
    });

    // ── Summary ───────────────────────────────────────────────
    const redFlagCount = signals.filter(s => s.properties.red_flag_active).length;
    const watchCount = signals.filter(s => !s.properties.red_flag_active).length;

    let status = "none";
    let message = "No active fire weather warnings for Hawaiʻi.";
    if (redFlagCount > 0) {
      status = "red_flag";
      message = `${redFlagCount} Red Flag Warning${redFlagCount > 1 ? "s" : ""} active. Extreme fire conditions — avoid outdoor burning.`;
    } else if (watchCount > 0) {
      status = "watch";
      message = `${watchCount} Fire Weather Watch${watchCount > 1 ? "es" : ""} in effect. Monitor conditions closely.`;
    }

    const payload = {
      ok: true,
      layer: "fire-weather",
      source: "NWS Official",
      region: "hawaii",
      generated_at: generatedAt,
      stale_after_seconds: 900,   // 15 min — NWS updates alerts frequently
      schema_version: "1.0",
      signals,
      summary: {
        status,
        count: signals.length,
        red_flag_count: redFlagCount,
        watch_count: watchCount,
        red_flag_active: redFlagCount > 0,
        elevated_count: signals.length,
        high_count: redFlagCount,
        message,
      },
      authority: "National Weather Service — weather.gov/alerts",
      note: "Real NWS fire weather alerts only. No signals = no active warnings.",
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
    });

  } catch (err: any) {
    clearTimeout(timeout);
    // On fetch error → return empty/degraded, never fake data
    const degraded = {
      ok: false,
      layer: "fire-weather",
      source: "NWS Official",
      generated_at: generatedAt,
      stale_after_seconds: 300,
      schema_version: "1.0",
      signals: [],
      summary: {
        status: "degraded",
        count: 0,
        red_flag_count: 0,
        watch_count: 0,
        red_flag_active: false,
        elevated_count: 0,
        high_count: 0,
        message: "Fire weather data temporarily unavailable. Check weather.gov for official alerts.",
      },
      authority: "National Weather Service — weather.gov/alerts",
      note: `NWS fetch error: ${err?.message ?? "timeout"}`,
    };
    return new Response(JSON.stringify(degraded), {
      status: 200, // Always 200 — Invariant II
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
}

// ── TSUNAMI ALERTS — NWS Tsunami Warning Center ──────────────────────
async function handleTsunami(cors: CorsHeaders): Promise<Response> {
  const now = new Date().toISOString();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    // NWS alerts filtered for tsunami events
    const res = await fetch('https://api.weather.gov/alerts/active?area=HI', {
      signal: controller.signal,
      headers: { Accept: 'application/geo+json', 'User-Agent': 'Kahu Ola / kahuola.org' }
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`NWS ${res.status}`);
    const data: any = await res.json();
    const rawFeatures = Array.isArray(data?.features) ? data.features : [];
    const signals: Feature[] = rawFeatures
      .filter((f: any) => {
        const event = String(f?.properties?.event || '').toLowerCase();
        return event.includes('tsunami') || event.includes('tidal wave');
      })
      .map((f: any, idx: number) => ({
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          id: f?.id || `tsunami-${idx}`,
          source: 'NWS Tsunami Warning Center',
          source_label: 'NWS TWC',
          event: f?.properties?.event || 'Tsunami Alert',
          severity: f?.properties?.severity || 'Extreme',
          headline: f?.properties?.headline || '',
          onset: f?.properties?.onset || now,
          ends: f?.properties?.ends || '',
          instruction: f?.properties?.instruction || 'Follow official evacuation guidance immediately.',
          risk_index: 'HIGH',
        },
      }))
      .filter((f: Feature) => !!f.geometry);

    const envelope = buildHazardEnvelope('tsunami', 'NWS Tsunami Warning Center', 'hawaii', signals,
      {
        status: signals.length > 0 ? 'active' : 'none', count: signals.length,
        message: signals.length > 0 ? 'Active tsunami alert from NWS Tsunami Warning Center.' : 'No active tsunami warnings for Hawaiʻi.',
      }, { authority: 'official', note: 'Official NWS tsunami alerts only.' });
    return jsonResp({ ...envelope, stale_after_seconds: 300 }, 200, cors);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return jsonResp(buildHazardEnvelope('tsunami', 'NWS TWC', 'hawaii', [],
      { status: 'none', count: 0, message: 'No active tsunami warnings.' },
      { authority: 'official', note: msg }
    ), 200, cors);
  }
}

// ── HURRICANE TRACKS — NHC Active Storms ──────────────────────────────
async function handleHurricane(cors: CorsHeaders): Promise<Response> {
  const now = new Date().toISOString();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    // NHC active storms GeoJSON feed
    const res = await fetch('https://www.nhc.noaa.gov/CurrentStorms.json', {
      signal: controller.signal,
      headers: { 'User-Agent': 'Kahu Ola / kahuola.org' }
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`NHC ${res.status}`);
    const data: any = await res.json();
    const storms = Array.isArray(data?.activeStorms) ? data.activeStorms : [];

    // Filter Pacific basin storms only (relevant to Hawaii)
    const pacificStorms = storms.filter((s: any) => {
      const basin = String(s?.basin || s?.id || '').toUpperCase();
      return basin.includes('CP') || basin.includes('EP') || basin.includes('CENTRAL') || basin.includes('EAST');
    });

    const signals: Feature[] = pacificStorms
      .filter((s: any) => s?.center?.lat && s?.center?.lon)
      .map((s: any, idx: number) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [parseFloat(s.center.lon), parseFloat(s.center.lat)] },
        properties: {
          id: s?.id || `hurricane-${idx}`,
          source: 'National Hurricane Center',
          source_label: 'NHC',
          name: s?.name || 'Unnamed Storm',
          classification: s?.classification || s?.type || 'Tropical System',
          wind_mph: s?.wind || null,
          movement: s?.movement || '',
          risk_index: 'HIGH',
          severity: 'HIGH',
          event_time: now,
          note: 'Active Pacific storm. Monitor NHC for official track and cone.',
        },
      }));

    const envelope = buildHazardEnvelope('hurricane', 'NHC', 'hawaii', signals,
      {
        status: signals.length > 0 ? 'active' : 'none', count: signals.length,
        message: signals.length > 0 ? `${signals.length} active Pacific storm(s) near Hawaiʻi.` : 'No active Pacific storms.',
      }, { authority: 'official', note: 'National Hurricane Center active storm data.' });
    return jsonResp({ ...envelope, stale_after_seconds: 1800 }, 200, cors);
  } catch (e: unknown) {
    return jsonResp(buildHazardEnvelope('hurricane', 'NHC', 'hawaii', [],
      { status: 'none', count: 0, message: 'No active Pacific storms.' }, {}
    ), 200, cors);
  }
}


async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  return res.json();
}

function bool(v: unknown): boolean {
  return !!v;
}

function numberOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── LANDSLIDE RISK — Terrain + Rainfall Derived ───────────────────────
async function handleLandslide(url: URL, cors: CorsHeaders): Promise<Response> {
  const region = resolveRegion(url);
  const now = new Date().toISOString();

  // Fetch NWS to check flash flood / heavy rain active (elevates landslide risk)
  const upstream = await fetchNwsAlerts(cors);
  const heavyRainActive = upstream.ok
    ? (Array.isArray(upstream.data?.features) ? upstream.data.features : [])
      .some((f: any) => {
        const event = String(f?.properties?.event || '').toLowerCase();
        return event.includes('flash flood') || event.includes('debris flow') || event.includes('landslide');
      })
    : false;

  const multiplier = heavyRainActive ? 3 : 0;

  const signals: Feature[] = SMART_HAWAII_CELLS
    .filter((cell) => regionAllowsIsland(region, cell.island))
    .map((cell) => {
      const baseScore = terrainWeight(cell.terrain) + runoffWeight(cell.runoff);
      // Landslide: windward + valley + high runoff = highest risk
      const slideScore = baseScore + multiplier +
        (cell.terrain === 'VALLEY' ? 2 : 0) +
        (cell.terrain === 'WINDWARD' ? 1 : 0);
      const risk = riskFromScore(slideScore);
      // Only surface MODERATE+ to avoid noise
      if (risk === 'LOW' && !heavyRainActive) return null;
      return {
        type: 'Feature',
        geometry: polygonFromRing(cell.ring),
        properties: {
          id: `landslide-${cell.id}`,
          island: cell.island,
          zone: cell.zone,
          source: 'Kahu Ola Terrain + NWS',
          source_label: 'Terrain Context',
          risk_index: risk,
          severity: risk,
          drainage: cell.drainage,
          terrain: cell.terrain,
          runoff: cell.runoff,
          heavy_rain_active: heavyRainActive,
          event_time: now,
          note: heavyRainActive
            ? 'Risk elevated — active heavy rain/flood alert detected.'
            : 'Estimated landslide susceptibility from terrain and runoff scoring.',
        },
      };
    })
    .filter(Boolean) as Feature[];

  const envelope = buildHazardEnvelope('landslide', 'Kahu Ola Terrain', region, signals,
    {
      status: signals.length > 0 ? 'detected' : 'none', count: signals.length,
      heavy_rain_active: heavyRainActive,
      message: signals.length > 0 ? 'Landslide susceptibility context available.' : 'No elevated landslide risk.',
    }, { authority: 'contextual', note: 'Landslide context derived conservatively from terrain, runoff, and NWS alert presence. Not an official landslide forecast.' });
  return jsonResp({ ...envelope, stale_after_seconds: 1800 }, 200, cors);
}
async function handleRadarTile(
  z: string, x: string, y: string,
  cors: CorsHeaders
): Promise<Response> {
  const zi = parseInt(z, 10);
  const xi = parseInt(x, 10);
  const yi = parseInt(y, 10);

  if (isNaN(zi) || isNaN(xi) || isNaN(yi))
    return err(400, 'Invalid tile coordinates', cors);
  if (zi < 0 || zi > 18)
    return err(400, 'z must be 0-18', cors);

  // Iowa State Mesonet NEXRAD — USA + territories coverage
  const upstream =
    `https://mesonet.agron.iastate.edu/cache/tile.py` +
    `/1.0.0/nexrad-n0q-900913/${z}/${x}/${y}.png`;

  return proxyFetch(upstream, upstream, 120, cors);
  // TTL 120s — NEXRAD updates every 2-5 min
}

async function proxyFetch(fetchUrl: string, cacheUrl: string, ttlSeconds: number, cors: CorsHeaders): Promise<Response> {
  const cache = caches.default;
  const cacheReq = new Request(cacheUrl);
  const cached = await cache.match(cacheReq);
  // proxyFetch caches binary tiles (image/png) as well as JSON — do NOT require
  // JSON content-type here; serve whatever was stored, with CORS headers merged.
  if (cached) {
    const headers = new Headers(cached.headers);
    Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
    headers.set('X-Kahuola-Cache', 'HIT');
    return new Response(cached.body, { status: cached.status, headers });
  }

  let res: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    res = await fetch(fetchUrl, { signal: controller.signal });
    clearTimeout(timer);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return new Response(JSON.stringify({ error: `Upstream timeout: ${msg}` }), {
      status: 504,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  if (!res.ok) {
    return new Response(JSON.stringify({ error: `Upstream ${res.status}` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  const ct = res.headers.get('Content-Type') || '';
  const shouldCache = ct.includes('image/') || ct.includes('application/json') || ct.includes('geo+json');
  const respHeaders = new Headers({
    'Content-Type': ct,
    'Cache-Control': `public, max-age=${ttlSeconds}`,
    'X-Kahuola-Cache': 'MISS',
    ...cors,
  });

  const body = await res.arrayBuffer();
  const response = new Response(body, { status: 200, headers: respHeaders });
  if (shouldCache) await cache.put(cacheReq, response.clone());
  return response;
}

// ── ZONE BRIEF — /api/hazards/zone/:zoneId ────────────────────────
// Phase 1: static zone profile + live NWS alerts → deterministic
// template brief. No AI, no Gemma, no browser-side upstream calls.
// Every failure path returns a safe fallback brief with status 200
// per Invariant II (UI never goes blank).

function parseHouseholdFromUrl(url: URL): HouseholdProfile {
  const q = url.searchParams;
  const flag = (name: string): boolean => {
    const v = (q.get(name) || "").toLowerCase();
    return v === "1" || v === "true" || v === "yes";
  };
  return {
    kupuna: flag("kupuna"),
    keiki: flag("keiki"),
    pets: flag("pets"),
    medical: flag("medical"),
    // car defaults to TRUE (most households) unless explicitly set to false
    car: q.get("car") !== null ? flag("car") : true,
  };
}

function parseLangFromUrl(url: URL): string {
  const lang = (url.searchParams.get("lang") || "en").toLowerCase();
  // Phase 1 only supports en templates; other langs are preserved in the
  // response but generate English content. Phase 2 will translate.
  return ["en", "vi", "haw"].includes(lang) ? lang : "en";
}

function textMentionsZone(text: string, zoneName: string): boolean {
  if (!text) return false;
  const haystack = text.toLowerCase();
  return haystack.includes(zoneName.toLowerCase());
}

async function buildZoneDynamicState(
  zone: { zone_id: string; zone_name: string; typical_fire_risk: RiskLevel; typical_flood_risk: RiskLevel },
  cors: CorsHeaders,
): Promise<ZoneDynamicState> {
  const fetched_at = new Date().toISOString();
  const sources: string[] = ["Kahu Ola zone profile"];
  const notes: string[] = [];

  // Start from LOW — the honest default when no live signal says otherwise.
  // typical_fire_risk / typical_flood_risk stay in the zone profile for
  // context, but NEVER surface as current state. Only live NWS/FIRMS
  // signals can escalate above LOW.
  let fire_risk: RiskLevel = "LOW";
  let flood_risk: RiskLevel = "LOW";
  const nws_alerts: string[] = [];

  const upstream = await fetchNwsAlerts(cors);
  if (upstream && upstream.ok) {
    sources.push("NWS Honolulu active alerts");
    const features: any[] = Array.isArray(upstream.data?.features)
      ? upstream.data.features
      : [];

    for (const f of features) {
      const props = f?.properties || {};
      const event = String(props.event || "").trim();
      const areaDesc = String(props.areaDesc || "");
      if (!event) continue;

      // Zone-aware filtering: if the alert area mentions the zone by name,
      // count it. Otherwise, still count island-wide Red Flag Warnings
      // (they apply to all Maui zones).
      const zoneMatch = textMentionsZone(areaDesc, zone.zone_name);
      const islandWideFire = /red flag/i.test(event);

      if (zoneMatch || islandWideFire) {
        if (!nws_alerts.includes(event)) nws_alerts.push(event);
      }

      if ((zoneMatch || islandWideFire) && /flash flood/i.test(event)) {
        flood_risk = "EXTREME";
      }
      if ((zoneMatch || /flood warning/i.test(event)) && /flood warning/i.test(event)) {
        if (flood_risk !== "EXTREME") flood_risk = "HIGH";
      }
      if (islandWideFire) {
        fire_risk = "EXTREME";
      }
    }
  } else {
    notes.push(
      `NWS alerts endpoint unavailable (${upstream && upstream.error ? upstream.error : "unknown"}); risk levels reflect absence of confirmed alerts only.`,
    );
  }

  nws_alerts.sort();

  return {
    fetched_at,
    fire_risk,
    flood_risk,
    nws_alerts,
    wind_mph: null,        // Phase 1: not wired to RAWS yet
    humidity_pct: null,    // Phase 1: not wired to RAWS yet
    notes,
    sources,
  };
}

/**
 * Attempt a Gemma 4 upgrade of the template brief. If the wrapper returns
 * fallbackUsed=true for any reason (timeout, empty output, validator
 * rejection, runtime error), we keep the deterministic template exactly
 * as produced — template fallback is the primary safety net per doctrine.
 *
 * The AI's contribution is the `what_it_means` paragraph only: it provides
 * reasoning about what the conditions mean in plain language. Headline,
 * action checklist (what_to_do), and household note stay deterministic
 * because they encode civic facts (routes, choke points, schools) that
 * the AI must never invent.
 */
async function tryGemmaUpgrade(
  env: Env,
  templateBrief: ZoneBrief,
  zone: ReturnType<typeof getZoneById>,
  state: ZoneDynamicState,
  household: HouseholdProfile,
  lang: string,
): Promise<ZoneBrief> {
  if (!zone) return templateBrief;
  if (!env.AI || typeof env.AI.run !== "function") return templateBrief;

  try {
    const result = await generateGemmaBrief(env, {
      zoneId: zone.zone_id,
      lang,
      householdProfile: household,
      zoneSnapshot: state,
      zoneName: zone.zone_name,
      zoneTerrain: zone.terrain_type,
      zoneDrainageContext: zone.drainage_context,
      zoneEvacuationPrimary: zone.evacuation_routes.primary,
      zoneNotableSchoolNames: zone.notable_locations
        .filter((l) => l.type === "school")
        .map((l) => l.name),
      zoneHistoricalSignals: zone.historical_signals,
    });

    if (result.fallbackUsed || !result.text) {
      return templateBrief;
    }

    // Merge: AI supplies the reasoning paragraph; deterministic template
    // supplies facts. Sources accumulate both attributions.
    return {
      ...templateBrief,
      what_it_means: result.text,
      sources: result.sourceLabels.length > 0
        ? result.sourceLabels
        : templateBrief.sources,
      generated_by: "kahuola_ai",
      fallback_used: false,
    };
  } catch (e: unknown) {
    // Any failure bubbles back to the template — never surfaces to the UI.
    console.error(
      "tryGemmaUpgrade failed; using deterministic template:",
      e instanceof Error ? e.message : "unknown",
    );
    return templateBrief;
  }
}

async function handleZoneBrief(
  zoneId: string,
  url: URL,
  env: Env,
  cors: CorsHeaders,
): Promise<Response> {
  const lang = parseLangFromUrl(url);
  const household = parseHouseholdFromUrl(url);

  const zone = getZoneById(zoneId);
  if (!zone) {
    // Unknown zone: return a structured "not found" envelope but still
    // status 200 so the UI never sees a raw error page (Invariant II).
    return jsonResp(
      {
        ok: false,
        error: "zone_not_found",
        message: `Zone '${zoneId}' is not a known Kahu Ola zone.`,
        zone: null,
        state: null,
        brief: null,
        delta: "Conditions unchanged since yesterday.",
      },
      200,
      cors,
    );
  }

  try {
    const state = await buildZoneDynamicState(zone, cors);
    writeSnapshot(zone.zone_id, state);

    const key = briefCacheKey(zone.zone_id, state, household, lang);
    let brief = getCachedBrief(key);
    if (!brief) {
      const templateBrief = generateZoneBrief({ zone, state, household, lang });
      brief = await tryGemmaUpgrade(env, templateBrief, zone, state, household, lang);
      putCachedBrief(key, brief);
    }

    const delta = formatDelta(computeSnapshotDelta(zone.zone_id));

    return jsonResp(
      {
        ok: true,
        zone,
        state,
        brief,
        delta,
        generated_at: state.fetched_at,
      },
      200,
      cors,
    );
  } catch (e: unknown) {
    // Any unexpected failure inside the zone pipeline → deterministic
    // fallback brief. UI still renders, sources still point at the
    // zone profile, and fallback_used: true is visible to the client.
    const msg = e instanceof Error ? e.message : "unknown";
    console.error(`handleZoneBrief failure for ${zoneId}:`, msg);
    const fallback = generateFallbackBrief(zone, lang);
    const fallbackState: ZoneDynamicState = {
      fetched_at: new Date().toISOString(),
      fire_risk: zone.typical_fire_risk,
      flood_risk: zone.typical_flood_risk,
      nws_alerts: [],
      wind_mph: null,
      humidity_pct: null,
      notes: [`internal_error: ${msg}`],
      sources: ["Kahu Ola zone profile"],
    };
    return jsonResp(
      {
        ok: false,
        error: "zone_internal",
        message: msg,
        zone,
        state: fallbackState,
        brief: fallback,
        delta: "Conditions unchanged since yesterday.",
      },
      200,
      cors,
    );
  }
}

// ── /api/brief — n8n social poster endpoint (POST) ───────────────
// Replaces the old Gemini call in kahuola_n8n_workflow.json. n8n POSTs
// a freeform civic context string; the Worker runs Gemma 4 with the
// SOCIAL_SYSTEM_PROMPT and returns a validated Facebook post.
//
// Auth: shared-secret bearer token via env.MEDIA_BRIEF_WEBHOOK_TOKEN.
//       Request header: Authorization: Bearer <token>
//
// Failure discipline: every path returns HTTP 200 with a JSON envelope so
// n8n parsing is trivial and the workflow never breaks on errors.

const BRIEF_STATIC_FALLBACK =
  "Aloha mai kākou. Kahu Ola is monitoring hazard conditions across Hawaiʻi. Stay informed — kahuola.org 🌺";

async function handleBriefPost(
  request: Request,
  env: Env,
  cors: CorsHeaders,
): Promise<Response> {
  // Auth guard — bearer token. When no token is configured in the env,
  // we REFUSE the request rather than open the endpoint (defensive
  // default for a billed inference route).
  const expected = env.MEDIA_BRIEF_WEBHOOK_TOKEN;
  if (!expected) {
    return jsonResp(
      {
        ok: false,
        error: "brief_auth_unconfigured",
        message:
          "MEDIA_BRIEF_WEBHOOK_TOKEN not set in Worker environment. /api/brief is disabled until configured.",
        post: BRIEF_STATIC_FALLBACK,
        is_fallback: true,
        sources: ["template_fallback"],
        generated_at: new Date().toISOString(),
      },
      200,
      cors,
    );
  }
  const authHeader = request.headers.get("Authorization") || "";
  const presented = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!presented || presented !== expected) {
    return jsonResp(
      {
        ok: false,
        error: "brief_unauthorized",
        message: "Missing or invalid Authorization bearer token.",
        post: BRIEF_STATIC_FALLBACK,
        is_fallback: true,
        sources: ["template_fallback"],
        generated_at: new Date().toISOString(),
      },
      200,
      cors,
    );
  }

  // Body parsing.
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResp(
      {
        ok: false,
        error: "brief_invalid_json",
        message: "Request body was not valid JSON.",
        post: BRIEF_STATIC_FALLBACK,
        is_fallback: true,
        sources: ["template_fallback"],
        generated_at: new Date().toISOString(),
      },
      200,
      cors,
    );
  }

  const context =
    typeof body?.context === "string" ? body.context.trim() : "";
  if (!context) {
    return jsonResp(
      {
        ok: false,
        error: "brief_missing_context",
        message: "Request body must include a non-empty `context` string.",
        post: BRIEF_STATIC_FALLBACK,
        is_fallback: true,
        sources: ["template_fallback"],
        generated_at: new Date().toISOString(),
      },
      200,
      cors,
    );
  }
  const lang = typeof body?.lang === "string" ? body.lang : "en";
  const maxChars =
    typeof body?.max_chars === "number" && Number.isFinite(body.max_chars)
      ? body.max_chars
      : 280;

  try {
    const result = await generateSocialPost(env, { context, lang, maxChars });
    return jsonResp(
      {
        ok: true,
        post: result.post,
        is_fallback: result.fallbackUsed,
        sources: result.sources,
        model: result.fallbackUsed ? "template_fallback" : GEMMA_MODEL,
        generated_at: new Date().toISOString(),
      },
      200,
      cors,
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("handleBriefPost outer error:", msg);
    return jsonResp(
      {
        ok: false,
        error: "brief_internal",
        message: msg,
        post: BRIEF_STATIC_FALLBACK,
        is_fallback: true,
        sources: ["template_fallback"],
        generated_at: new Date().toISOString(),
      },
      200,
      cors,
    );
  }
}
