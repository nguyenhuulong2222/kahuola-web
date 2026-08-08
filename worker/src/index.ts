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
import {
  generateVoiceScript,
  generateTTSAudio,
  voiceCacheKey,
  type VoiceInput,
} from "./voice";

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
  OPENAI_API_KEY?: string;
  KAHUOLA_MEDIA: {
    get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
    put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<void>;
  };
  // P08 — citizen reports. Both OPTIONAL on purpose: absent bindings degrade
  // the reports feature only, never the rest of the platform (Invariant II).
  REPORTS_DB?: D1Database;
  // Static secret. The DAILY salt is derived in code as
  // sha256(REPORTS_RL_SALT + YYYYMMDD-UTC) — see dailyRateLimitSalt(). One
  // secret, automatic rotation, no archive, no manual chore.
  REPORTS_RL_SALT?: string;
}

// Minimal D1 surface — declared locally for the same reason the AI/KV/R2
// bindings above are: this file does not pull the full workers-types surface.
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
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
  const base: CorsHeaders = {
    Vary: 'Origin',
    // SEO Doctrine V1.1 §8.1 — /api/* responses are not user-facing SEO content.
    'X-Robots-Tag': 'noindex, nofollow, nosnippet',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    base['Access-Control-Allow-Origin'] = origin;
    // POST is listed for the browser preflight path; /api/brief,
    // /api/push/subscribe and (P19) the zone brief all accept it.
    base['Access-Control-Allow-Methods'] = 'GET, HEAD, POST, OPTIONS';
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

async function fetchNwsAlerts(cors: CorsHeaders, areas: string[] | null = ['HI']): Promise<any> {
  const nwsUrl = new URL('https://api.weather.gov/alerts/active');
  if (areas && areas.length > 0) {
    for (const a of areas) nwsUrl.searchParams.append('area', a);
  }

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

// NWS state-code buckets matching REGION_BBOXES. `null` disables the
// area filter entirely so the full national feed is returned.
const REGION_NWS_AREAS: Record<string, string[] | null> = {
  hawaii: ['HI'],
  west: ['CA', 'OR', 'WA', 'NV', 'AZ', 'ID', 'MT'],
  usa: null,
};

// NWS UGC code → approximate centroid [lng, lat]. Used to synthesize a
// Point geometry for flood alerts whose upstream `geometry` is null, so
// client maps can render a marker instead of silently dropping them.
//
// UGC format: SSXNNN where SS=state, X=Z (forecast zone) or C (county
// FIPS), NNN=3-digit code. Example: HIC009 = Hawaiʻi state, County,
// FIPS 009 = Maui. Prefix keys (HIC, HIZ, CAC, ...) act as fallbacks,
// and 2-letter state keys (HI, CA, ...) as a last resort.
const NWS_ZONE_CENTROIDS: Record<string, [number, number]> = {
  // NWS Forecast Zones (HIZ)
  HIZ001: [-156.3, 20.8],
  HIZ002: [-155.5, 19.6],
  HIZ003: [-155.9, 19.6],
  HIZ004: [-157.9, 21.4],
  HIZ005: [-159.5, 22.0],
  HIZ006: [-156.9, 21.1],
  HIZ007: [-156.9, 20.8],

  // Hawaiʻi County FIPS (HIC)
  HIC001: [-156.3, 20.8], // Maui (alt FIPS)
  HIC003: [-157.9, 21.4], // Honolulu (Oʻahu)
  HIC005: [-159.5, 22.0], // Kauaʻi
  HIC007: [-155.5, 19.6], // Hawaiʻi Island
  HIC009: [-156.3, 20.8], // Maui

  // Prefix fallbacks
  HIC: [-157.0, 20.8],
  HIZ: [-157.0, 20.8],
  HI: [-157.0, 20.8],

  // US State prefixes
  CAZ: [-119.4, 36.7],
  CAC: [-119.4, 36.7],
  CA: [-119.4, 36.7],
  ORZ: [-120.5, 43.8],
  ORC: [-120.5, 43.8],
  OR: [-120.5, 43.8],
  WAZ: [-120.5, 47.5],
  WAC: [-120.5, 47.5],
  WA: [-120.5, 47.5],
};

function centroidsForUgc(codes: string[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const raw of codes) {
    const code = String(raw || '').toUpperCase();
    if (!code) continue;
    // Exact code (HIC009, HIZ001, ...)
    let hit = NWS_ZONE_CENTROIDS[code];
    // 3-char prefix (HIC, HIZ, CAC, ...)
    if (!hit) hit = NWS_ZONE_CENTROIDS[code.slice(0, 3)];
    // 2-char state (HI, CA, ...)
    if (!hit) hit = NWS_ZONE_CENTROIDS[code.slice(0, 2)];
    if (hit) out.push(hit);
  }
  return out;
}

async function handleAlerts(url: URL, cors: CorsHeaders): Promise<Response> {
  const region = resolveRegion(url);
  const areas = REGION_NWS_AREAS[region] ?? ['HI'];
  const upstream = await fetchNwsAlerts(cors, areas);
  if (!upstream.ok) {
    return jsonResp(
      buildHazardEnvelope(
        'alerts', 'NWS', region, [],
        { status: 'unavailable', count: 0, message: 'NWS alerts endpoint temporarily unavailable.' },
        { authority: 'official', note: 'Live NWS integration via api.weather.gov alerts endpoint.', upstream_error: upstream.error },
      ),
      200, cors,
    );
  }

  const rawFeatures = Array.isArray(upstream.data?.features) ? upstream.data.features : [];
  // Full active-alert superset — NO event whitelist, and zone-based
  // (null-geometry) alerts are RETAINED (flagged zone_based) rather than
  // dropped, so the client can render them as text cards.
  const signals: Feature[] = rawFeatures.map((f: any, idx: number) => {
    const ugcCodes: string[] = Array.isArray(f?.properties?.geocode?.UGC)
      ? f.properties.geocode.UGC
      : [];
    const centroids = centroidsForUgc(ugcCodes);
    const geometry =
      f.geometry ||
      (centroids.length > 0
        ? { type: 'Point', coordinates: centroids[0] }
        : null);
    const rawSeverity = f?.properties?.severity || '';
    const kahu_severity =
      rawSeverity === 'Extreme' ? 'CRITICAL'
        : rawSeverity === 'Severe' ? 'WARNING'
        : rawSeverity === 'Moderate' ? 'WATCH'
        : rawSeverity === 'Minor' ? 'ADVISORY'
        : 'INFO';
    return {
      type: 'Feature',
      geometry,
      properties: {
        id: f?.id || f?.properties?.id || `nws-alert-${idx}`,
        source: 'NWS',
        event: f?.properties?.event || '',
        severity: rawSeverity,
        kahu_severity,
        urgency: f?.properties?.urgency || '',
        certainty: f?.properties?.certainty || '',
        headline: f?.properties?.headline || '',
        sent: f?.properties?.sent || '',
        onset: f?.properties?.onset || '',
        ends: f?.properties?.ends || '',
        expires: f?.properties?.expires || '',
        areaDesc: f?.properties?.areaDesc || '',
        area_desc: f?.properties?.areaDesc || '',
        instruction: f?.properties?.instruction || '',
        response: f?.properties?.response || '',
        ugc_codes: ugcCodes,
        centroids,
        geometry_synthesized: !f.geometry && centroids.length > 0,
        zone_based: !f.geometry,
      },
    };
  });

  const by_severity = {
    critical: signals.filter((f) => f.properties.kahu_severity === 'CRITICAL').length,
    warning: signals.filter((f) => f.properties.kahu_severity === 'WARNING').length,
    watch: signals.filter((f) => f.properties.kahu_severity === 'WATCH').length,
    advisory: signals.filter((f) => f.properties.kahu_severity === 'ADVISORY').length,
    info: signals.filter((f) => f.properties.kahu_severity === 'INFO').length,
  };

  const event_types = Array.from(
    new Set(signals.map((f) => String(f.properties.event || '')).filter((e) => e.length > 0))
  );

  return jsonResp(
    buildHazardEnvelope(
      'alerts',
      'NWS',
      region,
      signals,
      {
        status: signals.length > 0 ? 'active' : 'none',
        count: signals.length,
        by_severity,
        event_types,
        message: signals.length > 0
          ? `${signals.length} active National Weather Service alert(s) for Hawaiʻi.`
          : 'No active National Weather Service alerts in this snapshot.',
      },
      {
        authority: 'official',
        note: 'Live NWS integration via api.weather.gov alerts endpoint. Full active-alert superset.',
      },
    ),
    200,
    cors,
  );
}

async function handleFlashFlood(url: URL, cors: CorsHeaders): Promise<Response> {
  const region = resolveRegion(url);
  const areas = REGION_NWS_AREAS[region] ?? ['HI'];
  const upstream = await fetchNwsAlerts(cors, areas);
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
    .map((f: any, idx: number) => {
      const ugcCodes: string[] = Array.isArray(f?.properties?.geocode?.UGC)
        ? f.properties.geocode.UGC
        : [];
      const centroids = centroidsForUgc(ugcCodes);
      // Synthesize a Point geometry from the first centroid when the
      // upstream geometry is null — NWS often omits polygons for
      // forecast-zone alerts, which would otherwise drop the signal.
      const geometry =
        f.geometry ||
        (centroids.length > 0
          ? { type: 'Point', coordinates: centroids[0] }
          : null);
      return {
        type: 'Feature',
        geometry,
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
          area_desc: f?.properties?.areaDesc || '',
          instruction: f?.properties?.instruction || '',
          response: f?.properties?.response || '',
          ugc_codes: ugcCodes,
          centroids,
          geometry_synthesized: !f.geometry && centroids.length > 0,
        },
      };
    })
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

      if (request.method === 'POST' && path === '/api/push/subscribe') {
        return handlePushSubscribe(request, env, cors);
      }

      // P08 — citizen fire reports. Origin allowlist enforced explicitly here,
      // same as the zone-brief POST: the report form lives on kahuola.org and
      // this route is never open CORS.
      if (request.method === 'POST' && path === '/api/reports') {
        if (origin && !ALLOWED_ORIGINS.includes(origin)) return err(403, 'Forbidden', cors);
        return handleReportCreate(request, env, cors);
      }

      // P19: zone brief over POST so the household flags — which include a
      // `medical` bit — travel in the body instead of the query string.
      // Same handler, same envelope; GET is unchanged for fielded iOS 1.0.
      if (request.method === 'POST') {
        const zonePostMatch = path.match(/^\/api\/hazards\/zone\/([a-z0-9_]+)$/);
        if (zonePostMatch) {
          if (origin && !ALLOWED_ORIGINS.includes(origin)) return err(403, 'Forbidden', cors);
          // Invariant III: unparseable body is dropped, not guessed — the
          // handler then reads the URL and applies documented defaults.
          const body = await request.json().catch(() => null);
          return handleZoneBrief(zonePostMatch[1], url, env, cors, body);
        }
      }

      if (!['GET', 'HEAD'].includes(request.method)) return err(405, 'Method not allowed', cors);
      if (origin && !ALLOWED_ORIGINS.includes(origin)) return err(403, 'Forbidden', cors);

      if (path === '/api/tiles/health' || path === '/api/health') return handleHealth(env, cors);
      if (path === '/api/hazards/alerts' || path === '/hazards/alerts') return handleAlerts(url, cors);
      if (path === '/api/hazards/flash-flood' || path === '/hazards/flash-flood') return handleFlashFlood(url, cors);
      if (path === '/api/hazards/flood-context' || path === '/hazards/flood-context') return handleFloodContext(url, cors);
      if (path === '/api/hazards/rain-radar' || path === '/hazards/rain-radar') return handleRainRadar(url, cors);
      if (path === '/api/hazards/mrms-qpe' || path === '/hazards/mrms-qpe') return handleMrmsQpe(url, cors);
      if (path === '/api/hazards/landslide' || path === '/hazards/landslide') return handleLandslide(url, cors);
      if (path === '/api/hazards/smoke' || path === '/hazards/smoke') return handleSmoke(url, cors);
      if (path === '/api/hazards/perimeters' || path === '/hazards/perimeters') return handlePerimeters(url, cors);
      if (path === '/api/hazards/fire-danger' || path === '/hazards/fire-danger') return handleFireDanger(url, env, cors);
      // Read-only aggregated summary for the embeddable widget + insight script.
      // Reuses caches populated by smoke/perimeters/firms handlers; no new
      // upstream, no write to primary snapshot keys. Invariant II/III: always
      // 200 + valid JSON, degrades deterministically on cache miss / parse fail.
      if (path === '/api/hazards/air' || path === '/hazards/air') return handleAirQuality(url, env, cors);
      if (path === '/api/hazards/summary' || path === '/hazards/summary') return handleHazardsSummary(url, env, cors);
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

      // Coastal alerts — High Surf, Coastal Flood, Beach Hazards
      if (path === '/api/hazards/coastal' || path === '/hazards/coastal')
        return handleCoastal(cors);

      // Hurricane tracks — NHC active storms
      if (path === '/api/hazards/hurricane' || path === '/hazards/hurricane')
        return handleHurricane(cors);

      // Zone brief — static zone profile + live NWS alerts → template,
      // upgraded to Gemma 4 reasoning when the AI binding is available.
      // Template fallback stays the primary safety net.
      const zoneMatch = path.match(/^\/api\/hazards\/zone\/([a-z0-9_]+)$/);
      if (zoneMatch) return handleZoneBrief(zoneMatch[1], url, env, cors);

      // P08 — active (unexpired) community reports, cross-checked against
      // cached FIRMS at read time.
      if (path === '/api/reports') return handleReportList(url, env, cors);

      // Voice brief — Gemma 4 script + OpenAI TTS, cached in R2
      if (path === '/api/voice') return handleVoiceRequest(url, env, cors);

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
    try {
      await sendDailyBriefNotifications(env);
    } catch (e) {
      // Fail silently — cron never crashes Worker
    }
    try {
      // P08 — physically remove reports past the 48 h delete threshold.
      // Reads already filter at 24 h, so this only reclaims storage.
      await deleteExpiredReports(env);
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
      // Now meaningful: AIRNOW_API_KEY is actually used, by /api/hazards/air.
      // It was dead config until that endpoint shipped — the flag reported an
      // AirNow dependency that did not exist. The AQI TILE route is separate
      // and needs no key; see handleAirnowXyz.
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

// Region-scoped bounding boxes for FIRMS + NWS queries. `region` is the
// canonical param; `scope` is kept as a legacy alias.
const REGION_BBOXES: Record<string, [number, number, number, number]> = {
  hawaii: [-161.2, 18.5, -154.5, 22.5],
  // Maui MVP window for the fire-spread danger layer. Additive: before this
  // existed, `region=maui` fell through to `hawaii` at resolveFirmsBBox().
  // Deliberately does NOT change the `hawaii` entry — SUMMARY_FIRMS_KEY is
  // built from it and any drift there silently zeroes the summary fire count.
  maui: [-156.75, 20.45, -155.95, 21.05],
  west: [-125.0, 32.0, -104.0, 49.0],
  usa: [-125.0, 24.0, -66.5, 49.5],
};

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

  const region = (
    url.searchParams.get('region') ||
    url.searchParams.get('scope') ||
    'hawaii'
  ).toLowerCase();
  return REGION_BBOXES[region] || REGION_BBOXES.hawaii;
}

// Cloudflare Workers allow ~6 simultaneous outbound connections per request.
// Anything beyond that QUEUES, and AbortSignal.timeout() counts queue time — so a
// wide fan-out does not just run slower, it makes later fetches die waiting even
// when the upstream is perfectly healthy. Any fan-out that can exceed 6 must go
// through here.
//
// Returns PromiseSettledResult-shaped entries in input order, so it is a drop-in
// for Promise.allSettled(items.map(fn)) and callers keep their existing
// status/value/reason handling.
const OUTBOUND_CONCURRENCY_LIMIT = 6;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<{ status: 'fulfilled'; value: R } | { status: 'rejected'; reason: unknown }>> {
  const out = new Array(items.length) as Array<
    { status: 'fulfilled'; value: R } | { status: 'rejected'; reason: unknown }
  >;
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = { status: 'fulfilled', value: await fn(items[i], i) }; }
      catch (reason) { out[i] = { status: 'rejected', reason }; }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );
  return out;
}

// ── PRIMARY FIRMS DATASET — ONE SOURCE OF TRUTH ────────────────────────────
// The cache WRITER default (handleFirmsHotspots), the summary READER key
// (SUMMARY_FIRMS_KEY) and the MODIS cross-reference gate all read this. They
// MUST agree: writer and reader build the same cache key via firmsCacheKey(), so
// if they ever drifted the summary would read a key nobody writes — a permanent
// cache miss reporting count 0 forever. Keeping one literal makes that
// impossible, and makes the next migration (NOAA-20 -> NOAA-21) a one-line
// change that cannot re-orphan the xref gate.
//
// SNPP RETIRED HERE 2026-08-04. Suomi NPP's end of life was anticipated on or
// before Oct 2026 and it has arrived: measured the same day, VIIRS_SNPP_NRT
// returned 2 detections across the ENTIRE continental US and 0 over Hawaiʻi,
// while NOAA-20 saw 18 and NOAA-21 saw 25 over Hawaiʻi in the same window.
// Because summary.fire was pinned to SNPP it reported count 0 / status "none"
// with Kīlauea plainly visible to the other two satellites — silently disarming
// the standing deploy abort trigger. SNPP remains in FIRE_DANGER_SENSORS as the
// demoted last-resort fallback; it is only removed from PRIMARY duty here.
const FIRMS_PRIMARY_DATASET = 'VIIRS_NOAA20_NRT';

// Canonical FIRMS cache-key builder. The reader (SUMMARY_FIRMS_KEY) and the
// writer (handleFirmsHotspots) both build the key HERE so they cannot drift.
// Module scope, pure, never throws. `_` is the redacted MAP_KEY slot.
// Row cap for the legacy hotspots endpoint. Named because firmsCacheKey() and
// handleFirmsHotspots must default to the SAME value: the reader
// (SUMMARY_FIRMS_KEY) omits the argument while the warm-writer resolves it from
// the query string, so a mismatch would put them on different keys.
const FIRMS_DEFAULT_LIMIT = 1000;

// `limit` is PART OF THE KEY. It was omitted, so the first request to populate a
// key froze its truncation for the whole TTL: asking for limit=5000 afterwards
// silently returned the earlier 1000-row response, byte-identical. Measured
// 2026-08-04 — a 5000-row request came back with exactly 1000 features.
function firmsCacheKey(
  dataset: string,
  bbox: readonly number[],
  days: number,
  limit: number = FIRMS_DEFAULT_LIMIT,
): string {
  return `https://firms.modaps.eosdis.nasa.gov/api/area/csv/_/${dataset}/${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}/${days}?limit=${limit}`;
}

async function handleFirmsHotspots(url: URL, env: Env, cors: CorsHeaders): Promise<Response> {
  if (!env.NASA_FIRMS_MAP_KEY) return err(503, 'NASA_FIRMS_MAP_KEY not configured', cors);

  const dataset = url.searchParams.get('dataset') || FIRMS_PRIMARY_DATASET;
  const days = Math.min(10, Math.max(1, parseInt(url.searchParams.get('days') || '1', 10)));
  const limit = Math.min(5000, Math.max(1, parseInt(url.searchParams.get('limit') || String(FIRMS_DEFAULT_LIMIT), 10)));

  const bbox = resolveFirmsBBox(url);
  if (!bbox) {
    return err(400, 'bbox must be WEST,SOUTH,EAST,NORTH or scope must be hawaii|usa', cors);
  }

  const [west, south, east, north] = bbox;

  const firmsUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${env.NASA_FIRMS_MAP_KEY}/${dataset}/${west},${south},${east},${north}/${days}`;
  const cacheUrl = firmsCacheKey(dataset, bbox, days, limit);   // shared builder, limit included (no drift)
  const cache = caches.default;
  const cacheReq = new Request(cacheUrl);
  const cached = await cache.match(cacheReq);
  const cachedJson = cachedJsonResponse(cached, cors);
  if (cachedJson) return cachedJson;

  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  // MODIS cross-reference for multi-satellite confirmation (VIIRS primary only).
  // Gated on the CONSTANT, never a literal: when the primary moved off SNPP a
  // hardcoded check would have silently stopped firing and detection_confidence
  // would never be set to 'high' again — with no error anywhere.
  const modisXrefUrl = dataset === FIRMS_PRIMARY_DATASET
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

// ── Volcanic zone classification (Layer A owns truth) ───────────────────────
// USGS Hawaiian Volcano Observatory (HVO) active volcanic areas, public
// reference as of 2026-07-05. Bboxes are DELIBERATELY GENEROUS: it is safer to
// tag a near-volcano thermal detection as volcanic-zone than to let lava/vent
// heat trigger an urban wildfire advisory. This is NOT inference — it is a
// geometry test on already-validated coordinates (Invariant III safe).
//   Kīlauea:   summit 19.421°N/155.287°W (Halemaʻumaʻu) + East Rift Zone
//              (2018 lower-ERZ / Leilani ~19.47°N/154.90°W → ocean entry).
//   Mauna Loa: summit 19.475°N/155.608°W (Mokuʻāweoweo) + NE/SW Rift Zones
//              (2022 NERZ fissures ~19.55°N/155.45–155.50°W).
const VOLCANIC_ZONES: ReadonlyArray<{ id: string; west: number; south: number; east: number; north: number }> = [
  { id: 'kilauea-summit-erz', west: -155.35, south: 19.25, east: -154.80, north: 19.50 },
  { id: 'mauna-loa',          west: -155.75, south: 19.30, east: -155.40, north: 19.60 },
];

// Pure point-in-bbox on already-validated [lng, lat]. Module scope, never throws.
function inVolcanicZone(lng: number, lat: number): boolean {
  for (const z of VOLCANIC_ZONES) {
    if (lng >= z.west && lng <= z.east && lat >= z.south && lat <= z.north) return true;
  }
  return false;
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
        // Additive geometry tag — never removes/changes existing fields.
        // true => detection falls inside a USGS HVO active volcanic bbox.
        volcanic_zone: inVolcanicZone(lng, lat),
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

// ═══════════════════════════════════════════════════════════════════════════
// FIRE-SPREAD DANGER LAYER
//   Stage 0 — multi-sensor VIIRS 375 m ingest  (fetchFirmsMultiSensor)
//   Stage 1 — transparent danger heuristic     (handleFireDanger)
//
// Answers "where is the fire going", not "where is the fire". Pure TypeScript:
// no ML, no raster. Every constant below is deliberately visible and commented
// so the output is auditable rather than oracular.
//
// Scope notes, so future edits do not silently break neighbours:
//   · No MODIS on this path (VIIRS 375 m only). The MODIS cross-reference in
//     handleFirmsHotspots is a DIFFERENT contract and is left untouched.
//   · Nothing here mutates handleFirmsHotspots, its default dataset, or
//     SUMMARY_FIRMS_KEY. Cache keys are separately namespaced (see below).
// ═══════════════════════════════════════════════════════════════════════════

// Sensor priority is load-bearing. Suomi NPP end-of-life is anticipated on or
// before Oct 2026 — it may be dark during the Nov 2026 competition window — so
// it is a FALLBACK, never a primary. NOAA-20 and NOAA-21 carry this layer.
const FIRE_DANGER_SENSORS = [
  'VIIRS_NOAA20_NRT',
  'VIIRS_NOAA21_NRT',
  'VIIRS_SNPP_NRT',
] as const;

// FIRMS direct-broadcast cadence for Hawaiʻi is ~20-30 min, so a 10 min TTL
// never serves meaningfully stale data and keeps us far under the 5000-per-
// 10-min rate limit (3 requests per cold cache period).
const FIRE_DANGER_FIRMS_TTL = 600;

type FirmsHotspot = {
  lat: number;
  lon: number;
  frp: number;
  acq_date: string;
  acq_time: string;
  confidence: string;
  satellite: string;
  version: string;
  sensor: string;
  // Layer A geometry test — see the volcanic exclusion note on FirmsIngest.
  volcanic: boolean;
};

type FirmsIngest = {
  // WILDLAND hotspots only. Volcanic thermal anomalies are excluded from the
  // spread model entirely:
  //   The score is effective_km = km / (wind × humidity) — a downwind
  //   ADVECTION model for vegetation fire. Lava and vent heat do not advect on
  //   the trades, so pushing a volcanic detection through it would invent a
  //   hazard model we never designed and cannot defend. Measured 2026-08-03:
  //   9 of 10 Hawaiʻi detections were Kīlauea summit/ERZ, and they were
  //   producing all 75 of Hawaiʻi Island's shaded cells — 9 of them EXTREME —
  //   i.e. lava rendered as wind-driven wildfire spread.
  //
  // TRADE-OFF, INHERITED FROM LAYER A AND DELIBERATE: VOLCANIC_ZONES bboxes are
  // deliberately generous, so a genuine VEGETATION fire ignited by lava inside
  // the ERZ bbox is excluded from spread scoring too. That is the safer
  // failure: residents near Kīlauea already watch USGS HVO, whereas a permanent
  // 24/7 wildfire advisory ringing an active volcano would discredit the whole
  // layer. Layer A made this same call; this path inherits it on purpose.
  hotspots: FirmsHotspot[];
  // Counted and REPORTED, never silently dropped — a detection that simply
  // vanishes from the envelope is its own kind of dishonesty.
  volcanic_count: number;
  // Retained for PER-ISLAND COUNTING ONLY. These are never scored and never
  // reach buildIslandResult's cell loop — the exclusion above is absolute.
  // They exist so an island can report how many volcanic detections sit inside
  // its own bbox, which is the only meaningful attribution for a hotspot that
  // drives no cells.
  volcanic_hotspots: FirmsHotspot[];
  health: 'ok' | 'degraded' | 'unconfigured';
  sensors_used: string[];
};

// Namespaced UNDER /fire-danger/ on purpose. firmsCacheKey() addresses the
// GeoJSON written by handleFirmsHotspots and read back via SUMMARY_FIRMS_KEY;
// for the primary dataset + hawaii + 1day the two would otherwise collide.
// Storing raw CSV there would hand the summary reader a JSON.parse failure.
function fireDangerFirmsCacheKey(sensor: string, bbox: readonly number[], days: number): string {
  return `https://firms.modaps.eosdis.nasa.gov/api/area/csv/_/fire-danger/${sensor}/${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}/${days}`;
}

// Parse one FIRMS CSV payload. Invariant III: any row that fails validation is
// DROPPED — never coerced, never defaulted, never inferred. Pure, never throws.
function parseFirmsCsv(csv: string, sensor: string): FirmsHotspot[] {
  const out: FirmsHotspot[] = [];
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return out;

  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const at = (name: string) => headers.indexOf(name);
  const iLat = at('latitude');
  const iLon = at('longitude');
  // Unrecognised schema (e.g. an HTML error body that still parsed as text) —
  // drop the whole payload rather than guess at column positions.
  if (iLat < 0 || iLon < 0) return out;

  const iFrp = at('frp');
  const iTi4 = at('bright_ti4');
  const iDate = at('acq_date');
  const iTime = at('acq_time');
  const iConf = at('confidence');
  const iSat = at('satellite');
  const iVer = at('version');

  for (let i = 1; i < lines.length; i++) {
    const v = lines[i].split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
    if (v.length < headers.length) continue;              // truncated row → drop

    const lat = parseFloat(v[iLat] ?? '');
    const lon = parseFloat(v[iLon] ?? '');
    if (!isFinite(lat) || !isFinite(lon)) continue;       // non-numeric → drop
    if (lat < -90 || lat > 90) continue;                  // out of range → drop
    if (lon < -180 || lon > 180) continue;                // out of range → drop

    // Radiative power: prefer frp, fall back to bright_ti4 as a proxy. A
    // non-numeric power value is a parse failure, NOT a zero-power fire.
    const rawPower = iFrp >= 0 ? v[iFrp] : iTi4 >= 0 ? v[iTi4] : '';
    const frp = parseFloat(rawPower ?? '');
    if (!isFinite(frp)) continue;                         // → drop

    out.push({
      lat,
      lon,
      frp,
      acq_date: iDate >= 0 ? v[iDate] ?? '' : '',
      acq_time: iTime >= 0 ? v[iTime] ?? '' : '',
      confidence: iConf >= 0 ? v[iConf] ?? '' : '',
      satellite: iSat >= 0 ? v[iSat] ?? '' : '',
      version: iVer >= 0 ? v[iVer] ?? '' : '',            // carries the RT/URT/NRT tag
      sensor,
      // Reuses Layer A's VOLCANIC_ZONES / inVolcanicZone — no new geometry.
      // A pure point-in-bbox test on already-validated coordinates, so this is
      // Invariant-III safe: it classifies, it never infers a missing value.
      volcanic: inVolcanicZone(lon, lat),
    });
  }
  return out;
}

// Collapse the same physical fire seen by multiple satellites into one record.
// 0.005° ≈ 550 m ≈ 1.5 VIIRS pixels — tight enough to keep genuinely separate
// ignitions apart, loose enough to absorb cross-sensor geolocation jitter.
// Clustered by position + date + overpass hour.
function dedupeHotspots(hotspots: FirmsHotspot[]): FirmsHotspot[] {
  const seen = new Set<string>();
  const out: FirmsHotspot[] = [];
  for (const h of hotspots) {
    const hour = (h.acq_time || '0000').padStart(4, '0').slice(0, 2);
    const key = `${Math.round(h.lat / 0.005)},${Math.round(h.lon / 0.005)},${h.acq_date},${hour}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

// Stage 0. Returns a health flag — NEVER a Response, never a throw. This is
// what keeps the danger endpoint Invariant-II safe where handleFirmsHotspots
// would have returned 503/502/504 (that handler's public contract is its own
// and is deliberately not changed here).
async function fetchFirmsMultiSensor(
  env: Env,
  bbox: readonly [number, number, number, number],
  days = 1,
): Promise<FirmsIngest> {
  if (!env.NASA_FIRMS_MAP_KEY) {
    // Missing secret degrades the layer; it does not fail the request.
    return { hotspots: [], volcanic_count: 0, volcanic_hotspots: [], health: 'unconfigured', sensors_used: [] };
  }

  const [west, south, east, north] = bbox;
  const cache = caches.default;

  // One request per sensor, in parallel. 3 requests is trivial against the
  // 5000/10-min budget, and allSettled means a dead sensor never blocks a live
  // one — the whole point of demoting SNPP to fallback.
  const settled = await Promise.allSettled(
    FIRE_DANGER_SENSORS.map(async (sensor) => {
      const cacheReq = new Request(fireDangerFirmsCacheKey(sensor, bbox, days));
      const cached = await cache.match(cacheReq);
      if (cached) return { sensor, csv: await cached.text() };

      // MAP_KEY appears ONLY in this upstream URL — never in a cache key,
      // never in a log line, never in the response envelope.
      const upstream =
        `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${env.NASA_FIRMS_MAP_KEY}` +
        `/${sensor}/${west},${south},${east},${north}/${days}`;
      const res = await fetch(upstream, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
      if (!res.ok) throw new Error(`upstream ${res.status}`);
      const csv = await res.text();

      await cache.put(
        cacheReq,
        new Response(csv, {
          headers: {
            'Content-Type': 'text/csv',
            'Cache-Control': `public, max-age=${FIRE_DANGER_FIRMS_TTL}`,
          },
        }),
      );
      return { sensor, csv };
    }),
  );

  const merged: FirmsHotspot[] = [];
  const sensorsUsed: string[] = [];
  settled.forEach((r, i) => {
    const sensor = FIRE_DANGER_SENSORS[i];
    if (r.status !== 'fulfilled') {
      // Structured, key-free drop log.
      console.warn(JSON.stringify({ layer: 'fire-danger', stage: 'firms', sensor, dropped: true }));
      return;
    }
    sensorsUsed.push(sensor);
    merged.push(...parseFirmsCsv(r.value.csv, sensor));
  });

  // Every sensor failed → degraded. This is NOT the same as "zero hotspots".
  if (sensorsUsed.length === 0) {
    return { hotspots: [], volcanic_count: 0, volcanic_hotspots: [], health: 'degraded', sensors_used: [] };
  }
  // Split AFTER dedupe so a fire seen by three satellites is counted once on
  // whichever side it belongs to.
  const deduped = dedupeHotspots(merged);
  const wildland = deduped.filter((h) => !h.volcanic);
  const volcanic = deduped.filter((h) => h.volcanic);
  return {
    hotspots: wildland,
    volcanic_count: volcanic.length,
    volcanic_hotspots: volcanic,   // counting only — never scored
    health: 'ok',
    sensors_used: sensorsUsed,
  };
}

// ── NWS surface conditions (wind vector + relative humidity) ────────────────
// Nothing in the Worker supplied numeric wind/RH before this: handleFireWeather
// fetches Red Flag / Fire Weather Watch ALERT TEXT only.
//
// Station choice matters. Kahului (PHOG) sits in the central valley and does
// NOT represent West Maui leeward wind — the Lahaina failure mode — so the
// leeward/West stations are first-class inputs, not garnish.
//
// P05c survey (2026-08-02): all 565 Hawaiʻi stations were paginated from
// api.weather.gov and every station inside each island bbox was probed. Selection
// is by GEOGRAPHIC ZONE per island, not by name recognition. Two findings drive
// the shape below:
//   · Airports are unreliable here. PHLI, PHKO, PHTO, PHMK, PHJR, PHHI and PHSF
//     all served a FRESH timestamp with null wind/dir/RH. Only PHNL/PHNY/PHOG
//     were usable. Airports are therefore extra members, never a sole source.
//   · The HECO/HELCO/MECO mesonet (`nnnHE`) updates ~every 17 min with complete
//     records, so it is the backbone of every island set.
type NwsStation = { id: string; name: string; lon: number; lat: number };
type IslandKey =
  | 'kauai' | 'niihau' | 'oahu' | 'molokai'
  | 'lanai' | 'maui' | 'kahoolawe' | 'hawaii';

const ISLAND_STATIONS: Record<IslandKey, readonly NwsStation[]> = {
  // Kauaʻi — SOUTH SHORE (Poʻipū) HAS NO LIVE STATION. South cells fall back to
  // the nearest of Waimea/Līhuʻe, which is disclosed in the card copy.
  kauai: [
    { id: 'G5892', name: 'Waimea (leeward W)',  lon: -159.66520, lat: 21.96000 },
    { id: 'HLIH1', name: 'Hanalei (N)',         lon: -159.47440, lat: 22.20420 },
    { id: 'MLDH1', name: 'Moloaʻa Dairy (E)',   lon: -159.33620, lat: 22.18070 },
  ],
  // Niʻihau — privately held; NO weather station exists. Proximity-only.
  niihau: [],
  oahu: [
    { id: '018HE', name: 'Farrington Hwy (leeward W)', lon: -158.09060, lat: 21.33520 },
    { id: '064HE', name: 'Mililani (central)',         lon: -158.02070, lat: 21.41920 },
    { id: 'G7197', name: 'Haleʻiwa (N shore)',         lon: -158.11450, lat: 21.58880 },
    { id: 'AU956', name: 'Honolulu (E/windward)',      lon: -157.79180, lat: 21.29830 },
    { id: 'PHNL', name: 'Honolulu Airport',            lon: -157.94310, lat: 21.32750 },
  ],
  molokai: [
    { id: '102HE', name: 'Mauna Loa Hwy (W)',   lon: -157.16520, lat: 21.14750 },
    { id: '029HE', name: 'Kalae Hwy (central)', lon: -157.04730, lat: 21.14590 },
    { id: 'MKPH1', name: 'Makapulapai (NE)',    lon: -156.96610, lat: 21.20330 },
    { id: 'PAFH1', name: 'Puʻu Aliʻi (E)',      lon: -156.90230, lat: 21.14080 },
  ],
  lanai: [
    { id: 'PHNY', name: 'Lānaʻi City Airport', lon: -156.95140, lat: 20.78560 },
    { id: 'LNIH1', name: 'Lānaʻi 1 (N)',       lon: -157.00640, lat: 20.87330 },
  ],
  // Maui — RE-SELECTED in P05c. The P04 set (PHOG/092HE/036HI/023HI) had only
  // 2 of 4 live while 58 live stations were available; 036HI and 023HI had been
  // stale ~10.7 h. Zones: West-leeward ×2 (the Lahaina failure mode gets double
  // coverage), central, upcountry, south.
  // EAST MAUI / HĀNA HAS NO LIVE STATION — 14 exist, 0 usable. Disclosed in copy.
  maui: [
    { id: '092HE', name: 'Upper Kapalua (W leeward N)', lon: -156.66603, lat: 20.95861 },
    { id: '002HE', name: 'Lahainaluna Rd (W leeward)',  lon: -156.65840, lat: 20.88580 },
    { id: 'PHOG',  name: 'Kahului Airport (central)',   lon: -156.43694, lat: 20.89250 },
    { id: '106HE', name: 'Kahului (central mesonet)',   lon: -156.46705, lat: 20.84634 },
    { id: '015HE', name: 'Makawao Ave (upcountry)',     lon: -156.32803, lat: 20.83766 },
    { id: '047HE', name: 'Ulupalakua Ranch (S)',        lon: -156.41320, lat: 20.68290 },
  ],
  // Kahoʻolawe — uninhabited (unexploded ordnance); NO station exists.
  kahoolawe: [],
  hawaii: [
    { id: '041HE', name: 'Kailua-Kona (W leeward)',   lon: -155.95190, lat: 19.62730 },
    { id: '075HE', name: 'Kaiminani Dr (N Kona)',     lon: -156.01930, lat: 19.72310 },
    { id: '009HE', name: 'Kohala / Waikoloa (NW)',    lon: -155.81250, lat: 20.02400 },
    { id: 'F9660', name: 'Laupāhoehoe (E windward)',  lon: -155.23670, lat: 19.96720 },
    { id: '057HE', name: 'Kaʻū / Volcano (S)',        lon: -155.25240, lat: 19.46320 },
  ],
};

// An observation older than this is treated as ABSENT, not as current
// conditions. Observed in the wild on 2026-08-02: several MECO stations publish
// a fresh timestamp with null wind/RH, and Lahaina WTP had stopped updating ~9h
// earlier while still answering 200. Both are dropped rather than trusted.
const MAX_OBS_AGE_SECONDS = 3 * 3600;

// ── Per-island grids ───────────────────────────────────────────────────────
// One tight bbox per island so ocean cells are never generated. A single
// statewide bbox at 0.02° would be ~46,750 cells, ~10x these totals, almost all
// of it open water.
//
// Hawaiʻi Island is the only island needing a coarser step: at 0.02° it is 4,824
// cells on its own, so it runs at 0.04° (~4.4 km) for 1,224 — in line with Maui.
// Every island therefore reports its OWN grid.step_deg in the envelope.
//
// Maui's bbox and step are LOCKED to P04 so `region=maui` keeps returning
// exactly 1,200 cells with an unchanged envelope shape.
type IslandSpec = {
  key: IslandKey;
  label: string;
  bbox: [number, number, number, number];
  step: number;
};

const FIRE_DANGER_ISLANDS: readonly IslandSpec[] = [
  { key: 'kauai',     label: 'Kauaʻi',     bbox: [-159.83, 21.85, -159.28, 22.25], step: 0.02 }, //  560
  { key: 'niihau',    label: 'Niʻihau',    bbox: [-160.28, 21.78, -160.06, 22.00], step: 0.02 }, //  121
  { key: 'oahu',      label: 'Oʻahu',      bbox: [-158.31, 21.22, -157.63, 21.72], step: 0.02 }, //  850
  { key: 'molokai',   label: 'Molokaʻi',   bbox: [-157.34, 21.03, -156.70, 21.23], step: 0.02 }, //  320
  { key: 'lanai',     label: 'Lānaʻi',     bbox: [-157.07, 20.71, -156.79, 20.93], step: 0.02 }, //  154
  { key: 'maui',      label: 'Maui',       bbox: [-156.75, 20.45, -155.95, 21.05], step: 0.02 }, // 1200 (P04-locked)
  { key: 'kahoolawe', label: 'Kahoʻolawe', bbox: [-156.72, 20.49, -156.53, 20.60], step: 0.02 }, //   54
  { key: 'hawaii',    label: 'Hawaiʻi',    bbox: [-156.10, 18.86, -154.75, 20.30], step: 0.04 }, // 1224
];

// One FIRMS query covers every island. This is a CORRECTNESS requirement, not an
// optimisation: the proximity radius is 20 km and the channels are narrower than
// that — Maui W ↔ Lānaʻi E is 4.7 km, Maui SW ↔ Kahoʻolawe 7.3 km, Maui W ↔
// Molokaʻi SE 12.3 km, Lānaʻi E ↔ Molokaʻi S 17.5 km. Fetching per-island would
// leave a West Maui cell blind to a Lānaʻi fire 4.7 km away — precisely the fire
// this layer exists to catch. So: fetch statewide once, then score EVERY island's
// cells against the FULL hotspot set.
//
// Behaviour note (auditable): as of P05c a Maui cell can be raised by a hotspot
// outside the Maui bbox. P04 could not see those. The envelope shape is
// unchanged; only the scores become more correct.
const FIRE_DANGER_STATEWIDE_BBOX: [number, number, number, number] = [-160.3, 18.9, -154.8, 22.3];

type StationReading = {
  station_id: string;
  station_name: string;
  lon: number;
  lat: number;
  wind_mph: number | null;
  wind_dir_deg: number | null;
  rh_pct: number | null;
  observed_at: string;
};

type NwsConditions = { readings: StationReading[]; health: 'ok' | 'degraded' };

// NWS returns SI units with an explicit unitCode. Convert what we recognise;
// drop what we do not. Guessing at an unknown unit would fabricate a wind speed.
function windToMph(value: number, unitCode: string): number | null {
  if (unitCode.includes('km_h-1')) return value * 0.621371;
  if (unitCode.includes('m_s-1')) return value * 2.236936;
  if (unitCode.includes('mi_h-1')) return value;
  return null;
}

function readQuantity(q: unknown): { value: number; unitCode: string } | null {
  if (!q || typeof q !== 'object') return null;
  const o = q as { value?: unknown; unitCode?: unknown };
  if (typeof o.value !== 'number' || !isFinite(o.value)) return null;
  return { value: o.value, unitCode: typeof o.unitCode === 'string' ? o.unitCode : '' };
}

// Station observations are cached separately from FIRMS. P04 made 4 station
// calls; statewide needs ~25, so an uncached cold request would fan out to 25
// upstream fetches. 600 s matches the mesonet's ~17 min cadence.
const FIRE_DANGER_NWS_TTL = 600;

function fireDangerNwsCacheKey(stationId: string): string {
  return `https://api.weather.gov/_kahuola/fire-danger/nws/${stationId}/latest`;
}

// Fetch a station set in parallel. Never throws; a total wipeout degrades the
// wind/humidity terms to neutral rather than failing the request.
async function fetchNwsConditions(
  stations: readonly NwsStation[],
  nowMs: number,
): Promise<NwsConditions> {
  if (stations.length === 0) return { readings: [], health: 'degraded' };
  const cache = caches.default;

  // Bounded: statewide resolves 20 stations, far past the 6-connection cap.
  const settled = await mapWithConcurrency(stations, OUTBOUND_CONCURRENCY_LIMIT,
    async (st) => {
      const cacheReq = new Request(fireDangerNwsCacheKey(st.id));
      let p: Record<string, unknown>;
      const cached = await cache.match(cacheReq);
      if (cached) {
        p = ((await cached.json()) as { properties?: Record<string, unknown> })?.properties ?? {};
      } else {
        const res = await fetch(`https://api.weather.gov/stations/${st.id}/observations/latest`, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
          headers: { 'User-Agent': 'KahuOla/1.0 kahuola.org', Accept: 'application/geo+json' },
        });
        if (!res.ok) throw new Error(`obs ${res.status}`);
        const text = await res.text();
        await cache.put(
          cacheReq,
          new Response(text, {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': `public, max-age=${FIRE_DANGER_NWS_TTL}`,
            },
          }),
        );
        p = (JSON.parse(text) as { properties?: Record<string, unknown> })?.properties ?? {};
      }

      const ts = typeof p.timestamp === 'string' ? p.timestamp : '';
      const obsMs = ts ? Date.parse(ts) : NaN;
      if (!isFinite(obsMs)) throw new Error('no timestamp');
      const ageSeconds = (nowMs - obsMs) / 1000;
      // Stale observation → treat as absent. Never present old air as current.
      if (ageSeconds > MAX_OBS_AGE_SECONDS || ageSeconds < -600) throw new Error('stale');

      const ws = readQuantity(p.windSpeed);
      const wd = readQuantity(p.windDirection);
      const rh = readQuantity(p.relativeHumidity);

      const windMph = ws ? windToMph(ws.value, ws.unitCode) : null;
      // Direction is required for the downwind test — speed alone is useless
      // here, so a reading without a valid bearing contributes no wind at all.
      // Rounded at the source: NWS emits values like 36.54000000000002, and the
      // raw float reaches the popup verbatim otherwise.
      const windDir =
        wd && wd.value >= 0 && wd.value <= 360
          ? Number(((((wd.value % 360) + 360) % 360)).toFixed(1))
          : null;
      const rhPct =
        rh && rh.unitCode.includes('percent') && rh.value >= 0 && rh.value <= 100
          ? rh.value
          : null;

      const reading: StationReading = {
        station_id: st.id,
        station_name: st.name,
        lon: st.lon,
        lat: st.lat,
        wind_mph: windMph !== null && windDir !== null ? windMph : null,
        wind_dir_deg: windMph !== null && windDir !== null ? windDir : null,
        rh_pct: rhPct,
        observed_at: ts,
      };
      // A station with neither usable wind nor usable RH carries no signal.
      if (reading.wind_mph === null && reading.rh_pct === null) throw new Error('no usable fields');
      return reading;
    },
  );

  const readings: StationReading[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') readings.push(r.value);
    else {
      console.warn(
        JSON.stringify({ layer: 'fire-danger', stage: 'nws', station: stations[i].id, dropped: true }),
      );
    }
  });

  return { readings, health: readings.length > 0 ? 'ok' : 'degraded' };
}

// ── Geometry ───────────────────────────────────────────────────────────────
const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ── P08 · CITIZEN FIRE REPORTS — constants + pure helpers ─────────────
//
// Why this exists: VIIRS has blind windows. Overpass gaps run ~6 h typical
// and up to ~12 h, plus 20–30 min Honolulu direct-broadcast latency. People
// see smoke first. The reverse also holds — satellites vet human reports.
// The cross-check below is the feature; neither eye is trusted alone.

const REPORT_CATEGORIES = ['smoke', 'flames', 'burned_area', 'other'] as const;
type ReportCategory = (typeof REPORT_CATEGORIES)[number];

const REPORT_DESC_MAX = 280;

// Single TTL, deliberately NOT split by verification status. Confirmation is
// recomputed on every read, so a status-dependent TTL makes reports blink out
// and back in as hotspots age past the window — worse than either duration.
const REPORT_TTL_SECONDS = 86_400;          // 24 h — read filter
const REPORT_DELETE_AFTER_SECONDS = 172_800; // 48 h — cron delete, deliberately looser

// Cross-check thresholds. Set EXPLICITLY here and never inherited from a fetch
// window: CONUS caches days=2, so inheriting would let 48 h-old detections
// confirm a fresh report.
//
// X = 5 km. Error budget: VIIRS pixel 0.375 km at nadir → ~0.8 km at swath
// edge, geolocation ±0.4 km, and the dominant term is a human picking a point
// for a fire seen from a distance (1–2 km is ordinary). Tighter rejects real
// matches.
//
// Y = 12 h. Covers a full worst-case overpass gap, so a report made between
// passes still matches the last detection — while refusing to confirm fresh
// smoke against yesterday's fire, which may be out. That would be a false
// confirmation, and Invariant V requires the label to mean something precise.
const REPORT_XCHECK_RADIUS_KM = 5;
const REPORT_XCHECK_MAX_HOTSPOT_AGE_MIN = 720;

// Rate limiting. Per-source counter lives in KV under a SALTED digest with a
// 10-minute TTL; the global breaker bounds a distributed flood.
const REPORT_RL_WINDOW_SECONDS = 600;
const REPORT_RL_MAX_PER_WINDOW = 5;
const REPORT_RL_GLOBAL_MAX_PER_HOUR = 200;

const REPORTS_DISCLAIMER: Record<'en' | 'vi', string> = {
  en:
    'Community reports submitted by members of the public. Not official information, ' +
    'not verified identities, and not a substitute for HIEMA, County Emergency ' +
    'Management, or NWS. "Satellite-confirmed" means only that a NASA FIRMS wildfire ' +
    'detection exists nearby — it does not verify what the report describes.',
  vi:
    'Báo cáo do người dân gửi. Không phải thông tin chính thức, không xác minh danh ' +
    'tính người gửi, và không thay thế HIEMA, Quản lý Khẩn cấp Quận, hay NWS. ' +
    '"Vệ tinh xác nhận" chỉ có nghĩa là có điểm cháy NASA FIRMS ở gần — không xác ' +
    'nhận nội dung mô tả.',
};

// FIRMS gives acq_date "YYYY-MM-DD" + acq_time "HHMM" in UTC. Nothing in this
// file converted that to an instant before P08. Returns null rather than a
// wrong number when either field is malformed (Invariant III).
function firmsAcqEpochSeconds(acqDate: string, acqTime: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(acqDate)) return null;
  const t = (acqTime || '').padStart(4, '0');
  if (!/^\d{4}$/.test(t)) return null;
  const hh = Number(t.slice(0, 2));
  const mm = Number(t.slice(2, 4));
  if (hh > 23 || mm > 59) return null;
  const ms = Date.parse(`${acqDate}T${t.slice(0, 2)}:${t.slice(2, 4)}:00Z`);
  return isFinite(ms) ? Math.floor(ms / 1000) : null;
}

// Which coverage area a point falls in, or null if we do not serve it.
// Reports outside both are rejected at write time rather than stored and
// silently never displayed.
function reportRegionFor(lon: number, lat: number): 'hawaii' | 'conus' | null {
  const inBox = (b: readonly [number, number, number, number]) =>
    lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
  if (inBox(REGION_BBOXES.hawaii)) return 'hawaii';
  if (inBox(REGION_BBOXES.usa)) return 'conus';
  return null;
}

// Plain text only. The description is stored as text and MUST never be
// re-emitted as HTML — P09 renders it as a text node. Stripping control
// characters here keeps the stored value clean regardless.
function sanitizeReportDescription(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, REPORT_DESC_MAX);
}

type ReportVerification = {
  status: 'satellite_confirmed' | 'unverified';
  nearest_hotspot_km: number | null;
  hotspot_age_minutes: number | null;
};

// Cross-check ONE report against wildland hotspots.
//
// `hotspots` must be FirmsIngest.hotspots — the wildland set. FirmsIngest
// already separates volcanic detections into `volcanic_hotspots` via
// inVolcanicZone(), so a Kīlauea thermal anomaly is structurally incapable of
// confirming a Kaʻū smoke report. That exclusion is inherited, not re-derived.
function crossCheckReport(
  lat: number,
  lon: number,
  hotspots: readonly FirmsHotspot[],
  nowSeconds: number,
): ReportVerification {
  let bestKm: number | null = null;
  let bestAgeMin: number | null = null;

  for (const h of hotspots) {
    const km = haversineKm(lon, lat, h.lon, h.lat);
    if (km > REPORT_XCHECK_RADIUS_KM) continue;

    const acq = firmsAcqEpochSeconds(h.acq_date, h.acq_time);
    // Unparseable timestamp cannot be aged, so it cannot confirm. Dropped,
    // never assumed fresh (Invariant III).
    if (acq === null) continue;

    const ageMin = Math.floor((nowSeconds - acq) / 60);
    if (ageMin < 0 || ageMin > REPORT_XCHECK_MAX_HOTSPOT_AGE_MIN) continue;

    if (bestKm === null || km < bestKm) {
      bestKm = km;
      bestAgeMin = ageMin;
    }
  }

  if (bestKm === null) {
    return { status: 'unverified', nearest_hotspot_km: null, hotspot_age_minutes: null };
  }
  return {
    status: 'satellite_confirmed',
    nearest_hotspot_km: Math.round(bestKm * 100) / 100,
    hotspot_age_minutes: bestAgeMin,
  };
}

// Initial great-circle bearing FROM point 1 TO point 2, degrees clockwise from
// true north, normalised to [0,360).
function bearingDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// ── Grid ───────────────────────────────────────────────────────────────────
// 0.02° ≈ 2.2 km N-S, ≈ 2.1 km E-W at 20.8°N. Maui yields 40 × 30 = 1200 cells.
const FIRE_DANGER_GRID_STEP_DEG = 0.02;
const FIRE_DANGER_MAX_CELLS = 1500;

type GridCell = { cell_id: string; centroid: [number, number] };

// Coarsens the step rather than truncating the grid, so a larger region returns
// full coverage at lower resolution instead of a silently clipped map.
function buildGrid(
  bbox: readonly [number, number, number, number],
  stepDeg: number,
): { cells: GridCell[]; stepUsed: number } {
  const [west, south, east, north] = bbox;
  let step = stepDeg;
  let cols = Math.max(1, Math.round((east - west) / step));
  let rows = Math.max(1, Math.round((north - south) / step));

  while (cols * rows > FIRE_DANGER_MAX_CELLS) {
    step *= 1.25;
    cols = Math.max(1, Math.round((east - west) / step));
    rows = Math.max(1, Math.round((north - south) / step));
  }

  const cells: GridCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        cell_id: `r${r}c${c}`,
        centroid: [
          Number((west + (c + 0.5) * step).toFixed(5)),
          Number((south + (r + 0.5) * step).toFixed(5)),
        ],
      });
    }
  }
  return { cells, stepUsed: Number(step.toFixed(5)) };
}

// ── Heuristic constants — few, visible, and tuned for Hawaiʻi grass fire ────
// Proximity: a VIIRS pixel is 375 m, so ≤2 km means the cell is effectively at
// the fire edge. 20 km is about the far end of a wind-driven Hawaiʻi grass-fire
// run within one detection cycle; past it proximity carries no signal.
const PROX_FULL_KM = 2;
const PROX_ZERO_KM = 20;

// Downwind: a cell counts as downwind when the hotspot→cell bearing falls
// within ±45° of the direction the wind is blowing TOWARD.
const DOWNWIND_HALF_ANGLE_DEG = 45;
// Boost scales with speed then saturates — 40 mph is not four times as
// dangerous as 10 mph in a term that already multiplies proximity.
const WIND_BOOST_MAX = 1.6;
const WIND_SATURATION_MPH = 35;

// Dry is dangerous. Neutral at/above 60% RH, maximum at/below 20% RH — roughly
// Hawaiʻi leeward Red-Flag territory.
const RH_NEUTRAL_PCT = 60;
const RH_CRITICAL_PCT = 20;
const HUMIDITY_BOOST_MAX = 1.3;

// MAGNITUDE VALIDATION — measured 2026-08-04 against six real western megafire
// clusters via live NWS gridpoint forecasts (Utah 1510 hotspots/708 MW,
// Washington 1403/224 and 1086/346, Oregon-Idaho 779/222, Oregon 261/834 and
// 595/114):
//     observed wind 3.5-11.5 mph, RH 23-44%
//     humidityMult reached 1.278 (Utah, RH 23%) vs a FLAT 1.000 in Hawaiʻi,
//     where RH 71-95% never crosses RH_NEUTRAL_PCT and the term never engages.
//     Effective-distance reduction up to 30.1%, vs 12.7% in Hawaiʻi.
// So the HUMIDITY limb is now exercised under genuinely dry conditions for the
// first time. The WIND limb is NOT: at 3.5-11.5 mph against the 35 mph
// saturation, directional separation was only +0.025 to +0.077 at 10 km —
// comparable to Hawaiʻi's +0.071. High-wind behaviour and a Hawaiʻi-terrain Red
// Flag day both remain unvalidated.

// COMPOSITION — why the boosts act on DISTANCE, not on the score (Stage 1.1).
// The obvious form, score = clamp01(proximity × wind × humidity), multiplies a
// [0,1] proximity base by two >1 boosts, so the product clamps whenever
//     proximity ≥ 1 / (WIND_BOOST_MAX × HUMIDITY_BOOST_MAX) = 1/2.08 = 0.481
// — every cell within ~11.3 km of a hotspot under dry, downwind conditions.
// Measured 2026-08-02: that pinned upwind AND downwind cells alike to EXTREME
// across the whole near field, which both inflates severity and erases the
// directional signal this layer exists to provide.
//
// Instead the boosts shorten the EFFECTIVE distance:
//     effective_km = km / (windMult × humidityMult)
// A downwind, dry cell behaves as though the fire were nearer, which is also
// the physically honest reading. Neutral inputs (both multipliers 1.0, or
// null wind/RH) leave effective_km === km exactly, so a missing input can
// never manufacture danger. The result cannot saturate: proximity stays a
// strictly decreasing function of distance at every range.

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function proximityTerm(km: number | null): number {
  if (km === null || !isFinite(km)) return 0;
  if (km <= PROX_FULL_KM) return 1;
  if (km >= PROX_ZERO_KM) return 0;
  return 1 - (km - PROX_FULL_KM) / (PROX_ZERO_KM - PROX_FULL_KM);
}

// NWS reports the direction wind comes FROM, so the direction it blows TOWARD
// is +180°. Getting this backwards would point the danger upwind — the single
// easiest way to make this layer actively harmful.
function windTerm(
  hotspotToCellBearing: number,
  windDirDeg: number | null,
  windMph: number | null,
): { term: number; downwind: boolean } {
  if (windDirDeg === null || windMph === null || windMph <= 0) {
    return { term: 1, downwind: false };
  }
  const blowingToward = (windDirDeg + 180) % 360;
  let delta = Math.abs(hotspotToCellBearing - blowingToward);
  if (delta > 180) delta = 360 - delta;
  if (delta > DOWNWIND_HALF_ANGLE_DEG) return { term: 1, downwind: false };

  const alignment = 1 - delta / DOWNWIND_HALF_ANGLE_DEG;   // 1 dead downwind → 0 at the edge
  const speedFactor = Math.min(1, windMph / WIND_SATURATION_MPH);
  return { term: 1 + (WIND_BOOST_MAX - 1) * alignment * speedFactor, downwind: true };
}

function humidityTerm(rhPct: number | null): number {
  if (rhPct === null) return 1;
  if (rhPct >= RH_NEUTRAL_PCT) return 1;
  const dryness = Math.min(1, (RH_NEUTRAL_PCT - rhPct) / (RH_NEUTRAL_PCT - RH_CRITICAL_PCT));
  return 1 + (HUMIDITY_BOOST_MAX - 1) * dryness;
}

function bandFor(score: number): string {
  if (score <= 0) return 'NONE';
  if (score < 0.25) return 'LOW';
  if (score < 0.5) return 'MODERATE';
  if (score < 0.75) return 'HIGH';
  return 'EXTREME';
}

// Nearest station that actually carries the field we need. Wind and RH are
// resolved independently so a wind-only station still contributes wind.
function nearestReading(
  lon: number,
  lat: number,
  readings: StationReading[],
): StationReading | null {
  let best: StationReading | null = null;
  let bestKm = Infinity;
  for (const r of readings) {
    const km = haversineKm(lon, lat, r.lon, r.lat);
    if (km < bestKm) {
      bestKm = km;
      best = r;
    }
  }
  return best;
}

const FIRE_DANGER_STALE_AFTER_SECONDS = 1800;

const FIRE_DANGER_LATENCY_NOTE =
  'FIRMS detections for Hawaiʻi arrive via the Honolulu real-time direct-broadcast ' +
  'station, typically 20–30 minutes after satellite overpass. Not near-instant detection.';

const FIRE_DANGER_DISCLAIMER =
  'Estimated fire-spread concern — model output for situational awareness only, not an ' +
  'official fire-behavior forecast. Follow HIEMA, County Emergency Management, and NWS ' +
  'for official guidance.';

// Honest, specific coverage disclosure. These three gaps were measured on
// 2026-08-02 by probing every station inside every island bbox — they are not
// theoretical. Surfaced in the envelope so the client can repeat them to users
// rather than implying uniform coverage.
const FIRE_DANGER_COVERAGE_NOTE =
  'Coverage gaps: Kauaʻi south shore (Poʻipū) has no live weather station, so south-shore ' +
  'estimates use Waimea or Līhuʻe-area wind. East Maui (Hāna) has no live station, so east ' +
  'Maui uses upcountry or central Maui wind. Niʻihau and Kahoʻolawe have no weather station ' +
  'at all — those estimates use fire distance only, with no wind or humidity adjustment.';

const FIRE_DANGER_CONDITIONS_NOTE =
  'Wind and humidity are point observations from the nearest NWS/MECO station, not ' +
  'per-cell measurements. Terrain between a station and a cell can change conditions ' +
  'substantially — West Maui leeward wind in particular differs from Kahului.';

// Stage 1. ALWAYS HTTP 200 with a valid envelope (Invariant II).
// Invariant IV: consumes no user location, computes nothing per-user, logs and
// stores nothing identifying. The grid is fixed, public, and identical for
// every caller.
// Score one island against the SHARED statewide hotspot set. `omitNone` drops
// NONE cells (statewide mode) — the client discards them anyway, and keeping
// them would make a calm statewide payload ~1 MB of "nothing to report".
function buildIslandResult(
  spec: IslandSpec,
  firms: FirmsIngest,
  nws: NwsConditions,
  omitNone: boolean,
) {
  const firmsOk = firms.health === 'ok';

  const windReadings = nws.readings.filter((r) => r.wind_mph !== null && r.wind_dir_deg !== null);
  const rhReadings = nws.readings.filter((r) => r.rh_pct !== null);

  const degradedInputs: string[] = [];
  if (windReadings.length === 0) degradedInputs.push('wind');
  if (rhReadings.length === 0) degradedInputs.push('humidity');

  const { cells: grid, stepUsed } = buildGrid(spec.bbox, spec.step);

  let noneCount = 0;
  const drivingHotspots = new Set<number>();
  const cells = grid.map((cell) => {
    const [lon, lat] = cell.centroid;
    const windSrc = nearestReading(lon, lat, windReadings);
    const rhSrc = nearestReading(lon, lat, rhReadings);
    const windMph = windSrc?.wind_mph ?? null;
    const windDir = windSrc?.wind_dir_deg ?? null;
    const rhPct = rhSrc?.rh_pct ?? null;

    if (!firmsOk) {
      // Detection unavailable → we cannot speak to fire proximity at all.
      return {
        cell_id: cell.cell_id,
        centroid: cell.centroid,
        danger_level: 'insufficient_data',
        score: null,
        reason: {
          nearest_hotspot_km: null,
          downwind: null,
          wind_mph: windMph === null ? null : Number(windMph.toFixed(1)),
          wind_dir_deg: windDir,
          rh_pct: rhPct === null ? null : Number(rhPct.toFixed(1)),
          wind_station: windSrc?.station_id ?? null,
          rh_station: rhSrc?.station_id ?? null,
        },
      };
    }

    // Nearest hotspot by great-circle distance. `firms.hotspots` is WILDLAND
    // ONLY — volcanic detections never enter this loop.
    let nearestKm: number | null = null;
    let nearestBearing = 0;
    let nearestIdx = -1;
    for (let hi = 0; hi < firms.hotspots.length; hi++) {
      const h = firms.hotspots[hi];
      const km = haversineKm(lon, lat, h.lon, h.lat);
      if (nearestKm === null || km < nearestKm) {
        nearestKm = km;
        nearestBearing = bearingDeg(h.lon, h.lat, lon, lat);
        nearestIdx = hi;
      }
    }

    const { term: wTerm, downwind } = windTerm(nearestBearing, windDir, windMph);
    const hTerm = humidityTerm(rhPct);
    // Boosts shorten the effective distance rather than inflating the score —
    // see the COMPOSITION note above. Neutral multipliers are exactly 1.0, so
    // effectiveKm === nearestKm when wind/RH are absent.
    const effectiveKm = nearestKm === null ? null : nearestKm / (wTerm * hTerm);
    const score = clamp01(proximityTerm(effectiveKm));
    const band = bandFor(score);
    if (band === 'NONE') noneCount++;
    // ATTRIBUTION, not partition: record which hotspot actually produced shading
    // on THIS island. A hotspot within the 20 km radius of two islands (Maui W ↔
    // Lānaʻi E is 4.7 km) is legitimately counted by both, so per-island counts
    // can sum to MORE than the statewide total. That is correct — hence the copy
    // says "affecting <island>", never "on <island>".
    else if (nearestIdx >= 0) drivingHotspots.add(nearestIdx);

    return {
      cell_id: cell.cell_id,
      centroid: cell.centroid,
      danger_level: band,
      score: Number(score.toFixed(3)),
      reason: {
        nearest_hotspot_km: nearestKm === null ? null : Number(nearestKm.toFixed(2)),
        // Wind/humidity-adjusted distance actually scored. Equals
        // nearest_hotspot_km when both inputs are neutral or absent.
        effective_km: effectiveKm === null ? null : Number(effectiveKm.toFixed(2)),
        downwind: nearestKm === null ? false : downwind,
        wind_mph: windMph === null ? null : Number(windMph.toFixed(1)),
        wind_dir_deg: windDir,
        rh_pct: rhPct === null ? null : Number(rhPct.toFixed(1)),
        wind_station: windSrc?.station_id ?? null,
        rh_station: rhSrc?.station_id ?? null,
      },
    };
  });

  // cell_count always reports the FULL grid, even when NONE cells are omitted,
  // so the count never silently shrinks.
  const emitted = omitNone ? cells.filter((c) => c.danger_level !== 'NONE') : cells;

  return {
    island: spec.key,
    label: spec.label,
    grid: { step_deg: stepUsed, cell_count: grid.length, bbox: spec.bbox },
    none_cell_count: noneCount,
    // Wildland detections DRIVING this island's shading — an attribution, not a
    // partition (see the note in the cell loop). Sums across islands may exceed
    // the top-level statewide hotspot_count.
    hotspot_count: drivingHotspots.size,
    // Volcanic detections INSIDE this island's bbox. Different definition on
    // purpose: volcanic hotspots are excluded from scoring, so they drive no
    // cells and "driving" is undefined for them. Bbox membership is the only
    // meaningful attribution.
    volcanic_hotspot_count: firms.volcanic_hotspots.filter(
      (h) => h.lon >= spec.bbox[0] && h.lon <= spec.bbox[2] && h.lat >= spec.bbox[1] && h.lat <= spec.bbox[3],
    ).length,
    degraded_inputs: degradedInputs,
    stations_used: nws.readings.map((r) => ({
      id: r.station_id,
      name: r.station_name,
      observed_at: r.observed_at,
      has_wind: r.wind_mph !== null,
      has_humidity: r.rh_pct !== null,
    })),
    cells: emitted,
  };
}

async function handleFireDanger(url: URL, env: Env, cors: CorsHeaders): Promise<Response> {
  const nowMs = Date.now();
  const generatedAt = new Date(nowMs).toISOString();

  const requested = (url.searchParams.get('region') || 'maui').toLowerCase();
  const statewide = requested === 'statewide' || requested === 'hawaii-statewide';
  // CONUS is a structurally different model (hotspot-anchored patches, not a
  // fixed grid) with its own envelope, so it branches out entirely rather than
  // threading a flag through the island code.
  if (requested === 'conus') return handleFireDangerConus(env, cors);
  const single = FIRE_DANGER_ISLANDS.find((i) => i.key === requested);
  // Unknown region falls back to Maui, matching P04.
  const targets: readonly IslandSpec[] = statewide
    ? FIRE_DANGER_ISLANDS
    : [single ?? FIRE_DANGER_ISLANDS.find((i) => i.key === 'maui')!];
  const region = statewide ? 'statewide' : targets[0].key;

  // Union of the stations the targeted islands need, de-duplicated (PHOG is
  // shared) so a station is fetched at most once per request.
  const stationMap = new Map<string, NwsStation>();
  for (const t of targets) for (const s of ISLAND_STATIONS[t.key]) stationMap.set(s.id, s);
  const stations = [...stationMap.values()];

  // ONE statewide FIRMS query regardless of how many islands are requested —
  // see FIRE_DANGER_STATEWIDE_BBOX for why this is a correctness requirement.
  // Neither helper rejects by design; allSettled is belt-and-braces so a
  // surprise throw in one upstream can never take out the other.
  // SEQUENTIAL ON PURPOSE — do not "optimise" this back into one allSettled.
  //
  // Cloudflare Workers cap simultaneous outbound connections at 6 per request;
  // excess fetches QUEUE, and AbortSignal.timeout() counts queue time, not just
  // transfer time. Running FIRMS alongside the station fan-out meant statewide
  // issued 3 + 20 = 23 concurrent fetches, so the three FIRMS calls could sit
  // behind slow NWS requests and die queued at 8s.
  //
  // Measured 2026-08-04, cold cache: single islands (3 + 1-5 fetches) were all
  // FRESH while statewide returned sensors_used: [] at the same moment — same
  // fetchFirmsMultiSensor call, same arguments, only the station count differed.
  // handleFireDangerConus never showed this because it already awaits FIRMS
  // before fetching weather; this path now matches it by construction.
  //
  // FIRMS first: it is the fail-closed input (health drives the band), so it must
  // never lose a race to weather, which only ever adjusts an existing score.
  const firmsSettled = (await Promise.allSettled([
    fetchFirmsMultiSensor(env, FIRE_DANGER_STATEWIDE_BBOX, 1),
  ]))[0];
  const nwsSettled = (await Promise.allSettled([
    fetchNwsConditions(stations, nowMs),
  ]))[0];

  const firms: FirmsIngest =
    firmsSettled.status === 'fulfilled'
      ? firmsSettled.value
      : { hotspots: [], volcanic_count: 0, volcanic_hotspots: [], health: 'degraded', sensors_used: [] };
  const nwsAll: NwsConditions =
    nwsSettled.status === 'fulfilled' ? nwsSettled.value : { readings: [], health: 'degraded' };

  const firmsOk = firms.health === 'ok';

  // Per-island scoring is isolated: one island throwing degrades only itself.
  const perIsland = await Promise.allSettled(
    targets.map(async (spec) => {
      // Each island sees ONLY its own stations — a Kauaʻi cell must never
      // inherit Kahului wind. Islands with no station (Niʻihau, Kahoʻolawe)
      // get an empty set and fall through to neutral multipliers.
      const ids = new Set(ISLAND_STATIONS[spec.key].map((s) => s.id));
      const islandNws: NwsConditions = {
        readings: nwsAll.readings.filter((r) => ids.has(r.station_id)),
        health: nwsAll.readings.some((r) => ids.has(r.station_id)) ? 'ok' : 'degraded',
      };
      return buildIslandResult(spec, firms, islandNws, statewide);
    }),
  );

  const islands = perIsland
    .map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : {
            // Island-level failure is still a valid, renderable island entry.
            // Shape must match the success case field-for-field — this literal
            // is not type-checked against buildIslandResult's return, so a
            // missing key here would surface as `undefined` in the client.
            island: targets[i].key,
            label: targets[i].label,
            grid: { step_deg: targets[i].step, cell_count: 0, bbox: targets[i].bbox },
            none_cell_count: 0,
            hotspot_count: 0,
            volcanic_hotspot_count: 0,
            degraded_inputs: ['wind', 'humidity'],
            stations_used: [],
            cells: [],
          },
    );

  // An island with no configured station set has no weather station in
  // EXISTENCE — Niʻihau is privately held, Kahoʻolawe is uninhabited. Their
  // permanent lack of wind/RH is a COVERAGE fact, not a freshness signal.
  // Folding it into `freshness` pinned the statewide envelope to STALE_OK
  // forever on completely healthy data, which teaches residents to ignore the
  // freshness label — destroying the signal the label exists to carry. So
  // freshness is computed over instrumented islands only, and the structural
  // gap is reported separately via `uninstrumented_islands`.
  // Per-island `degraded_inputs` is deliberately UNCHANGED, so the gap stays
  // visible exactly where it belongs.
  const uninstrumented = targets
    .filter((t) => ISLAND_STATIONS[t.key].length === 0)
    .map((t) => t.key);
  const instrumented = islands.filter((i) => !uninstrumented.includes(i.island as IslandKey));
  const anyDegradedInputs = instrumented.some((i) => i.degraded_inputs.length > 0);
  const freshness = !firmsOk ? 'DEGRADED' : anyDegradedInputs ? 'STALE_OK' : 'FRESH';

  const shared = {
    generated_at: generatedAt,
    stale_after_seconds: FIRE_DANGER_STALE_AFTER_SECONDS,
    freshness,
    region,
    sensors_used: firms.sensors_used,
    // WILDLAND detections only — this is the number that drives the scoring.
    hotspot_count: firms.hotspots.length,
    // Volcanic thermal anomalies inside Layer A's VOLCANIC_ZONES. Excluded from
    // the spread model (lava does not advect downwind) but REPORTED so the
    // client can name them and route users to USGS HVO instead of silently
    // dropping detections that genuinely exist.
    volcanic_hotspot_count: firms.volcanic_count,
    source_health: { firms: firms.health, nws: nwsAll.health },
    // Structural coverage gap, NOT a data-quality problem: no weather station
    // exists on these islands, so their cells are scored on fire distance alone.
    uninstrumented_islands: uninstrumented,
    conditions_note: FIRE_DANGER_CONDITIONS_NOTE,
    coverage_note: FIRE_DANGER_COVERAGE_NOTE,
    latency_note: FIRE_DANGER_LATENCY_NOTE,
    disclaimer: FIRE_DANGER_DISCLAIMER,
  };

  const headers = { ...cors, 'Cache-Control': firmsOk ? 'public, max-age=300' : 'no-store' };

  if (statewide) {
    return jsonResp({ ...shared, islands }, 200, headers);
  }

  // Single-island response keeps P04's FLAT shape exactly: grid/degraded_inputs/
  // stations_used/cells at the top level, all cells included. Existing clients
  // (and `region=maui`) see an unchanged envelope.
  const only = islands[0];
  return jsonResp(
    {
      ...shared,
      degraded_inputs: only.degraded_inputs,
      grid: only.grid,
      stations_used: only.stations_used,
      cells: only.cells,
    },
    200,
    headers,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// P24 · CONUS FIRE-SPREAD DANGER — hotspot-anchored patches
//
// Architecturally INVERTED from the Hawaiʻi layer. A pre-computed CONUS grid at
// any useful resolution is millions of cells; instead we cluster detections and
// generate a small local patch around each cluster. Calm day → zero patches.
//
// Everything here lives BESIDE the Hawaiʻi paths and shares only pure helpers
// (haversineKm, bearingDeg, proximityTerm, windTerm, humidityTerm, bandFor).
// region=maui and region=statewide are untouched.
//
// ── MEASURED 2026-08-04, and the numbers drove the design ──────────────────
// days=1 over the western US returned ZERO detections — the FIRMS UTC-day
// window can be hours empty — while WFIGS listed 475 active CONUS incidents
// including multiple >300k-acre fires. days=1 CONUS surfaced 610 detections of
// which exactly ONE was west of -100°; the other 609 were persistent industrial
// heat (Gary/E. Chicago steel, Pittsburgh, Cleveland, Sarnia refineries, Port
// Arthur flares, a Gulf oil platform), FRP ceiling 38 MW.
// days=2 surfaces the real fire signal: FRP up to 1580 MW in the west.
// Hence FIRE_DANGER_CONUS_DAYS = 2. This is NOT a copy of Hawaiʻi's days=1.
const FIRE_DANGER_CONUS_DAYS = 2;

// CONUS is split into quadrants because a single bbox query blows past the
// FIRMS 5000-record cap: at days=2 both NOAA-20 and NOAA-21 returned exactly
// 5000 (truncated, silently). Four sub-bboxes keep each query under the cap.
//
// RATE-LIMIT MATH (budget is 5000 transactions / 10 min):
//   3 sensors × 4 sub-bboxes = 12 transactions per COLD refresh.
//   With FIRE_DANGER_FIRMS_TTL = 600 s that is at most 6 cold refreshes/hour
//   = 72 transactions/hour ≈ 2% of the ceiling. Comfortably clear.
const CONUS_SUB_BBOXES: ReadonlyArray<[number, number, number, number]> = [
  [-125.0, 24.0, -95.75, 36.75],   // SW
  [-95.75, 24.0, -66.5, 36.75],    // SE
  [-125.0, 36.75, -95.75, 49.5],   // NW
  [-95.75, 36.75, -66.5, 49.5],    // NE
];

// Single-linkage distance for grouping detections into one "fire".
const CONUS_CLUSTER_RADIUS_KM = 10;
// Worker budget cap. At ~65-80 cells per patch this is ~2600-3200 cells worst
// case, comparable to the statewide Hawaiʻi envelope once NONE cells are
// omitted.
const CONUS_MAX_CLUSTERS = 40;
// FLOOR RULE: a cluster this large is ALWAYS assessed regardless of FRP rank.
// FRP is an instantaneous radiative-power snapshot at overpass; a Gila-scale
// megacluster can read low if the overpass caught it between flare-ups, and it
// must never drop out of the assessed set for that reason.
const CONUS_ALWAYS_ASSESS_MIN_HOTSPOTS = 20;
// ABSOLUTE ceiling. The floor rule above is uncapped by design, so in peak fire
// season the assessed set would otherwise grow without bound — every cluster of
// >=20 hotspots qualifying, at ~95 cells each. This caps total work at ~80
// patches (~7600 cells) no matter how many clusters qualify. If the floor set
// ALONE exceeds this, floor clusters are ranked by hotspot count and cut there,
// so the largest fires survive; unassessed_cluster_count absorbs the remainder
// and the card states the real numbers.
const CONUS_ABSOLUTE_MAX_CLUSTERS = 80;
// ~4.4 km cells — coarser than Hawaiʻi's 0.02° because a CONUS patch covers a
// 20 km radius and the model's own resolution does not justify finer.
const CONUS_PATCH_STEP_DEG = 0.04;

// v1 RANKING HEURISTIC — deliberately simple and deliberately documented.
// Rank by max FRP (intensity), tie-break by hotspot count (extent), with the
// floor rule above. POPULATION WEIGHTING IS FUTURE WORK: a 5 MW fire upwind of
// a town matters more than a 500 MW fire in wilderness, and this v1 cannot see
// that. Stated here so the limitation is a known choice, not an oversight.
type ConusCluster = {
  hotspots: FirmsHotspot[];
  lon: number;
  lat: number;
  maxFrp: number;
};

// O(n) spatial-bucket clustering. Pairwise would be O(n²) — at the ~10k
// detections CONUS returns at days=2 that is 100M distance computations and
// would blow the Worker CPU budget.
function clusterHotspots(hotspots: FirmsHotspot[], radiusKm: number): ConusCluster[] {
  const cell = radiusKm / 111; // degrees, approximate — only used for bucketing
  const buckets = new Map<string, number[]>();
  const key = (lon: number, lat: number) => `${Math.floor(lon / cell)},${Math.floor(lat / cell)}`;
  hotspots.forEach((h, i) => {
    const k = key(h.lon, h.lat);
    const b = buckets.get(k);
    if (b) b.push(i); else buckets.set(k, [i]);
  });

  const seen = new Array(hotspots.length).fill(false);
  const out: ConusCluster[] = [];
  for (let i = 0; i < hotspots.length; i++) {
    if (seen[i]) continue;
    seen[i] = true;
    const stack = [i];
    const members: FirmsHotspot[] = [];
    while (stack.length) {
      const j = stack.pop() as number;
      const hj = hotspots[j];
      members.push(hj);
      // Only the 3×3 neighbourhood can contain a point within radiusKm.
      const bx = Math.floor(hj.lon / cell);
      const by = Math.floor(hj.lat / cell);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nb = buckets.get(`${bx + dx},${by + dy}`);
          if (!nb) continue;
          for (const k of nb) {
            if (seen[k]) continue;
            if (haversineKm(hj.lon, hj.lat, hotspots[k].lon, hotspots[k].lat) <= radiusKm) {
              seen[k] = true;
              stack.push(k);
            }
          }
        }
      }
    }
    let lon = 0, lat = 0, maxFrp = 0;
    for (const m of members) { lon += m.lon; lat += m.lat; if (m.frp > maxFrp) maxFrp = m.frp; }
    out.push({ hotspots: members, lon: lon / members.length, lat: lat / members.length, maxFrp });
  }
  return out;
}

// Pick a small spatially-REPRESENTATIVE sample of a cluster's detections.
//
// The client anchors a CONUS patch with a marker; until now that was the
// cluster CENTROID — the arithmetic mean of up to ~1500 detections, which for an
// elongated complex can sit in unburned ground. These are real detections
// instead, so the anchor becomes literally true rather than a labelled
// approximation.
//
// Selection is GRID-BUCKET, not first-N and not top-FRP: the cluster bbox is
// split into a sqrt(max) x sqrt(max) grid and the highest-FRP detection in each
// occupied bucket is taken. That spreads the sample across the real footprint
// while still favouring the most intense detection locally. Measured against the
// 1510-detection cluster (an 18 x 28 km complex): mean distance from a real
// detection to its nearest sample was 1.8 km for grid-bucket versus 3.7 km for
// first-N and 3.8 km for top-FRP — roughly twice the coverage, with one fewer
// point. O(n), single pass, no sorting of the full set.
const CONUS_REPRESENTATIVE_HOTSPOTS = 20;

function pickRepresentativeHotspots(
  hotspots: readonly FirmsHotspot[],
  max: number,
): Array<[number, number]> {
  if (hotspots.length <= max) return hotspots.map((h) => [h.lon, h.lat]);
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const h of hotspots) {
    if (h.lon < minLon) minLon = h.lon;
    if (h.lon > maxLon) maxLon = h.lon;
    if (h.lat < minLat) minLat = h.lat;
    if (h.lat > maxLat) maxLat = h.lat;
  }
  // Guard a degenerate (zero-width) footprint so the bucket maths cannot divide
  // by zero — a tight cluster is legitimate, not an error.
  const w = (maxLon - minLon) || 1e-6;
  const h = (maxLat - minLat) || 1e-6;
  const n = Math.max(1, Math.ceil(Math.sqrt(max)));
  const best = new Map<string, FirmsHotspot>();
  for (const p of hotspots) {
    const gx = Math.min(n - 1, Math.floor(((p.lon - minLon) / w) * n));
    const gy = Math.min(n - 1, Math.floor(((p.lat - minLat) / h) * n));
    const key = `${gx},${gy}`;
    const cur = best.get(key);
    if (!cur || p.frp > cur.frp) best.set(key, p);
  }
  return [...best.values()]
    .sort((a, b) => b.frp - a.frp)
    .slice(0, max)
    .map((p) => [Number(p.lon.toFixed(5)), Number(p.lat.toFixed(5))] as [number, number]);
}

// Fetch CONUS detections across all sub-bboxes × sensors. Same fail-closed
// contract as fetchFirmsMultiSensor: never throws, returns a health flag.
// Volcanic tagging still applies (Layer A geometry is Hawaiʻi-only, so it is a
// no-op here, but the field is populated consistently).
async function fetchFirmsConus(env: Env): Promise<FirmsIngest> {
  if (!env.NASA_FIRMS_MAP_KEY) {
    return { hotspots: [], volcanic_count: 0, volcanic_hotspots: [], health: 'unconfigured', sensors_used: [] };
  }
  const cache = caches.default;
  const jobs: Array<{ sensor: string; bbox: readonly number[] }> = [];
  for (const sensor of FIRE_DANGER_SENSORS) for (const bbox of CONUS_SUB_BBOXES) jobs.push({ sensor, bbox });

  // 12 jobs (3 sensors x 4 sub-bboxes) — also past the cap.
  const settled = await mapWithConcurrency(jobs, OUTBOUND_CONCURRENCY_LIMIT, async ({ sensor, bbox }) => {
    const cacheReq = new Request(fireDangerFirmsCacheKey(sensor, bbox, FIRE_DANGER_CONUS_DAYS));
    const cached = await cache.match(cacheReq);
    if (cached) return { sensor, csv: await cached.text() };
    const upstream =
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${env.NASA_FIRMS_MAP_KEY}` +
      `/${sensor}/${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}/${FIRE_DANGER_CONUS_DAYS}`;
    const res = await fetch(upstream, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const csv = await res.text();
    await cache.put(cacheReq, new Response(csv, {
      headers: { 'Content-Type': 'text/csv', 'Cache-Control': `public, max-age=${FIRE_DANGER_FIRMS_TTL}` },
    }));
    return { sensor, csv };
  });

  const merged: FirmsHotspot[] = [];
  const sensorsUsed = new Set<string>();
  settled.forEach((r, i) => {
    if (r.status !== 'fulfilled') {
      console.warn(JSON.stringify({ layer: 'fire-danger-conus', stage: 'firms', sensor: jobs[i].sensor, dropped: true }));
      return;
    }
    sensorsUsed.add(jobs[i].sensor);
    merged.push(...parseFirmsCsv(r.value.csv, jobs[i].sensor));
  });

  if (sensorsUsed.size === 0) {
    return { hotspots: [], volcanic_count: 0, volcanic_hotspots: [], health: 'degraded', sensors_used: [] };
  }
  const deduped = dedupeHotspots(merged);
  const wildland = deduped.filter((h) => !h.volcanic);
  const volcanic = deduped.filter((h) => h.volcanic);
  return {
    hotspots: wildland,
    volcanic_count: volcanic.length,
    volcanic_hotspots: volcanic,
    health: 'ok',
    sensors_used: [...sensorsUsed],
  };
}

// ── CONUS weather: NWS GRIDPOINT FORECAST ──────────────────────────────────
// Hawaiʻi uses station OBSERVATIONS; CONUS uses gridded FORECAST. That
// asymmetry is deliberate — there is no station within useful distance of most
// wildfires — and it is LABELLED, never blurred: the envelope carries
// weather_source and the client says so in the popup.
//
// Uses the RAW gridpoint (`forecastGridData`), not `/forecast/hourly`. Measured:
// hourly is only 26% smaller (162 KB vs 219 KB) but degrades windDirection to a
// 16-point compass STRING ("E"), losing the exact degrees the downwind test
// needs. Raw gives degree_(angle), km_h-1 and percent directly.
//
// Two-tier cache keeps the 219 KB payload off the hot path: the extracted
// three numbers are cached per rounded centroid, so a warm request never
// refetches the grid.
const CONUS_WX_TTL = 600;

// Locality is suppressed beyond this. /points always returns SOME city, but at
// 133 km (measured: a Gulf of Mexico oil platform resolving to "Venice, LA") the
// answer is technically true and practically useless. Rendering nothing beats
// rendering something misleading.
const CONUS_NEAR_MAX_KM = 80;

// Vicinity of the FIRE, derived from the fire's own coordinates — never a user's,
// and never a street address. bearing_deg is FROM THE CITY TO THE FIRE (verified
// against a computed great-circle bearing on two real clusters, matching within
// 1 degree), so the honest phrasing is "19 km ESE of Spring City, UT" — the fire
// is ESE of the town. Attaching the direction to the wrong end would invert the
// meaning, the same failure class as the wind-direction sign in the spread model.
type ConusNear = {
  city: string;
  state: string;
  distance_km: number;
  bearing_deg: number;
} | null;

type ConusWeather = {
  wind_mph: number | null;
  wind_dir_deg: number | null;
  rh_pct: number | null;
  grid_id: string | null;
  near: ConusNear;
};

// Pick the forecast period covering NOW, not blindly periods[0] — the series
// starts at 00:00 UTC and blindly taking the first entry would report hours-old
// conditions as current.
function pickGridValue(series: unknown, nowMs: number): number | null {
  const values = (series as { values?: Array<{ validTime?: string; value?: unknown }> })?.values;
  if (!Array.isArray(values)) return null;
  for (const v of values) {
    if (typeof v?.value !== 'number' || !isFinite(v.value)) continue;
    const vt = typeof v.validTime === 'string' ? v.validTime : '';
    const [startStr, dur] = vt.split('/');
    const start = Date.parse(startStr || '');
    if (!isFinite(start)) continue;
    // ISO-8601 duration, e.g. PT1H / PT6H / P1DT2H — hours are enough here.
    const h = /PT(\d+)H/.exec(dur || '');
    const d = /P(\d+)D/.exec(dur || '');
    const spanMs = ((d ? parseInt(d[1], 10) * 24 : 0) + (h ? parseInt(h[1], 10) : 1)) * 3600_000;
    if (nowMs >= start && nowMs < start + spanMs) return v.value;
  }
  return null;
}

async function fetchConusWeather(lat: number, lon: number, nowMs: number): Promise<ConusWeather> {
  const empty: ConusWeather = { wind_mph: null, wind_dir_deg: null, rh_pct: null, grid_id: null, near: null };
  // Round the centroid so nearby clusters in one fire complex share a cache entry.
  const rLat = Math.round(lat * 10) / 10;
  const rLon = Math.round(lon * 10) / 10;
  const cache = caches.default;
  const cacheReq = new Request(`https://api.weather.gov/_kahuola/fire-danger/conus-wx/${rLat},${rLon}`);
  try {
    const cached = await cache.match(cacheReq);
    if (cached) return (await cached.json()) as ConusWeather;

    const headers = { 'User-Agent': 'KahuOla/1.0 kahuola.org', Accept: 'application/geo+json' };
    const ptRes = await fetch(`https://api.weather.gov/points/${rLat},${rLon}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT), headers,
    });
    if (!ptRes.ok) throw new Error(`points ${ptRes.status}`);
    const pt = (await ptRes.json()) as { properties?: { forecastGridData?: string; gridId?: string; gridX?: number; gridY?: number } };
    const gridUrl = pt?.properties?.forecastGridData;
    if (!gridUrl) throw new Error('no gridpoint');

    // Already in the response we just fetched — previously discarded. No extra
    // upstream call. Every field must validate or the whole locality is dropped:
    // a half-parsed vicinity is worse than none.
    let near: ConusNear = null;
    const rl = (pt?.properties as { relativeLocation?: { properties?: Record<string, unknown> } })
      ?.relativeLocation?.properties;
    if (rl) {
      const city = typeof rl.city === 'string' ? rl.city.trim() : '';
      const state = typeof rl.state === 'string' ? rl.state.trim() : '';
      const dist = rl.distance as { value?: unknown; unitCode?: unknown } | undefined;
      const brg = rl.bearing as { value?: unknown; unitCode?: unknown } | undefined;
      const metres = typeof dist?.value === 'number' && dist.unitCode === 'wmoUnit:m' ? dist.value : NaN;
      const bearing = typeof brg?.value === 'number' ? brg.value : NaN;
      const km = metres / 1000;
      if (city && state && isFinite(km) && km >= 0 && km <= CONUS_NEAR_MAX_KM &&
        isFinite(bearing) && bearing >= 0 && bearing <= 360) {
        near = {
          city,
          state,
          distance_km: Number(km.toFixed(1)),
          bearing_deg: Number((((bearing % 360) + 360) % 360).toFixed(0)),
        };
      }
    }

    const gRes = await fetch(gridUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT), headers });
    if (!gRes.ok) throw new Error(`grid ${gRes.status}`);
    const g = (await gRes.json()) as { properties?: Record<string, unknown> };
    const p = g?.properties ?? {};

    const wsKmh = pickGridValue(p.windSpeed, nowMs);
    const wdDeg = pickGridValue(p.windDirection, nowMs);
    const rh = pickGridValue(p.relativeHumidity, nowMs);

    const out: ConusWeather = {
      // Gridpoint windSpeed is wmoUnit:km_h-1 (verified against the live API).
      wind_mph: wsKmh !== null && wdDeg !== null ? wsKmh * 0.621371 : null,
      wind_dir_deg: wsKmh !== null && wdDeg !== null && wdDeg >= 0 && wdDeg <= 360
        ? Number((((wdDeg % 360) + 360) % 360).toFixed(1)) : null,
      rh_pct: rh !== null && rh >= 0 && rh <= 100 ? rh : null,
      grid_id: pt?.properties?.gridId
        ? `${pt.properties.gridId}/${pt.properties.gridX},${pt.properties.gridY}` : null,
      near,
    };
    // Cache the EXTRACTED values, not the 219 KB payload.
    await cache.put(cacheReq, new Response(JSON.stringify(out), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CONUS_WX_TTL}` },
    }));
    return out;
  } catch {
    console.warn(JSON.stringify({ layer: 'fire-danger-conus', stage: 'nws', grid: `${rLat},${rLon}`, dropped: true }));
    return empty;
  }
}

// CONUS latency is NOT Hawaiʻi's. FIRMS Ultra Real-Time covers the mainland via
// Madison WI / Hampton VA direct-broadcast, so many detections land within
// minutes — but RT/NRT elsewhere can take far longer. Never promise universal
// near-instant detection; Hawaiʻi keeps its own ~20-30 min note.
const FIRE_DANGER_CONUS_LATENCY_NOTE =
  'Many mainland fire detections arrive within minutes of the satellite pass; others can take ' +
  '20 minutes to a few hours. Detection timing is not uniform across the country.';

// We cannot build a nationwide static-heat-source registry in v1, and the VIIRS
// NRT feed we fetch carries no static-source type column, so persistent
// industrial heat CAN be clustered and scored. Measured 2026-08-04: with a
// days=1 window the entire CONUS top-12 by size was steel mills and refinery
// flares. Saying so plainly is the only honest option available in v1.
const FIRE_DANGER_CONUS_INDUSTRIAL_NOTE =
  'Some detections may be industrial heat sources — steel mills, refinery flares, gas wells — ' +
  'rather than wildfire. Satellite heat detection alone cannot always tell them apart. ' +
  'Filtering persistent industrial sources is planned future work.';

const FIRE_DANGER_CONUS_DISCLAIMER =
  'Estimated fire-spread concern — model output for situational awareness only, not an official ' +
  'fire-behavior forecast. Follow your state and local fire authorities and the National Weather ' +
  'Service for official guidance.';

async function handleFireDangerConus(env: Env, cors: CorsHeaders): Promise<Response> {
  const nowMs = Date.now();
  const generatedAt = new Date(nowMs).toISOString();

  const firms = await fetchFirmsConus(env).catch(
    () => ({ hotspots: [], volcanic_count: 0, volcanic_hotspots: [], health: 'degraded', sensors_used: [] } as FirmsIngest),
  );
  const firmsOk = firms.health === 'ok';

  // FAIL-CLOSED, identical to Hawaiʻi: the band derives from HEALTH, never from
  // the hotspot count. A failed ingest yields no clusters and DEGRADED — it must
  // never be presentable as "no fires".
  const allClusters = firmsOk ? clusterHotspots(firms.hotspots, CONUS_CLUSTER_RADIUS_KM) : [];

  // Rank: max FRP desc, tie-break hotspot count desc. Then the floor rule
  // promotes any cluster with >= CONUS_ALWAYS_ASSESS_MIN_HOTSPOTS regardless of
  // where FRP put it.
  const ranked = allClusters.slice().sort((a, b) =>
    b.maxFrp - a.maxFrp || b.hotspots.length - a.hotspots.length);
  const chosen: ConusCluster[] = [];
  const taken = new Set<ConusCluster>();
  // Floor-qualified first, ranked by HOTSPOT COUNT so that if the floor set
  // alone overflows the absolute ceiling, the largest fires are the survivors.
  const floorSet = ranked
    .filter((c) => c.hotspots.length >= CONUS_ALWAYS_ASSESS_MIN_HOTSPOTS)
    .sort((a, b) => b.hotspots.length - a.hotspots.length);
  for (const c of floorSet) {
    if (chosen.length >= CONUS_ABSOLUTE_MAX_CLUSTERS) break;
    chosen.push(c);
    taken.add(c);
  }
  // Then fill remaining slots up to the soft cap by FRP rank.
  for (const c of ranked) {
    if (chosen.length >= CONUS_MAX_CLUSTERS) break;
    if (!taken.has(c)) { chosen.push(c); taken.add(c); }
  }
  const assessed = chosen;
  const unassessedClusterCount = Math.max(0, allClusters.length - assessed.length);

  // Weather per assessed cluster, isolated: one cluster's weather failing
  // degrades that cluster only (Invariant II).
  // Same 6-connection cap: up to 49 clusters, each a points->gridpoint chain.
  const wx = await mapWithConcurrency(assessed, OUTBOUND_CONCURRENCY_LIMIT,
    (c) => fetchConusWeather(c.lat, c.lon, nowMs));

  // Overlapping patches MERGE with per-cell MAX score. Two clusters producing a
  // score for the same ground is two valid model outputs; taking the higher is
  // SELECTION, not inflation — nothing is summed or amplified.
  type MergedCell = { clusterIdx: number; score: number; cell: Record<string, unknown> };
  const cellMap = new Map<string, MergedCell>();

  assessed.forEach((cluster, ci) => {
    const w: ConusWeather = wx[ci].status === 'fulfilled'
      ? wx[ci].value as ConusWeather
      : { wind_mph: null, wind_dir_deg: null, rh_pct: null, grid_id: null, near: null };
    const half = CONUS_PATCH_STEP_DEG / 2;
    const spanDeg = PROX_ZERO_KM / 111;
    const steps = Math.ceil(spanDeg / CONUS_PATCH_STEP_DEG);
    for (let iy = -steps; iy <= steps; iy++) {
      for (let ix = -steps; ix <= steps; ix++) {
        const lat = cluster.lat + iy * CONUS_PATCH_STEP_DEG;
        const lon = cluster.lon + ix * CONUS_PATCH_STEP_DEG;
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

        let nearestKm: number | null = null;
        let nearestBearing = 0;
        for (const h of cluster.hotspots) {
          const km = haversineKm(lon, lat, h.lon, h.lat);
          if (nearestKm === null || km < nearestKm) { nearestKm = km; nearestBearing = bearingDeg(h.lon, h.lat, lon, lat); }
        }
        if (nearestKm === null || nearestKm > PROX_ZERO_KM) continue; // outside the patch

        const { term: wTerm, downwind } = windTerm(nearestBearing, w.wind_dir_deg, w.wind_mph);
        const hTerm = humidityTerm(w.rh_pct);
        const effectiveKm = nearestKm / (wTerm * hTerm);
        const score = clamp01(proximityTerm(effectiveKm));
        const band = bandFor(score);
        if (band === 'NONE') continue; // omit NONE — learned from statewide payload size

        const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
        const prev = cellMap.get(key);
        if (prev && prev.score >= score) continue;
        cellMap.set(key, {
          clusterIdx: ci,
          score,
          cell: {
            cell_id: `c${ci}r${iy}c${ix}`,
            centroid: [Number(lon.toFixed(5)), Number(lat.toFixed(5))],
            danger_level: band,
            score: Number(score.toFixed(3)),
            // PER-CELL values only. wind/RH/grid are CLUSTER-CONSTANT and live
            // on the parent cluster's `weather` — repeating them on every cell
            // roughly doubled the payload for zero extra information.
            reason: {
              nearest_hotspot_km: Number(nearestKm.toFixed(2)),
              effective_km: Number(effectiveKm.toFixed(2)),
              downwind,
            },
          },
        });
      }
    }
  });

  const cellsByCluster: Array<Array<Record<string, unknown>>> = assessed.map(() => []);
  for (const m of cellMap.values()) cellsByCluster[m.clusterIdx].push(m.cell);

  const degradedInputs = new Set<string>();
  const clusters = assessed.map((c, ci) => {
    const w: ConusWeather = wx[ci].status === 'fulfilled'
      ? wx[ci].value as ConusWeather
      : { wind_mph: null, wind_dir_deg: null, rh_pct: null, grid_id: null, near: null };
    const di: string[] = [];
    if (w.wind_mph === null || w.wind_dir_deg === null) { di.push('wind'); degradedInputs.add('wind'); }
    if (w.rh_pct === null) { di.push('humidity'); degradedInputs.add('humidity'); }
    return {
      cluster_id: `conus-${ci}`,
      centroid: [Number(c.lon.toFixed(5)), Number(c.lat.toFixed(5))],
      hotspot_count: c.hotspots.length,
      // A SAMPLE, and named so — never the full set. hotspot_count above stays
      // the true total, so the client can say "showing N of M".
      representative_hotspots: pickRepresentativeHotspots(c.hotspots, CONUS_REPRESENTATIVE_HOTSPOTS),
      max_frp: Number(c.maxFrp.toFixed(1)),
      grid: { step_deg: CONUS_PATCH_STEP_DEG, radius_km: PROX_ZERO_KM, cell_count: cellsByCluster[ci].length },
      weather: { wind_mph: w.wind_mph === null ? null : Number(w.wind_mph.toFixed(1)), wind_dir_deg: w.wind_dir_deg, rh_pct: w.rh_pct === null ? null : Number(w.rh_pct.toFixed(1)), grid_id: w.grid_id },
      // Vicinity of the fire. null when unavailable, too far, or malformed — the
      // client renders nothing rather than a placeholder.
      near: w.near,
      degraded_inputs: di,
      cells: cellsByCluster[ci],
    };
  });

  const freshness = !firmsOk ? 'DEGRADED' : degradedInputs.size > 0 ? 'STALE_OK' : 'FRESH';

  const body = {
    generated_at: generatedAt,
    stale_after_seconds: FIRE_DANGER_STALE_AFTER_SECONDS,
    freshness,
    region: 'conus',
    sensors_used: firms.sensors_used,
    day_range: FIRE_DANGER_CONUS_DAYS,
    hotspot_count: firms.hotspots.length,
    cluster_count: allClusters.length,
    assessed_cluster_count: assessed.length,
    // Never silently truncate. The client states these numbers plainly.
    unassessed_cluster_count: unassessedClusterCount,
    source_health: { firms: firms.health, nws: degradedInputs.size > 0 ? 'degraded' : 'ok' },
    degraded_inputs: [...degradedInputs],
    // Hawaiʻi uses station OBSERVATIONS; CONUS uses gridded FORECAST. Labelled,
    // never blurred.
    weather_source: 'nws_gridpoint_forecast',
    coverage_note:
      'Spread estimates exist only around detected fire clusters, not everywhere. ' +
      'An area with no shading has not been assessed — it is not a statement that there is no risk.',
    industrial_note: FIRE_DANGER_CONUS_INDUSTRIAL_NOTE,
    latency_note: FIRE_DANGER_CONUS_LATENCY_NOTE,
    disclaimer: FIRE_DANGER_CONUS_DISCLAIMER,
    clusters,
  };

  return jsonResp(body, 200, { ...cors, 'Cache-Control': firmsOk ? 'public, max-age=300' : 'no-store' });
}

// ═══════════════════════════════════════════════════════════════════════════
// AIR QUALITY — measured AQI per monitoring site (EPA AirNow)
//
// Built on /aq/data/ (Observations by Monitoring Site, bounding box). That
// surface SURVIVES EPA's 2026-09-30 retirement; the reporting-area zip/latLong
// endpoints do not, and they return an area value with no geometry anyway —
// useless for a per-site overlay.
//
// INVARIANT V IS INVERTED HERE, deliberately. Everywhere else in this Worker we
// publish model ESTIMATES and must never dress them as official. These are
// official measurements from the Hawaiʻi State Department of Health, reported
// through EPA AirNow. So this endpoint passes values through VERBATIM with
// attribution and adds no scale of its own — the six AQI categories, breakpoints
// and colours below are EPA's published table, copied exactly.
// ═══════════════════════════════════════════════════════════════════════════

const AIR_BBOX_HAWAII = '-161.2,18.5,-154.5,22.5';

// Request every pollutant; sites return only what they actually measure.
// SO2 IS THE VOG SIGNAL and is not optional here: measured 2026-08-05, 10 of 15
// Hawaiʻi sites report SO2, and they are exactly the Kīlauea downwind corridor —
// Pahala, Ocean View, Nāʻālehu, Mountain View, Leilani, Kona, Hilo, Waikoloa.
// During an eruption episode SO2 is the field that matters most on Hawaiʻi
// Island, and PM2.5 alone would show "Good" while vog was the actual hazard.
const AIR_PARAMETERS = 'OZONE,PM25,PM10,SO2,NO2,CO';

// Observations publish hourly, "between 10 and 30 minutes past the hour"
// (AirNow FAQ). A 2-hour window guarantees a non-empty result early in the hour,
// when the current hour has not been published yet.
const AIR_WINDOW_HOURS = 2;

// Hourly data: 15 min bounds how long we lag a fresh publish while capping us at
// 4 upstream requests/hour. The cache is load-bearing — AirNow's rate limit does
// not throttle, it STOPS returning data for the remainder of the hour.
const AIR_CACHE_TTL = 900;

// FRESHNESS IS HOURLY, NOT MINUTELY — and this is the third time this project
// has had to get a freshness label right, so it is grounded rather than guessed.
// AirNow publishes hour H between H+1:10 and H+1:30, so in NORMAL healthy
// operation the newest observation's age oscillates ~1h10m to ~2h30m. A 90-minute
// "fresh" threshold would therefore report stale on perfectly good data for a
// large part of every hour — the same crying-wolf failure as the permanent
// STALE_OK and the panel OUTDATED badge. 3h covers the full normal swing.
// The precise age is always exposed separately so the client can state it
// plainly without an alarm colour.
const AIR_FRESH_MAX_MINUTES = 180;
const AIR_STALE_MAX_MINUTES = 360;

// EPA's published AQI table, verbatim (docs.airnowapi.org/aq101). We do not
// invent a scale for official measurements.
const AIR_CATEGORIES: ReadonlyArray<{ max: number; number: number; name: string; color: string }> = [
  { max: 50,  number: 1, name: 'Good',                           color: '#00e400' },
  { max: 100, number: 2, name: 'Moderate',                       color: '#ffff00' },
  { max: 150, number: 3, name: 'Unhealthy for Sensitive Groups', color: '#ff7e00' },
  { max: 200, number: 4, name: 'Unhealthy',                      color: '#ff0000' },
  { max: 300, number: 5, name: 'Very Unhealthy',                 color: '#8f3f97' },
  { max: Infinity, number: 6, name: 'Hazardous',                 color: '#7e0023' },
];

function epaCategory(aqi: number) {
  for (const c of AIR_CATEGORIES) if (aqi <= c.max) return c;
  return AIR_CATEGORIES[AIR_CATEGORIES.length - 1];
}

type AirReading = {
  parameter: string;
  unit: string;
  value: number | null;
  aqi: number | null;
  category: string | null;
  category_number: number | null;
  observed_utc: string;
};

type AirMonitor = {
  site: string;
  agency: string;
  lat: number;
  lon: number;
  aqi: number | null;
  category: string | null;
  category_number: number | null;
  category_color: string | null;
  dominant_parameter: string | null;
  observed_utc: string | null;
  parameters: AirReading[];
};

type AirIngest = { monitors: AirMonitor[]; health: 'ok' | 'degraded' | 'unconfigured'; newest_utc: string | null };

// AirNow wants YYYY-MM-DDTHH in UTC.
function airHourStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 13);
}

// Parse + dedupe. Records arrive one row per (site, parameter, hour); we keep the
// NEWEST row per parameter per site, then the site's headline AQI is the WORST
// across its parameters — so an SO2 spike stays visible even when PM2.5 is clean.
// Sites are keyed by rounded GEOMETRY, not name: AirNow returns inconsistent
// casing for the same site ("KAHULUI" vs "Kahului"), and coordinates are stable.
// Invariant III: any row failing validation is dropped, never coerced.
function parseAirNowRecords(raw: unknown): { monitors: AirMonitor[]; newest_utc: string | null } {
  if (!Array.isArray(raw)) return { monitors: [], newest_utc: null };
  const bySite = new Map<string, { site: string; agency: string; lat: number; lon: number; params: Map<string, AirReading> }>();
  let newest: string | null = null;

  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r !== 'object') continue;
    const lat = Number(r.Latitude);
    const lon = Number(r.Longitude);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const parameter = typeof r.Parameter === 'string' ? r.Parameter.trim() : '';
    const observed = typeof r.UTC === 'string' ? r.UTC.trim() : '';
    if (!parameter || !observed) continue;

    // AQI is -1 / missing when a concentration exists but no AQI was computed.
    //
    // numOrNull, NOT Number(): Number(null) and Number('') are both 0, so a
    // MISSING AQI would silently become 0 — which renders as "Good" on an air
    // quality endpoint. That is the worst possible direction for this failure to
    // go, so absence is preserved as null and never coerced to a reading.
    const numOrNull = (v: unknown): number | null => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return isFinite(n) ? n : null;
    };
    const rawAqi = numOrNull(r.AQI);
    const aqi = rawAqi !== null && rawAqi >= 0 ? Math.round(rawAqi) : null;
    const value = numOrNull(r.Value);
    if (aqi === null && value === null) continue;   // nothing usable — drop

    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    let entry = bySite.get(key);
    if (!entry) {
      entry = {
        site: typeof r.SiteName === 'string' && r.SiteName.trim() ? r.SiteName.trim() : key,
        agency: typeof r.AgencyName === 'string' ? r.AgencyName.trim() : '',
        lat, lon, params: new Map(),
      };
      bySite.set(key, entry);
    }
    const cat = aqi === null ? null : epaCategory(aqi);
    const reading: AirReading = {
      parameter,
      unit: typeof r.Unit === 'string' ? r.Unit.trim() : '',
      value,
      aqi,
      category: cat ? cat.name : null,
      category_number: cat ? cat.number : null,
      observed_utc: observed,
    };
    const prev = entry.params.get(parameter);
    if (!prev || reading.observed_utc > prev.observed_utc) entry.params.set(parameter, reading);
    if (!newest || observed > newest) newest = observed;
  }

  const monitors: AirMonitor[] = [];
  for (const e of bySite.values()) {
    const params = [...e.params.values()].sort((a, b) => (b.aqi ?? -1) - (a.aqi ?? -1));
    const worst = params.find((p) => p.aqi !== null) ?? null;
    const cat = worst && worst.aqi !== null ? epaCategory(worst.aqi) : null;
    monitors.push({
      site: e.site,
      agency: e.agency,
      lat: Number(e.lat.toFixed(5)),
      lon: Number(e.lon.toFixed(5)),
      aqi: worst ? worst.aqi : null,
      category: cat ? cat.name : null,
      category_number: cat ? cat.number : null,
      category_color: cat ? cat.color : null,
      dominant_parameter: worst ? worst.parameter : null,
      observed_utc: params.reduce<string | null>((m, p) => (!m || p.observed_utc > m ? p.observed_utc : m), null),
      parameters: params,
    });
  }
  monitors.sort((a, b) => (b.aqi ?? -1) - (a.aqi ?? -1));
  return { monitors, newest_utc: newest };
}

// Never throws, never returns a Response — mirrors fetchFirmsMultiSensor, so the
// handler stays Invariant-II safe.
async function fetchAirNowObservations(env: Env, nowMs: number): Promise<AirIngest> {
  if (!env.AIRNOW_API_KEY) return { monitors: [], health: 'unconfigured', newest_utc: null };
  const cache = caches.default;
  const start = airHourStamp(nowMs - AIR_WINDOW_HOURS * 3600_000);
  const end = airHourStamp(nowMs);
  // API_KEY appears ONLY in the upstream URL — never in the cache key, never in a
  // log line, never in the envelope.
  const cacheReq = new Request(
    `https://www.airnowapi.org/_kahuola/air/${AIR_BBOX_HAWAII}/${start}/${end}`,
  );
  try {
    const cached = await cache.match(cacheReq);
    if (cached) {
      const parsed = parseAirNowRecords(await cached.json());
      return { ...parsed, health: 'ok' };
    }
    const upstream =
      `https://www.airnowapi.org/aq/data/?startDate=${start}&endDate=${end}` +
      `&parameters=${AIR_PARAMETERS}&BBOX=${AIR_BBOX_HAWAII}` +
      `&dataType=B&format=application/json&verbose=1&API_KEY=${env.AIRNOW_API_KEY}`;
    const res = await fetch(upstream, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const text = await res.text();
    let raw: unknown;
    try { raw = JSON.parse(text); }
    catch { throw new Error('parse'); }
    await cache.put(cacheReq, new Response(text, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${AIR_CACHE_TTL}` },
    }));
    const parsed = parseAirNowRecords(raw);
    return { ...parsed, health: 'ok' };
  } catch {
    console.warn(JSON.stringify({ layer: 'air', stage: 'airnow', dropped: true }));
    return { monitors: [], health: 'degraded', newest_utc: null };
  }
}

const AIR_ATTRIBUTION = 'Hawaiʻi State Department of Health, via EPA AirNow';

const AIR_NOTE =
  'Measured air quality from official monitoring stations — not a Kahu Ola estimate. ' +
  'Readings are hourly and typically publish 10–30 minutes after the hour, so the newest ' +
  'reading is normally 1–2 hours old. Follow the Hawaiʻi State Department of Health and ' +
  'EPA AirNow for health guidance.';

const AIR_VOG_NOTE =
  'On Hawaiʻi Island, sulfur dioxide (SO₂) readings reflect volcanic smog (vog) from ' +
  'Kīlauea. Vog can be hazardous while fine-particle (PM2.5) readings still look good, so ' +
  'check the SO₂ value for a station, not only its headline number.';

async function handleAirQuality(url: URL, env: Env, cors: CorsHeaders): Promise<Response> {
  const nowMs = Date.now();
  // region=hawaii only. CONUS air is a different problem — far greater monitor
  // density and a bbox that would blow the record limit — and is not in scope.
  const region = (url.searchParams.get('region') || 'hawaii').toLowerCase() === 'hawaii' ? 'hawaii' : 'hawaii';

  const air = await fetchAirNowObservations(env, nowMs).catch(
    () => ({ monitors: [], health: 'degraded', newest_utc: null } as AirIngest),
  );

  // FAIL-CLOSED: health drives the label, never the monitor count. "We could not
  // reach AirNow" and "we reached it and the air is clean" are different answers.
  const ok = air.health === 'ok' && air.monitors.length > 0;
  const newestMs = air.newest_utc ? Date.parse(`${air.newest_utc}Z`.replace(/Z+$/, 'Z')) : NaN;
  const ageMinutes = ok && isFinite(newestMs) ? Math.max(0, Math.round((nowMs - newestMs) / 60000)) : null;

  const freshness = !ok
    ? 'DEGRADED'
    : ageMinutes === null || ageMinutes <= AIR_FRESH_MAX_MINUTES
      ? 'FRESH'
      : ageMinutes <= AIR_STALE_MAX_MINUTES
        ? 'STALE_OK'
        : 'DEGRADED';

  const so2Count = air.monitors.filter((m) => m.parameters.some((p) => /^SO2$/i.test(p.parameter))).length;

  const body = {
    generated_at: new Date(nowMs).toISOString(),
    stale_after_seconds: 3600,
    freshness,
    region,
    source_health: { airnow: air.health },
    newest_observation_utc: air.newest_utc,
    // Exposed ALWAYS, so the client can state the real age plainly rather than
    // inferring it from a label.
    observation_age_minutes: ageMinutes,
    monitor_count: air.monitors.length,
    so2_monitor_count: so2Count,
    monitors: air.monitors,
    attribution: AIR_ATTRIBUTION,
    note: AIR_NOTE,
    vog_note: AIR_VOG_NOTE,
  };

  return jsonResp(body, 200, { ...cors, 'Cache-Control': ok ? 'public, max-age=300' : 'no-store' });
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

  // NOT AirNow. This route is named "airnow" for historical reasons but serves
  // AQICN (aqicn.org), a third-party REDISTRIBUTOR of EPA AirNow data, because
  // tiles.airnowtech.org is defunct. It needs no API key and is unaffected by
  // EPA's 2026-09-30 JSON API retirement. Measured AQI from AirNow proper is a
  // different surface entirely — see handleAirQuality / /api/hazards/air.
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

// ── Aggregated hazard summary — shared cache keys ────────────────────────────
// /api/hazards/summary is READ-ONLY: it reuses snapshots already written by the
// smoke / perimeters / FIRMS handlers. It never calls upstream and never writes
// a primary snapshot key. The *-status-v1 keys hold ONLY short-TTL failure
// envelopes, kept separate so a transient upstream error can never clobber the
// last good snapshot (smoke-hawaii-v1 / perimeters-hawaii-v1). Invariant III.
const SUMMARY_SMOKE_KEY = 'https://kahuola.org/cache/smoke-hawaii-v1';
const SUMMARY_PERIM_KEY = 'https://kahuola.org/cache/perimeters-hawaii-v1';
const SUMMARY_SMOKE_STATUS_KEY = 'https://kahuola.org/cache/smoke-hawaii-status-v1';
const SUMMARY_PERIM_STATUS_KEY = 'https://kahuola.org/cache/perimeters-hawaii-status-v1';
// Default hawaii FIRMS cache key — built by the SAME helper the writer
// (handleFirmsHotspots) uses, so the read key and the written key cannot drift.
const SUMMARY_FIRMS_KEY = firmsCacheKey(FIRMS_PRIMARY_DATASET, REGION_BBOXES.hawaii, 1);

// ── NOAA HMS smoke — KML upstream (GeoJSON dir retired ~2026-01) ─────────────
// New layout: .../Smoke_Polygons/KML/{YYYY}/{MM}/hms_smoke{YYYYMMDD}.kml (UTC).
// All helpers are module scope + never throw so the fetch chain stays fail-closed.
const HMS_MAX_KML_BYTES = 20 * 1024 * 1024;   // size guard — large CONUS fire days

function hmsPad2(n: number): string { return String(n).padStart(2, '0'); }

function hmsDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${hmsPad2(d.getUTCMonth() + 1)}-${hmsPad2(d.getUTCDate())}`;
}

// Build the UTC-dated HMS smoke KML URL for a given date.
function hmsKmlUrl(date: Date): string {
  const y = date.getUTCFullYear();
  const m = hmsPad2(date.getUTCMonth() + 1);
  const d = hmsPad2(date.getUTCDate());
  return `https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/${y}/${m}/hms_smoke${y}${m}${d}.kml`;
}

// Fetch one day's KML with an 8s timeout + size guard. Never throws.
async function fetchHmsKml(date: Date): Promise<{ ok: boolean; text: string | null; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(hmsKmlUrl(date), {
      signal: controller.signal,
      headers: { 'User-Agent': 'Kahu Ola / kahuola.org', Accept: 'application/vnd.google-earth.kml+xml, application/xml, */*' },
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, text: null, status: res.status };
    const declared = Number(res.headers.get('content-length') || '0');
    if (Number.isFinite(declared) && declared > HMS_MAX_KML_BYTES) {
      return { ok: false, text: null, status: 413 };   // too large → unavailable
    }
    const text = await res.text();
    if (text.length > HMS_MAX_KML_BYTES) return { ok: false, text: null, status: 413 };
    return { ok: true, text, status: res.status };
  } catch {
    clearTimeout(timer);
    return { ok: false, text: null, status: 0 };        // timeout / network
  }
}

type HmsSmoke = { ring: number[][]; density: 'light' | 'medium' | 'heavy' | null };

// Validate one KML <coordinates> string into a closed lon/lat ring.
// Fail-closed: any malformed / out-of-range / non-closed ring → null (DROP,
// never auto-correct or auto-close — Invariant III).
function parseKmlRing(raw: string): number[][] | null {
  const tuples = raw.trim().split(/\s+/).filter(Boolean);
  if (tuples.length < 4) return null;                    // ring needs >= 4 vertices
  const ring: number[][] = [];
  for (const t of tuples) {
    const parts = t.split(',');
    if (parts.length < 2) return null;
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
    ring.push([lon, lat]);
  }
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) return null;       // not closed → drop
  return ring;
}

// Extract smoke polygons from HMS KML. Module scope, never throws, fail-closed.
// Any bad Placemark/Polygon is dropped; a wholly-bad file yields [].
function parseHmsKml(text: string): HmsSmoke[] {
  const out: HmsSmoke[] = [];
  if (typeof text !== 'string' || text.length === 0) return out;
  try {
    const placemarks = text.match(/<Placemark\b[\s\S]*?<\/Placemark>/gi);
    if (!placemarks) return out;
    for (const pm of placemarks) {
      try {
        let density: HmsSmoke['density'] = null;
        const dm = pm.match(/\b(Light|Medium|Heavy)\b/i);   // absent → null (no fabrication)
        if (dm) {
          const d = dm[1].toLowerCase();
          density = d === 'heavy' ? 'heavy' : d === 'medium' ? 'medium' : 'light';
        }
        const polys = pm.match(/<Polygon\b[\s\S]*?<\/Polygon>/gi);
        if (!polys) continue;
        for (const poly of polys) {
          const outer = poly.match(/<outerBoundaryIs\b[\s\S]*?<\/outerBoundaryIs>/i);
          const scope = outer ? outer[0] : poly;
          const cm = scope.match(/<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/i);
          if (!cm) continue;
          const ring = parseKmlRing(cm[1]);
          if (ring) out.push({ ring, density });            // invalid ring → already dropped
        }
      } catch { /* drop this placemark, continue with the next */ }
    }
  } catch {
    return [];
  }
  return out;
}

// Bbox overlap between a ring and a [west, south, east, north] box.
function ringIntersectsBbox(ring: number[][], west: number, south: number, east: number, north: number): boolean {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const c of ring) {
    if (c[0] < minLon) minLon = c[0];
    if (c[0] > maxLon) maxLon = c[0];
    if (c[1] < minLat) minLat = c[1];
    if (c[1] > maxLat) maxLat = c[1];
  }
  return maxLon >= west && minLon <= east && maxLat >= south && minLat <= north;
}

// Unavailable path — writes the 60s status key ONLY (no-clobber of the primary
// snapshot smoke-hawaii-v1). Mirrors the shipped summary status-key contract.
async function smokeUnavailable(region: string, cors: CorsHeaders, note: string): Promise<Response> {
  const envelope = buildHazardEnvelope('smoke', 'NOAA HMS', region, [],
    { status: 'unavailable', count: 0, message: 'Smoke data temporarily unavailable.' },
    { authority: 'observational', note },
  );
  const statusResponse = new Response(
    JSON.stringify({ ...envelope, stale_after_seconds: 60 }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'X-Kahuola-Cache': 'MISS', ...cors } },
  );
  await caches.default.put(new Request(SUMMARY_SMOKE_STATUS_KEY), statusResponse.clone());
  return statusResponse;
}

// ── SMOKE SIGNALS — NOAA HMS Smoke Polygons ──────────────────────────────
async function handleSmoke(url: URL, cors: CorsHeaders): Promise<Response> {
  const region = resolveRegion(url);
  const cacheKey = 'https://kahuola.org/cache/smoke-hawaii-v1';
  const cache = caches.default;
  const cached = await cache.match(new Request(cacheKey));
  const cachedJson = cachedJsonResponse(cached, cors, 200);
  if (cachedJson) return cachedJson;

  // Fetch chain (UTC): today's KML → 404/err → yesterday's KML → both fail.
  const todayUtc = new Date();
  const yesterdayUtc = new Date(todayUtc.getTime() - 86_400_000);

  let kml = await fetchHmsKml(todayUtc);
  let usedDate = todayUtc;
  let stale = false;
  if (!kml.ok) {
    const ykml = await fetchHmsKml(yesterdayUtc);
    if (!ykml.ok) {
      // Both UTC days unavailable → no-clobber status key, primary snapshot intact.
      return smokeUnavailable(region, cors, `Upstream unavailable: HMS KML HTTP ${kml.status || 'error'}`);
    }
    kml = ykml;
    usedDate = yesterdayUtc;
    stale = true;   // serving previous UTC day — labelled honestly below
  }

  const parsed = parseHmsKml(kml.text || '');
  const [hwWest, hwSouth, hwEast, hwNorth] = REGION_BBOXES.hawaii;
  const nowIso = new Date().toISOString();

  // Hawaii bbox filter — KML covers all of North America; keep only overlaps.
  const signals: Feature[] = parsed
    .filter((p) => ringIntersectsBbox(p.ring, hwWest, hwSouth, hwEast, hwNorth))
    .map((p, idx) => {
      const density = p.density ?? 'light';   // observational default; never fabricate medium/heavy
      const severity = density === 'heavy' ? 'WARNING' : density === 'medium' ? 'WATCH' : 'INFO';
      return {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [p.ring] },
        properties: {
          id: `smoke-${idx}`,
          smoke_density: density,
          density,
          severity,
          source: 'NOAA HMS',
          source_provider: 'NOAA_HMS',
          source_label: 'NOAA HMS',
          event_time: nowIso,
          advisory: 'Smoke detected in area. Air quality may be reduced.',
        },
      };
    });

  const dateStr = hmsDateStr(usedDate);
  const message = signals.length > 0
    ? `${signals.length} smoke polygon(s) detected near Hawaiʻi.`
    : 'No significant smoke polygons detected near Hawaiʻi.';
  // Honest freshness label: fallback day is stated explicitly + shorter stale TTL.
  const note = stale
    ? `NOAA HMS smoke from previous UTC day (${dateStr}); today's file not yet published. Advisory only.`
    : `NOAA HMS satellite smoke detection (${dateStr}). Advisory only.`;

  const envelope = buildHazardEnvelope(
    'smoke', 'NOAA HMS', region, signals,
    {
      status: signals.length > 0 ? 'detected' : 'none',
      count: signals.length,
      message,
    },
    { authority: 'observational', note },
  );

  const response = new Response(
    JSON.stringify({ ...envelope, stale_after_seconds: stale ? 300 : 900 }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600', 'X-Kahuola-Cache': 'MISS', ...cors } },
  );
  await cache.put(new Request(cacheKey), response.clone());
  return response;
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
    // Publish per-source status to a SEPARATE short-TTL key (never clobber the
    // last good snapshot at perimeters-hawaii-v1). 60s TTL.
    const envelope = buildHazardEnvelope('perimeters', 'NIFC WFIGS', region, [],
      { status: 'unavailable', count: 0, message: 'Perimeter data temporarily unavailable.' },
      { authority: 'official', note: `Upstream unavailable: ${msg}` },
    );
    const statusResponse = new Response(
      JSON.stringify({ ...envelope, stale_after_seconds: 60 }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'X-Kahuola-Cache': 'MISS', ...cors } },
    );
    await cache.put(new Request(SUMMARY_PERIM_STATUS_KEY), statusResponse.clone());
    return statusResponse;
  }
}

// ── /api/hazards/summary — readers + handler (all module scope) ──────────────
// Every reader is module-scope (never a nested closure) and never throws, so
// Promise.all cannot swallow a ReferenceError. Each returns a deterministic
// degraded shape on any miss / parse failure (Invariant III). Zero PII.

type SummarySrc = { count: number | null; status: string; age_seconds: number | null; volcanic_zone_count?: number; wildland_count?: number };

// Seconds since an ISO timestamp, clamped to >= 0. null if unparseable.
function summaryAgeSeconds(generatedAt: unknown, nowMs: number): number | null {
  if (typeof generatedAt !== 'string') return null;
  const t = Date.parse(generatedAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / 1000));
}

function summarySrcIsBad(s: SummarySrc): boolean {
  return s.count === null || s.status === 'unavailable' || s.status === 'miss';
}

// Read a hazard-envelope snapshot (smoke / perimeters shape). Never throws.
async function readSummaryEnvelope(key: string, nowMs: number): Promise<SummarySrc> {
  try {
    const c = await caches.default.match(new Request(key));
    if (!c) return { count: null, status: 'miss', age_seconds: null };
    const ct = (c.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('json')) return { count: null, status: 'miss', age_seconds: null };
    const j: any = await c.json();
    const status = typeof j?.summary?.status === 'string' ? j.summary.status : 'unknown';
    const age = summaryAgeSeconds(j?.generated_at, nowMs);
    const n = j?.summary?.count;
    if (typeof n === 'number' && Number.isFinite(n)) return { count: n, status, age_seconds: age };
    if (Array.isArray(j?.signals)) return { count: j.signals.length, status, age_seconds: age };
    return { count: null, status, age_seconds: age };
  } catch {
    return { count: null, status: 'miss', age_seconds: null };
  }
}

// Good snapshot first; only on a primary miss fall back to the short-TTL failure
// status key. A transient upstream error must never override last-known-good.
async function readSummarySource(primaryKey: string, statusKey: string, nowMs: number): Promise<SummarySrc> {
  const primary = await readSummaryEnvelope(primaryKey, nowMs);
  if (primary.status !== 'miss') return primary;
  return readSummaryEnvelope(statusKey, nowMs);
}

// Read the FIRMS GeoJSON snapshot (properties.returnedRecords / features). Never throws.
async function readSummaryFirms(key: string, nowMs: number): Promise<SummarySrc> {
  try {
    const c = await caches.default.match(new Request(key));
    if (!c) return { count: null, status: 'miss', age_seconds: null };
    const ct = (c.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('json') && !ct.includes('geo+json')) return { count: null, status: 'miss', age_seconds: null };
    const j: any = await c.json();
    const age = summaryAgeSeconds(j?.properties?.generated_at, nowMs);
    const feats: any[] = Array.isArray(j?.features) ? j.features : [];
    const n = j?.properties?.returnedRecords;
    // Preserve existing count semantics: returnedRecords, else features.length.
    const total = (typeof n === 'number' && Number.isFinite(n)) ? n
      : (Array.isArray(j?.features) ? feats.length : null);
    if (total === null) return { count: null, status: 'miss', age_seconds: age };
    // Additive breakdown. Old caches without volcanic_zone → volcanic 0, all
    // wildland. Invariant (asserted in test): count === volcanic + wildland.
    let volcanic = 0;
    for (const f of feats) { if (f?.properties?.volcanic_zone === true) volcanic++; }
    const wildland = Math.max(0, total - volcanic);
    return { count: total, status: total > 0 ? 'detected' : 'none', age_seconds: age,
      volcanic_zone_count: volcanic, wildland_count: wildland };
  } catch {
    return { count: null, status: 'miss', age_seconds: null };
  }
}

// Aggregated Hawaiʻi hazard summary for the widget + homepage insight card.
// SELF-WARMING: caches.default is per-colo, so a colo with no live-map traffic
// would otherwise return a false miss. On a genuine miss (primary AND status key
// both absent in THIS colo) we invoke the OWNING handler — which fetches upstream
// and writes its OWN cache — then re-read the key once, so any colo serves real
// data. This handler still never writes a primary key itself and never changes a
// handler's write logic. Always HTTP 200 + valid JSON; degrades deterministically
// and fail-closed on any remaining miss (Invariant II/III).
async function handleHazardsSummary(url: URL, env: Env, cors: CorsHeaders): Promise<Response> {
  const nowMs = Date.now();
  let [smoke, perim, fire] = await Promise.all([
    readSummarySource(SUMMARY_SMOKE_KEY, SUMMARY_SMOKE_STATUS_KEY, nowMs),
    readSummarySource(SUMMARY_PERIM_KEY, SUMMARY_PERIM_STATUS_KEY, nowMs),
    readSummaryFirms(SUMMARY_FIRMS_KEY, nowMs),
  ]);

  // Warm only genuinely-missing sources. Each warm task is isolated via
  // Promise.allSettled: one source failing never blocks another, and a source
  // still missing after warming keeps the existing degraded shape (fail-closed).
  const origin = url.origin;
  const warmTasks: Promise<void>[] = [];
  if (smoke.status === 'miss') {
    warmTasks.push((async () => {
      await handleSmoke(new URL(`${origin}/api/hazards/smoke?region=hawaii`), cors);
      smoke = await readSummarySource(SUMMARY_SMOKE_KEY, SUMMARY_SMOKE_STATUS_KEY, nowMs);
    })());
  }
  if (perim.status === 'miss') {
    warmTasks.push((async () => {
      await handlePerimeters(new URL(`${origin}/api/hazards/perimeters?region=hawaii`), cors);
      perim = await readSummarySource(SUMMARY_PERIM_KEY, SUMMARY_PERIM_STATUS_KEY, nowMs);
    })());
  }
  if (fire.status === 'miss') {
    // scope=hawaii + default dataset/days => firmsCacheKey(...) === SUMMARY_FIRMS_KEY
    // (reader and this writer build the key via the shared firmsCacheKey helper).
    warmTasks.push((async () => {
      await handleFirmsHotspots(new URL(`${origin}/api/hazards/firms?scope=hawaii`), env, cors);
      fire = await readSummaryFirms(SUMMARY_FIRMS_KEY, nowMs);
    })());
  }
  if (warmTasks.length) await Promise.allSettled(warmTasks);

  const degraded = summarySrcIsBad(smoke) || summarySrcIsBad(perim) || summarySrcIsBad(fire);

  const body: Record<string, unknown> = {
    region: 'hawaii',
    generated_at: new Date(nowMs).toISOString(),
    stale: degraded,
    fire: { count: fire.count ?? 0, volcanic_zone_count: fire.volcanic_zone_count ?? 0, wildland_count: fire.wildland_count ?? 0, status: fire.status, age_seconds: fire.age_seconds, source: 'NASA FIRMS' },
    smoke: { present: (smoke.count ?? 0) > 0, count: smoke.count ?? 0, status: smoke.status, age_seconds: smoke.age_seconds, source: 'NOAA HMS' },
    perimeters: { count: perim.count ?? 0, status: perim.status, age_seconds: perim.age_seconds, source: 'NIFC WFIGS' },
    note: 'Situational awareness only. Follow official sources.',
  };
  if (degraded) body.degraded = true;

  return jsonResp(body, 200, { ...cors, 'Cache-Control': 'public, max-age=60' });
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

const COASTAL_EVENTS: Record<string, { severity: string; risk_index: string }> = {
  'high surf warning':       { severity: 'Extreme',  risk_index: 'HIGH' },
  'high surf advisory':      { severity: 'Moderate', risk_index: 'MEDIUM' },
  'coastal flood warning':   { severity: 'Severe',   risk_index: 'HIGH' },
  'coastal flood watch':     { severity: 'Moderate', risk_index: 'MEDIUM' },
  'coastal flood advisory':  { severity: 'Minor',    risk_index: 'LOW' },
  'beach hazards statement': { severity: 'Minor',    risk_index: 'LOW' },
  'coastal flood statement': { severity: 'Minor',    risk_index: 'LOW' },
};

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

// ── COASTAL ALERTS — High Surf, Coastal Flood, Beach Hazards ─────────
async function handleCoastal(cors: CorsHeaders): Promise<Response> {
  const now = new Date().toISOString();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const res = await fetch('https://api.weather.gov/alerts/active?area=HI', {
      signal: controller.signal,
      headers: { Accept: 'application/geo+json', 'User-Agent': 'Kahu Ola / kahuola.org' },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`NWS ${res.status}`);

    const data: any = await res.json();
    const rawFeatures = Array.isArray(data?.features) ? data.features : [];

    const signals: Feature[] = rawFeatures
      .filter((f: any) => {
        const event = String(f?.properties?.event || '').toLowerCase();
        return Object.keys(COASTAL_EVENTS).some(k => event.includes(k));
      })
      .map((f: any, idx: number) => {
        const eventKey = String(f?.properties?.event || '').toLowerCase();
        const meta = Object.entries(COASTAL_EVENTS).find(([k]) => eventKey.includes(k));
        const { severity, risk_index } = meta ? meta[1] : { severity: 'Minor', risk_index: 'LOW' };
        return {
          type: 'Feature',
          geometry: f.geometry ?? null,
          properties: {
            id: f?.id || `coastal-${idx}`,
            source: 'NWS',
            source_label: 'NWS',
            event: f?.properties?.event || 'Coastal Alert',
            severity,
            risk_index,
            areaDesc: f?.properties?.areaDesc || 'Hawaiʻi',
            headline: f?.properties?.headline || '',
            onset: f?.properties?.onset || now,
            ends: f?.properties?.ends || '',
            instruction: f?.properties?.instruction || 'Follow official NWS guidance.',
          },
        } as Feature;
      });

    const hasHigh = signals.some(s =>
      ['Extreme', 'Severe'].includes(s.properties.severity as string)
    );
    const status = signals.length === 0 ? 'none' : hasHigh ? 'warning' : 'advisory';

    const envelope = buildHazardEnvelope(
      'coastal', 'NWS', 'hawaii', signals,
      {
        status,
        count: signals.length,
        message: signals.length > 0
          ? `${signals.length} active coastal alert(s) for Hawaiʻi.`
          : 'No active coastal alerts for Hawaiʻi.',
      },
      { authority: 'official', note: 'Live NWS coastal and surf alerts for all Hawaiian islands.' }
    );
    return jsonResp({ ...envelope, stale_after_seconds: 300 }, 200, cors);

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return jsonResp(
      buildHazardEnvelope('coastal', 'NWS', 'hawaii', [],
        { status: 'none', count: 0, message: 'Coastal alert source unavailable.' },
        { authority: 'official', note: msg }
      ),
      200, cors
    );
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
  return ["en", "vi", "tl", "ilo", "haw", "ja"].includes(lang) ? lang : "en";
}

// P19: household flags carry a `medical` bit. As query params they land in
// request logs and any Referer, which violates the sensitive-data-in-query-
// strings rule. POST moves them into the body, where they do not.
//
// GET stays supported because fielded iOS 1.0 uses it and cannot be recalled.
// RESIDUAL LEAK — owner: Long. Remove the GET household path once the next
// iOS release (>= 1.0.1) has rolled out and GET traffic for these params
// has drained. The zone id itself stays in the path either way.
function parseHouseholdFromBody(body: unknown): HouseholdProfile | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  // Invariant III: a malformed body is dropped, never inferred. The caller
  // falls back to the URL, which yields documented defaults.
  const flag = (name: string): boolean => {
    const v = b[name];
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v === 1;
    if (typeof v === "string") {
      const s = v.toLowerCase();
      return s === "1" || s === "true" || s === "yes";
    }
    return false;
  };
  return {
    kupuna: flag("kupuna"),
    keiki: flag("keiki"),
    pets: flag("pets"),
    medical: flag("medical"),
    // Matches parseHouseholdFromUrl: car defaults TRUE unless explicitly sent.
    car: b.car !== undefined && b.car !== null ? flag("car") : true,
  };
}

function parseLangFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as Record<string, unknown>).lang;
  if (typeof raw !== "string") return null;
  const lang = raw.toLowerCase();
  return ["en", "vi", "tl", "ilo", "haw", "ja"].includes(lang) ? lang : null;
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
  // P19: present only on POST. Body values win; anything missing or
  // malformed falls back to the URL so GET behaviour is byte-identical.
  bodyOverride?: unknown,
): Promise<Response> {
  const lang = parseLangFromBody(bodyOverride) ?? parseLangFromUrl(url);
  const household = parseHouseholdFromBody(bodyOverride) ?? parseHouseholdFromUrl(url);

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

// ══════════════════════════════════════════════════════════
// Push notifications — mobile app subscription + daily dispatch
// ══════════════════════════════════════════════════════════
//
// Subscribers post their Expo push token + zone_id + lang to
// /api/push/subscribe. We store them under push_sub:{sha256(token)}
// so repeat registrations idempotently refresh the record.
//
// A daily cron (06:00 HST / 16:00 UTC) walks all push_sub:* keys,
// fetches each subscriber's zone brief, and sends via the Expo
// push API. This endpoint is defensive: unknown payloads, malformed
// tokens, and upstream failures all fail open (no 5xx to caller,
// no cron crash).

interface KvNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}

interface PushSubscription {
  token: string;
  zone_id: string;
  lang: string;
  created_at: string;
}

const PUSH_LANGS = ['en', 'vi', 'tl', 'ilo', 'haw', 'ja'];
// Expo push tokens look like ExponentPushToken[...] or ExpoPushToken[...]
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]+\]$/;

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── P08 · RATE LIMITING WITHOUT PII ───────────────────────────────────
//
// A bare sha256(ip) is NOT anonymous. IPv4 is a 2^32 keyspace — the complete
// rainbow table is computable in seconds, so an unsalted digest is a fully
// reversible identifier wearing a hash costume. Storing that would be a
// privacy regression, not a privacy measure.
//
// So the counter key is sha256(ip + dailySalt), where dailySalt itself is
// sha256(REPORTS_RL_SALT + YYYYMMDD-UTC). One static secret; the effective
// salt rotates every UTC midnight with no manual chore and no archive, so
// yesterday's digests are permanently unlinkable — including by us. Combined
// with a 10-minute KV TTL, nothing identifying survives anywhere.
//
// The raw IP is read from the request header, used to compute a digest, and
// never stored, never logged, never placed in D1 or in any response.
async function dailyRateLimitSalt(secret: string, nowSeconds: number): Promise<string> {
  const day = new Date(nowSeconds * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  return sha256Hex(`${secret}|${day}`);
}

type RateLimitVerdict = { allowed: boolean; reason?: 'per_source' | 'global' };

// Counters are CHECKED before validation but RECORDED only after a report is
// actually stored. Counting rejected submissions would mean a person who
// mistypes five times is told "you are rate limited" instead of what is
// actually wrong with their input — turning a helpful 400 into a misleading
// 429 and locking a real reporter out during an emergency.
//
// A single-source flood of INVALID payloads is therefore bounded by the
// Cloudflare WAF rate rule (layer a) and the global breaker, not by this
// counter. That is the correct division: this layer limits how many reports
// one source can PUBLISH; the edge limits how hard one source can knock.
//
// Fails OPEN on infrastructure trouble — a KV hiccup must not silence
// community fire reports.
function rateLimitKeys(nowSeconds: number): { hourKey: string } {
  return { hourKey: `rl:reports:global:${new Date(nowSeconds * 1000).toISOString().slice(0, 13)}` };
}

async function reportSourceKey(
  request: Request,
  env: Env,
  nowSeconds: number,
): Promise<string | null> {
  const secret = env.REPORTS_RL_SALT;
  const ip = request.headers.get('CF-Connecting-IP');
  // No salt means no per-source counter at all. An unsalted digest is a
  // reversible identifier, which is worse than having no counter.
  if (!secret || !ip) return null;
  const salt = await dailyRateLimitSalt(secret, nowSeconds);
  return `rl:reports:src:${await sha256Hex(`${ip}|${salt}`)}`;
}

async function checkReportRateLimit(
  request: Request,
  env: Env,
  nowSeconds: number,
): Promise<RateLimitVerdict> {
  const kv = env.KAHUOLA_CACHE as KvNamespace | undefined;
  if (!kv || typeof kv.get !== 'function') return { allowed: true };

  try {
    const { hourKey } = rateLimitKeys(nowSeconds);
    const globalRaw = await kv.get(hourKey);
    if ((globalRaw === null ? 0 : parseInt(globalRaw, 10) || 0) >= REPORT_RL_GLOBAL_MAX_PER_HOUR) {
      return { allowed: false, reason: 'global' };
    }

    const sourceKey = await reportSourceKey(request, env, nowSeconds);
    if (sourceKey) {
      const raw = await kv.get(sourceKey);
      if ((raw === null ? 0 : parseInt(raw, 10) || 0) >= REPORT_RL_MAX_PER_WINDOW) {
        return { allowed: false, reason: 'per_source' };
      }
    }
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

// Called ONLY after a report is successfully stored. Both counters expire on
// their own — no cleanup job, no lingering record, nothing to reverse.
async function recordReportRateLimit(
  request: Request,
  env: Env,
  nowSeconds: number,
): Promise<void> {
  const kv = env.KAHUOLA_CACHE as KvNamespace | undefined;
  if (!kv || typeof kv.put !== 'function') return;
  try {
    const { hourKey } = rateLimitKeys(nowSeconds);
    const globalRaw = await kv.get(hourKey);
    await kv.put(hourKey, String((globalRaw === null ? 0 : parseInt(globalRaw, 10) || 0) + 1), {
      expirationTtl: 3600,
    });

    const sourceKey = await reportSourceKey(request, env, nowSeconds);
    if (sourceKey) {
      const raw = await kv.get(sourceKey);
      await kv.put(sourceKey, String((raw === null ? 0 : parseInt(raw, 10) || 0) + 1), {
        expirationTtl: REPORT_RL_WINDOW_SECONDS,
      });
    }
  } catch {
    // Never fail a stored report because the counter could not be written.
  }
}

// ── P08 · POST /api/reports ───────────────────────────────────────────
async function handleReportCreate(
  request: Request,
  env: Env,
  cors: CorsHeaders,
): Promise<Response> {
  const db = env.REPORTS_DB;
  if (!db || typeof db.prepare !== 'function') {
    return jsonResp(
      {
        ok: false,
        error: 'reports_unconfigured',
        message: 'Community reports are not available right now. Every other hazard layer is unaffected.',
      },
      503,
      cors,
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  const rl = await checkReportRateLimit(request, env, nowSeconds);
  if (!rl.allowed) {
    return jsonResp(
      {
        ok: false,
        error: rl.reason === 'global' ? 'reports_paused' : 'rate_limited',
        message:
          rl.reason === 'global'
            ? 'Too many reports are arriving right now, so new submissions are paused briefly. Existing reports are still visible.'
            : 'You have submitted several reports in a short time. Please wait a few minutes.',
      },
      429,
      cors,
    );
  }

  // Invariant III — every bad input is DROPPED with a 400 and a named error.
  // Nothing is coerced, nothing is guessed, and nothing reaches a 500.
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResp({ ok: false, error: 'invalid_body', message: 'Expected a JSON object.' }, 400, cors);
  }
  const b = body as Record<string, unknown>;

  // Number(null) is 0 and Number('') is 0 — both would silently place a report
  // at null island. Reject anything that is not already a finite number.
  const lat = typeof b.lat === 'number' && isFinite(b.lat) ? b.lat : null;
  const lon = typeof b.lon === 'number' && isFinite(b.lon) ? b.lon : null;
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return jsonResp(
      { ok: false, error: 'invalid_coordinates', message: 'lat and lon must be finite numbers within valid ranges.' },
      400,
      cors,
    );
  }

  const region = reportRegionFor(lon, lat);
  if (!region) {
    return jsonResp(
      {
        ok: false,
        error: 'outside_coverage',
        message: 'Point is outside the Hawaiʻi and continental US areas Kahu Ola covers.',
      },
      400,
      cors,
    );
  }

  const category = typeof b.category === 'string' ? b.category.toLowerCase() : '';
  if (!(REPORT_CATEGORIES as readonly string[]).includes(category)) {
    return jsonResp(
      {
        ok: false,
        error: 'invalid_category',
        message: `category must be one of: ${REPORT_CATEGORIES.join(', ')}.`,
      },
      400,
      cors,
    );
  }

  if (typeof b.description === 'string' && b.description.length > REPORT_DESC_MAX * 4) {
    // Reject absurd payloads outright rather than truncating them silently.
    return jsonResp(
      { ok: false, error: 'description_too_long', message: `description must be ${REPORT_DESC_MAX} characters or fewer.` },
      400,
      cors,
    );
  }
  const description = sanitizeReportDescription(b.description);

  const lang = typeof b.lang === 'string' && b.lang.toLowerCase() === 'vi' ? 'vi' : 'en';
  const id = crypto.randomUUID();

  try {
    await db
      .prepare(
        'INSERT INTO reports (id, created_at, lat, lon, category, description, lang, region) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(id, nowSeconds, lat, lon, category as ReportCategory, description, lang, region)
      .run();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.error('handleReportCreate insert failure:', msg);
    return jsonResp({ ok: false, error: 'store_failed', message: 'Could not save the report. Please try again.' }, 503, cors);
  }

  // Counted only now that a report actually exists — see the note on
  // checkReportRateLimit for why rejected submissions must not count.
  await recordReportRateLimit(request, env, nowSeconds);

  return jsonResp(
    {
      ok: true,
      id,
      created_at: new Date(nowSeconds * 1000).toISOString(),
      expires_at: new Date((nowSeconds + REPORT_TTL_SECONDS) * 1000).toISOString(),
      region,
    },
    201,
    cors,
  );
}

// ── P08 · GET /api/reports ────────────────────────────────────────────
async function handleReportList(url: URL, env: Env, cors: CorsHeaders): Promise<Response> {
  const region = (url.searchParams.get('region') || 'hawaii').toLowerCase() === 'conus' ? 'conus' : 'hawaii';
  const nowSeconds = Math.floor(Date.now() / 1000);
  const generatedAt = new Date(nowSeconds * 1000).toISOString();

  const base = {
    generated_at: generatedAt,
    region,
    stale_after_seconds: FIRE_DANGER_STALE_AFTER_SECONDS,
    cross_check: {
      radius_km: REPORT_XCHECK_RADIUS_KM,
      max_hotspot_age_hours: REPORT_XCHECK_MAX_HOTSPOT_AGE_MIN / 60,
    },
    disclaimer: REPORTS_DISCLAIMER.en,
    disclaimer_vi: REPORTS_DISCLAIMER.vi,
  };

  const db = env.REPORTS_DB;
  if (!db || typeof db.prepare !== 'function') {
    // Invariant II — renderable under failure. Empty list, honest health flag.
    return jsonResp(
      { ...base, freshness: 'DEGRADED', source_health: { reports: 'unconfigured', firms: 'unknown' }, count: 0, reports: [] },
      200,
      cors,
    );
  }

  let rows: Array<Record<string, unknown>> = [];
  try {
    const cutoff = nowSeconds - REPORT_TTL_SECONDS;
    const res = await db
      .prepare(
        'SELECT id, created_at, lat, lon, category, description, lang FROM reports WHERE region = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 500',
      )
      .bind(region, cutoff)
      .all();
    rows = res.results || [];
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.error('handleReportList query failure:', msg);
    return jsonResp(
      { ...base, freshness: 'DEGRADED', source_health: { reports: 'error', firms: 'unknown' }, count: 0, reports: [] },
      200,
      cors,
    );
  }

  // Cache-first FIRMS read. This is NOT zero upstream load: on a cold cache it
  // originates the same calls the fire-danger endpoint would, sharing the same
  // FIRE_DANGER_FIRMS_TTL. Disclosed via source_health.firms so a degraded
  // ingest never silently downgrades every report to "unverified".
  let firms: FirmsIngest = { hotspots: [], volcanic_count: 0, volcanic_hotspots: [], health: 'unconfigured', sensors_used: [] };
  try {
    firms =
      region === 'conus'
        ? await fetchFirmsConus(env)
        : await fetchFirmsMultiSensor(env, REGION_BBOXES.hawaii, 1);
  } catch {
    // Leave the unconfigured default; reports still render as unverified.
  }

  const reports = rows.map((r) => {
    const createdAt = Number(r.created_at);
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    return {
      id: String(r.id),
      created_at: new Date(createdAt * 1000).toISOString(),
      age_minutes: Math.floor((nowSeconds - createdAt) / 60),
      lat,
      lon,
      category: String(r.category),
      description: r.description === null || r.description === undefined ? null : String(r.description),
      lang: String(r.lang || 'en'),
      // Recomputed on EVERY read — a report becomes satellite_confirmed the
      // moment the next overpass lands. That transition is the feature.
      verification: crossCheckReport(lat, lon, firms.hotspots, nowSeconds),
      expires_at: new Date((createdAt + REPORT_TTL_SECONDS) * 1000).toISOString(),
    };
  });

  return jsonResp(
    {
      ...base,
      freshness: firms.health === 'ok' ? 'FRESH' : 'STALE_OK',
      source_health: { reports: 'ok', firms: firms.health },
      count: reports.length,
      reports,
    },
    200,
    { ...cors, 'Cache-Control': 'no-store' },
  );
}

// Expired-row cleanup. Called from scheduled(); the 48 h threshold is
// deliberately looser than the 24 h read filter so this can never delete a row
// that is still visible.
async function deleteExpiredReports(env: Env): Promise<void> {
  const db = env.REPORTS_DB;
  if (!db || typeof db.prepare !== 'function') return;
  const cutoff = Math.floor(Date.now() / 1000) - REPORT_DELETE_AFTER_SECONDS;
  await db.prepare('DELETE FROM reports WHERE created_at < ?').bind(cutoff).run();
}

async function handlePushSubscribe(
  request: Request,
  env: Env,
  cors: CorsHeaders,
): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResp({ ok: false, error: 'invalid_json' }, 200, cors);
  }

  const token = typeof body?.token === 'string' ? body.token : '';
  const zoneId = typeof body?.zone_id === 'string' ? body.zone_id : '';
  const langRaw = typeof body?.lang === 'string' ? body.lang.toLowerCase() : 'en';
  const lang = PUSH_LANGS.includes(langRaw) ? langRaw : 'en';

  if (!EXPO_TOKEN_RE.test(token)) {
    return jsonResp({ ok: false, error: 'invalid_token' }, 200, cors);
  }
  if (!getZoneById(zoneId)) {
    return jsonResp({ ok: false, error: 'invalid_zone' }, 200, cors);
  }

  const kv = env.KAHUOLA_CACHE as KvNamespace | undefined;
  if (!kv || typeof kv.put !== 'function') {
    return jsonResp({ ok: false, error: 'kv_unavailable' }, 200, cors);
  }

  try {
    const hash = await sha256Hex(token);
    const record: PushSubscription = {
      token,
      zone_id: zoneId,
      lang,
      created_at: new Date().toISOString(),
    };
    await kv.put(`push_sub:${hash}`, JSON.stringify(record));
    return jsonResp({ ok: true, subscribed: true }, 200, cors);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.error('handlePushSubscribe failure:', msg);
    return jsonResp({ ok: false, error: 'store_failed' }, 200, cors);
  }
}

// Daily brief dispatch — called from the scheduled handler at 16:00 UTC.
// Walks all push_sub:* keys and sends each subscriber a short brief via
// the Expo Push API. Never throws; cron must not crash the Worker.
async function sendDailyBriefNotifications(env: Env): Promise<void> {
  const kv = env.KAHUOLA_CACHE as KvNamespace | undefined;
  if (!kv || typeof kv.list !== 'function') return;

  const messages: Array<{
    to: string;
    title: string;
    body: string;
    sound: 'default';
    priority: 'high';
  }> = [];

  try {
    let cursor: string | undefined;
    // Page through all subscription keys. list_complete signals end.
    for (let page = 0; page < 50; page++) {
      const listing = await kv.list({ prefix: 'push_sub:', cursor, limit: 100 });
      for (const entry of listing.keys) {
        try {
          const raw = await kv.get(entry.name);
          if (!raw) continue;
          const sub: PushSubscription = JSON.parse(raw);
          if (!EXPO_TOKEN_RE.test(sub.token)) continue;
          const zone = getZoneById(sub.zone_id);
          if (!zone) continue;

          // Build brief for this subscriber (no household info — we don't store it).
          const defaultHousehold: HouseholdProfile = {
            kupuna: false, keiki: false, pets: false, medical: false, car: true,
          };
          const state = await buildZoneDynamicState(zone, {});
          const brief = generateZoneBrief({ zone, state, household: defaultHousehold, lang: sub.lang });

          messages.push({
            to: sub.token,
            title: brief.headline,
            body: brief.what_to_do.slice(0, 180),
            sound: 'default',
            priority: 'high',
          });
        } catch (inner) {
          console.warn('push iteration error:', inner instanceof Error ? inner.message : 'unknown');
        }
      }
      if (listing.list_complete) break;
      cursor = listing.cursor;
      if (!cursor) break;
    }

    // Expo accepts batches of up to 100 messages per request.
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      try {
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(chunk),
        });
      } catch (e) {
        console.warn('expo push batch failed:', e instanceof Error ? e.message : 'unknown');
      }
    }
  } catch (e) {
    console.error('sendDailyBriefNotifications top-level failure:', e instanceof Error ? e.message : 'unknown');
  }
}

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

// ── /api/voice — spoken hazard brief (Gemma 4 script + OpenAI TTS) ────
const VALID_VOICE_LANGS = ["en", "vi", "tl", "ilo", "haw", "ja"];

async function handleVoiceRequest(
  url: URL,
  env: Env,
  cors: CorsHeaders,
): Promise<Response> {
  const zoneId = (url.searchParams.get("zone") || "").trim();
  const lang = url.searchParams.get("lang") || "en";
  const safeLang = VALID_VOICE_LANGS.includes(lang) ? lang : "en";

  const zone = getZoneById(zoneId);
  if (!zone) {
    return jsonResp(
      { ok: false, error: "zone_not_found", message: `Zone '${zoneId}' not found` },
      200,
      cors,
    );
  }

  // R2 cache check — serve cached MP3 if available
  const cacheKey = voiceCacheKey(zoneId, safeLang);
  if (env.KAHUOLA_MEDIA) {
    try {
      const cached = await env.KAHUOLA_MEDIA.get(cacheKey);
      if (cached) {
        const audio = await cached.arrayBuffer();
        return new Response(audio, {
          status: 200,
          headers: {
            ...cors,
            "Content-Type": "audio/mpeg",
            "Cache-Control": "public, max-age=3600",
            "X-Kahuola-Cache": "HIT",
            "X-Kahuola-Zone": zoneId,
            "X-Kahuola-Lang": safeLang,
          },
        });
      }
    } catch (e: unknown) {
      console.warn("R2 voice cache read failed:", e instanceof Error ? e.message : "unknown");
    }
  }

  // Build zone brief (reuse existing buildZoneDynamicState + template)
  let briefData: { headline: string; what_it_means: string; what_to_do: string; household_note: string | null };
  try {
    const state = await buildZoneDynamicState(zone, cors);
    const defaultHousehold: HouseholdProfile = {
      kupuna: false,
      keiki: false,
      pets: false,
      medical: false,
      car: true,
    };
    const brief = generateZoneBrief({ zone, state, household: defaultHousehold, lang: safeLang });
    briefData = {
      headline: brief.headline,
      what_it_means: brief.what_it_means,
      what_to_do: brief.what_to_do,
      household_note: brief.household_note,
    };
  } catch (e: unknown) {
    console.error("Voice: brief build failed:", e instanceof Error ? e.message : "unknown");
    briefData = {
      headline: zone.zone_name + ": brief unavailable",
      what_it_means: "Live hazard data temporarily unavailable.",
      what_to_do: "Check NWS Honolulu alerts at weather.gov.",
      household_note: null,
    };
  }

  // Generate voice script via Gemma 4
  const voiceInput: VoiceInput = {
    zoneId,
    lang: safeLang,
    zoneBrief: briefData,
    zoneName: zone.zone_name,
    islandName: zone.island,
  };

  const script = await generateVoiceScript(env, voiceInput);

  // Generate TTS audio via OpenAI
  if (!env.OPENAI_API_KEY) {
    return jsonResp(
      {
        ok: false,
        error: "tts_unconfigured",
        message: "OPENAI_API_KEY not configured. Script generated but TTS unavailable.",
        script,
        zone: zone.zone_name,
        lang: safeLang,
      },
      200,
      cors,
    );
  }

  const audioBuffer = await generateTTSAudio(env.OPENAI_API_KEY, script);

  if (!audioBuffer) {
    return jsonResp(
      {
        ok: false,
        error: "tts_unavailable",
        message: "Audio generation temporarily unavailable.",
        script,
        zone: zone.zone_name,
        lang: safeLang,
      },
      200,
      cors,
    );
  }

  // Write to R2 cache (best-effort — return audio even if cache write fails)
  if (env.KAHUOLA_MEDIA) {
    try {
      await env.KAHUOLA_MEDIA.put(cacheKey, audioBuffer, {
        httpMetadata: { contentType: "audio/mpeg" },
      });
    } catch (e: unknown) {
      console.warn("R2 voice cache write failed:", e instanceof Error ? e.message : "unknown");
    }
  }

  return new Response(audioBuffer, {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=3600",
      "X-Kahuola-Cache": "MISS",
      "X-Kahuola-Zone": zoneId,
      "X-Kahuola-Lang": safeLang,
    },
  });
}
