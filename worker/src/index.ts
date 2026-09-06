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
    // P29a-1: NHC's own three-way status, verbatim. BriefStatus above collapses
    // 'none' and an unreachable feed into MONITORING; this does not.
    source_status: 'active' | 'none' | 'unavailable';
    active: boolean;
    // null when source_status is 'unavailable' — a count of 0 there would be a
    // claim we cannot make.
    storms_tracked: number | null;
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
    // P29a-1: the brief binds to fetchStormPositions(), NOT handleHurricane().
    // This Promise.allSettled is already 6-way; P29a-2 adds 2N ArcGIS fetches
    // inside the handler, and inheriting that here would breach Cloudflare's
    // 6-connection cap the moment a second storm is active. Same one outbound
    // request as before — only the entry point changed.
    fetchStormPositions(),
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
  // P29a-1. `hurricane` is now a StormPositions, not a parsed envelope.
  // source_status is read from the result itself because
  // inferBriefStatusFromSettled CANNOT see an outage here: fetchStormPositions
  // (like handleHurricane before it) catches internally and always RESOLVES, so
  // `hurricaneJson.status === 'rejected'` was unreachable and an unreachable NHC
  // emitted byte-identical output to a quiet Pacific — active:false,
  // storms_tracked:0. Nothing downstream could tell them apart.
  const hurricaneSourceStatus: 'active' | 'none' | 'unavailable' =
    hurricane ? stormPositionsStatus(hurricane) : 'unavailable';
  const hurricaneUnavailable = hurricaneSourceStatus === 'unavailable';
  const hurricaneSignals = hurricane ? hurricane.storms.length : 0;
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
      // UNAVAILABLE is asserted from source_status, not from the settled state:
      // the promise always fulfils, so inferBriefStatusFromSettled would call an
      // NHC outage 'MONITORING' — the reassuring answer — every time.
      status: hurricaneUnavailable
        ? 'UNAVAILABLE'
        : inferBriefStatusFromSettled(hurricaneJson, hurricaneSignals > 0),
      source_status: hurricaneSourceStatus,
      active: hurricaneSignals > 0,
      // NULL, never 0. "We could not reach NHC" is not "we counted zero storms",
      // and a 0 here is the exact shape that let an outage read as calm.
      storms_tracked: hurricaneUnavailable ? null : hurricaneSignals,
      // Wording for the reachable cases is unchanged — stormPositionsMessage
      // reproduces the same four strings the envelope's summary.message carried.
      note: hurricane
        ? stormPositionsMessage(hurricane)
        : 'Hurricane source could not be verified right now.',
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
        // The whole brief failed to build, so NHC was not reached either. Same
        // rule as the success path: null count, never 0.
        source_status: 'unavailable',
        active: false,
        storms_tracked: null,
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

// ── PRIMARY FIRMS DATASETS — ONE SOURCE OF TRUTH ───────────────────────────
// The cache WRITER default (handleFirmsHotspots), the summary READER key
// (SUMMARY_FIRMS_KEY), the MODIS cross-reference gate and the fire-danger
// sensor list all read this. They MUST agree: writer and reader build the same
// cache key via firmsCacheKey(), so if they ever drifted the summary would read
// a key nobody writes — a permanent cache miss reporting count 0 forever.
//
// TWO SATELLITES, NOT ONE. NOAA/NESDIS ends Suomi NPP delivery 2026-11-01
// 13:00 UTC. A retired FIRMS dataset does not error: it answers HTTP 200 with a
// header-only CSV, so a layer pinned to it goes quietly blank and reads as "no
// fires". This file has already survived that once — pinned to SNPP,
// summary.fire reported count 0 / status "none" with Kīlauea plainly visible to
// the other satellites, silently disarming the standing deploy abort trigger.
// The fix is not a better single satellite; it is more than one.
//
// Both are fetched on every miss and merged (Promise.allSettled). One dataset
// dying costs coverage, never the layer. Order is fixed — it is part of the
// cache key and decides the survivor when a duplicate row is collapsed.
const FIRMS_PRIMARY_DATASETS = ['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'] as const;

// Cache-key token for the merged default set. Derived ONCE from the array above
// so reader and writer cannot land on different keys, and so adding a third
// satellite stays a one-line change that cannot re-orphan the xref gate.
const FIRMS_PRIMARY_TOKEN = FIRMS_PRIMARY_DATASETS.join('+');

// A dataset id is interpolated into the upstream URL as a path segment. Anything
// outside this shape is rejected rather than forwarded.
const FIRMS_DATASET_RE = /^[A-Za-z0-9_]{1,64}$/;

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

  // No ?dataset= → the merged NOAA-20 + NOAA-21 default that every caller in
  // the product actually uses. An explicit ?dataset= still addresses exactly ONE
  // dataset for diagnostics/comparison and keys its own cache entry, so a probe
  // can never overwrite the merged snapshot /api/hazards/summary reads back.
  const datasetParam = (url.searchParams.get('dataset') || '').trim();
  if (datasetParam && !FIRMS_DATASET_RE.test(datasetParam)) {
    return err(400, 'dataset must be a FIRMS dataset id', cors);
  }
  const datasets: readonly string[] = datasetParam ? [datasetParam] : FIRMS_PRIMARY_DATASETS;
  const keyToken = datasetParam || FIRMS_PRIMARY_TOKEN;

  const days = Math.min(10, Math.max(1, parseInt(url.searchParams.get('days') || '1', 10)));
  const limit = Math.min(5000, Math.max(1, parseInt(url.searchParams.get('limit') || String(FIRMS_DEFAULT_LIMIT), 10)));

  const bbox = resolveFirmsBBox(url);
  if (!bbox) {
    return err(400, 'bbox must be WEST,SOUTH,EAST,NORTH or scope must be hawaii|usa', cors);
  }

  const [west, south, east, north] = bbox;

  const cacheUrl = firmsCacheKey(keyToken, bbox, days, limit);   // shared builder, limit included (no drift)
  const cache = caches.default;
  const cacheReq = new Request(cacheUrl);
  const cached = await cache.match(cacheReq);
  const cachedJson = cachedJsonResponse(cached, cors);
  if (cachedJson) return cachedJson;

  const t0 = Date.now();

  // MODIS cross-reference for multi-satellite confirmation. Gated on "this is
  // the DEFAULT merged request", never on a dataset literal: a hardcoded check
  // stops firing the moment the primary set changes and detection_confidence
  // would never read 'high' again — with no error anywhere.
  const modisXrefUrl = datasetParam
    ? null
    : `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${env.NASA_FIRMS_MAP_KEY}/MODIS_NRT/${west},${south},${east},${north}/${days}`;

  // One AbortSignal.timeout PER fetch, not one shared AbortController. A shared
  // controller lets the first dataset to time out abort its healthy sibling —
  // precisely the single-point-of-failure this change exists to remove.
  // 3 outbound connections, far under OUTBOUND_CONCURRENCY_LIMIT.
  const [settled, modisCsv] = await Promise.all([
    Promise.allSettled(
      datasets.map(async (ds) => {
        // MAP_KEY appears ONLY in this upstream URL — never in a cache key,
        // never in a log line, never in the response envelope.
        const upstream =
          `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${env.NASA_FIRMS_MAP_KEY}` +
          `/${ds}/${west},${south},${east},${north}/${days}`;
        const res = await fetch(upstream, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        return res.text();
      }),
    ),
    modisXrefUrl
      ? fetch(modisXrefUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
          .then((r) => (r.ok ? r.text() : ''))
          .catch(() => '')
      : Promise.resolve(''),
  ]);

  const merged: unknown[] = [];
  const datasetsUsed: string[] = [];
  settled.forEach((r, i) => {
    const ds = datasets[i];
    if (r.status !== 'fulfilled') {
      // Structured, key-free drop log. One source failing is NOT the layer
      // failing, so it is warn + carry on — but it is never silent.
      console.warn(JSON.stringify({ layer: 'firms', stage: 'hotspots', dataset: ds, dropped: true }));
      return;
    }
    datasetsUsed.push(ds);
    // Each source is capped at `limit` before merging, so one pathological CSV
    // cannot crowd out the other; the merged set is capped again below.
    merged.push(...firmsCsvToGeojson(r.value, limit, modisCsv, ds).features);
  });

  const features = dedupeFirmsFeatures(merged).slice(0, limit);

  const body = {
    type: 'FeatureCollection',
    features,
    properties: {
      returnedRecords: features.length,
      // Unchanged shape (a string) for existing consumers; it is now the merged
      // token rather than a single dataset id.
      dataset: keyToken,
      datasets_requested: [...datasets],
      // What actually answered. A shrinking datasets_used is the ONLY way a
      // reader can tell a real quiet day from a half-dead upstream.
      datasets_used: datasetsUsed,
      health:
        datasetsUsed.length === datasets.length ? 'ok'
        : datasetsUsed.length > 0 ? 'partial'
        : 'degraded',
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

  // EVERY dataset failed. Still HTTP 200 with a valid, empty FeatureCollection so
  // the map renders its normal empty state instead of a broken layer
  // (Invariant II) — but this snapshot is deliberately NOT cached.
  //
  // That omission is load-bearing. /api/hazards/summary reads this exact key and
  // turns a cached zero into fire.status "none". Leaving the key unwritten keeps
  // the summary on 'miss' → degraded, so two dead upstreams can never be
  // reported as "no fires in Hawaiʻi" (Invariant III). The next request
  // retries upstream rather than serving the hole for 5 minutes.
  if (datasetsUsed.length === 0) return response;

  await cache.put(cacheReq, response.clone());
  return response;
}

// Collapse rows that two datasets report identically. Key = latitude + longitude
// at 4 dp (~11 m) + acq_date + acq_time, all four exact.
//
// Deliberately STRICT. NOAA-20 and NOAA-21 fly ~50 minutes apart, so the same
// physical fire seen by both is normally two different overpasses carrying two
// different acq_times — two real observations, and the newest of them is what
// the map's freshness caption is computed from. A looser spatial key would erase
// that timeline. This removes only a genuine duplicate row, never a distinct
// detection. First occurrence wins, so FIRMS_PRIMARY_DATASETS order decides the
// survivor.
//
// A feature missing coordinates or timestamps is PASSED THROUGH undeduped rather
// than given a guessed key — Invariant III: drop or keep, never infer.
function dedupeFirmsFeatures(features: readonly unknown[]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const f of features) {
    const props = (f as { properties?: Record<string, unknown> } | null)?.properties;
    const coords = (f as { geometry?: { coordinates?: unknown } } | null)?.geometry?.coordinates;
    const pair = Array.isArray(coords) ? coords : null;
    const lng = pair ? Number(pair[0]) : NaN;
    const lat = pair ? Number(pair[1]) : NaN;
    const acqDate = typeof props?.acq_date === 'string' ? props.acq_date : '';
    const acqTime = typeof props?.acq_time === 'string' ? props.acq_time : '';
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !acqDate || !acqTime) {
      out.push(f);
      continue;
    }
    const key = `${lat.toFixed(4)},${lng.toFixed(4)},${acqDate},${acqTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
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

function firmsCsvToGeojson(csv: string, limit: number, modisCsv = '', dataset = ''): { type: string; features: unknown[] } {
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
        // Which FIRMS dataset served this row. Additive. The merged endpoint
        // returns rows from more than one satellite, so a detection that cannot
        // say where it came from is not auditable.
        dataset,
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
//   · Nothing here mutates handleFirmsHotspots, its default datasets, or
//     SUMMARY_FIRMS_KEY. Cache keys are separately namespaced (see below).
// ═══════════════════════════════════════════════════════════════════════════

// Suomi NPP removed 2026-08-28. NOAA/NESDIS ends S-NPP delivery 2026-11-01
// 13:00 UTC, after which the dataset answers HTTP 200 with a header-only CSV —
// so it would sit in sensors_used forever, reported as a live contributing
// sensor, while contributing nothing. A source that is healthy in the envelope
// and dark in reality is worse than an absent one.
//
// Aliased to the hotspots primaries on purpose: both paths mean "the VIIRS
// 375 m datasets we trust", and one literal is what stops them drifting apart.
// Per-sensor cache keys are unchanged for NOAA-20/21; the SNPP key is simply
// never written or read again.
const FIRE_DANGER_SENSORS = FIRMS_PRIMARY_DATASETS;

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

  // One request per sensor, in parallel. Trivial against the 5000/10-min
  // budget, and allSettled means a dead sensor never blocks a live one — the
  // whole point of running more than one satellite.
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

// ── P29a-1 · ISLAND REFERENCE POINTS ───────────────────────────────────────
// No per-island reference POINT existed anywhere in this file — every constant
// (FIRE_DANGER_ISLANDS, SMART_HAWAII_CELLS, REGION_BBOXES) is a bbox or a ring.
// Storm distance needs a point, so one is DERIVED from the bboxes above rather
// than hand-typed: a second hand-entered coordinate set would drift silently
// against the first, and the fire layer's bboxes are already the audited ones.
//
// bbox is the tuple [west, south, east, north] (see IslandSpec), so the
// centroid is the midpoint of the W/E and S/N pairs. All eight islands are
// carried through, Niʻihau and Kahoʻolawe included — an uninhabited island is
// still a distance the reader may want, and dropping one here would silently
// bias "nearest island" toward its larger neighbour.
type IslandCentroid = { key: IslandKey; label: string; lon: number; lat: number };

const ISLAND_CENTROIDS: readonly IslandCentroid[] = FIRE_DANGER_ISLANDS.map((i) => ({
  key: i.key,
  label: i.label,
  lon: (i.bbox[0] + i.bbox[2]) / 2,
  lat: (i.bbox[1] + i.bbox[3]) / 2,
}));

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
const SUMMARY_FIRMS_KEY = firmsCacheKey(FIRMS_PRIMARY_TOKEN, REGION_BBOXES.hawaii, 1);

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
  // The alerts fetch joins the existing Promise.all rather than adding a round
  // trip: the other three are KV/cache reads, so this is the summary path's
  // ONLY outbound request and sits far under the 6-connection cap.
  //
  // P29a-1 adds ONE more: fetchStormPositions(). It joins this same Promise.all
  // rather than adding a round trip, taking the summary path to TWO outbound
  // connections (NWS alerts + NHC) — still far under the 6-connection cap, and
  // it binds to fetchStormPositions rather than handleHurricane precisely so
  // P29a-2's per-storm ArcGIS fan-out cannot land on this path.
  let [smoke, perim, fire, stormAlerts, stormPositions] = await Promise.all([
    readSummarySource(SUMMARY_SMOKE_KEY, SUMMARY_SMOKE_STATUS_KEY, nowMs),
    readSummarySource(SUMMARY_PERIM_KEY, SUMMARY_PERIM_STATUS_KEY, nowMs),
    readSummaryFirms(SUMMARY_FIRMS_KEY, nowMs),
    fetchNwsAlerts(cors, ['HI']),
    fetchStormPositions(),
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

  // ── Storm input (P29) ────────────────────────────────────────────────
  // The summary previously read fire/smoke/perimeters only, so the "Active
  // hazards" card said "No active primary hazards" while a Hurricane Warning
  // covered Hawaiʻi County.
  //
  // TROPICAL-CYCLONE events ONLY. Generic High Wind / Flood alerts belong to
  // their own layers; pulling them in here would make the top-level card cry
  // wolf on ordinary weather. "Tropical Cyclone Local Statement" is
  // deliberately excluded — a statement is narrative, not a watch or warning.
  const STORM_WARNING_EVENTS = ['hurricane warning', 'tropical storm warning', 'storm surge warning'];
  const STORM_WATCH_EVENTS = ['hurricane watch', 'tropical storm watch', 'storm surge watch'];

  let stormWarningCount = 0;
  let stormWatchCount = 0;
  let stormStatus: string;
  let stormAgeSeconds: number | null = null;

  if (!stormAlerts?.ok) {
    // Fail closed: an unreachable alerts feed is not a calm sky.
    stormStatus = 'unavailable';
  } else {
    const feats = Array.isArray(stormAlerts.data?.features) ? stormAlerts.data.features : [];
    let newestMs: number | null = null;
    for (const f of feats) {
      // Parse failure on an individual alert drops that alert, never the batch.
      const event = String(f?.properties?.event || '').toLowerCase();
      if (!event) continue;
      if (STORM_WARNING_EVENTS.some((k) => event.includes(k))) stormWarningCount++;
      else if (STORM_WATCH_EVENTS.some((k) => event.includes(k))) stormWatchCount++;
      else continue;
      const sent = Date.parse(String(f?.properties?.sent || f?.properties?.effective || ''));
      if (isFinite(sent) && (newestMs === null || sent > newestMs)) newestMs = sent;
    }
    stormStatus = stormWarningCount > 0 ? 'warning' : stormWatchCount > 0 ? 'watch' : 'none';
    if (newestMs !== null) stormAgeSeconds = Math.max(0, Math.round((nowMs - newestMs) / 1000));
  }

  // ── Pacific position context (P29a-1) ────────────────────────────────
  // NWS remains the sole AUTHORITY for watch/warning above — that block is
  // untouched. This adds the other half of the question it cannot answer: the
  // NWS feed says whether a warning is posted for Hawaiʻi, never where the
  // storm actually is. A reader looking at "no watch or warning" with three
  // hurricanes in the Pacific deserves to see them.
  //
  // Failure here degrades this sub-object ONLY. The rest of the summary must
  // still render (Invariant II), so nothing below reads stormPositions.
  const pacificStatus = stormPositionsStatus(stormPositions);
  const pacificUnavailable = pacificStatus === 'unavailable';

  // Nearest storm to any island, by the distance already computed per storm.
  // Storms whose position failed validation never reach here, so a null
  // current_position_nearest_island simply excludes that storm from the
  // comparison rather than defaulting it to zero distance.
  let pacificNearest: {
    name: string; distance_mi: number; island_label: string; bearing_compass: string;
  } | null = null;
  if (!pacificUnavailable) {
    for (const s of stormPositions.storms) {
      const n = s.current_position_nearest_island;
      if (!n) continue;
      if (pacificNearest === null || n.distance_mi < pacificNearest.distance_mi) {
        pacificNearest = {
          name: s.name,
          distance_mi: n.distance_mi,
          island_label: n.island_label,
          bearing_compass: n.bearing_compass,
        };
      }
    }
  }

  const body: Record<string, unknown> = {
    region: 'hawaii',
    generated_at: new Date(nowMs).toISOString(),
    stale: degraded,
    fire: { count: fire.count ?? 0, volcanic_zone_count: fire.volcanic_zone_count ?? 0, wildland_count: fire.wildland_count ?? 0, status: fire.status, age_seconds: fire.age_seconds, source: 'NASA FIRMS' },
    smoke: { present: (smoke.count ?? 0) > 0, count: smoke.count ?? 0, status: smoke.status, age_seconds: smoke.age_seconds, source: 'NOAA HMS' },
    perimeters: { count: perim.count ?? 0, status: perim.status, age_seconds: perim.age_seconds, source: 'NIFC WFIGS' },
    // ADDITIVE — every key above is byte-shape identical to before P29.
    storm: {
      count: stormWarningCount + stormWatchCount,
      warning_count: stormWarningCount,
      watch_count: stormWatchCount,
      status: stormStatus,
      age_seconds: stormAgeSeconds,
      source: 'NWS',
      // ADDITIVE — every storm.* key above is byte-shape identical to P29.
      // NWS is still the authority for watch/warning; NHC is position context.
      pacific: {
        source: 'NHC',
        status: pacificStatus,
        // null, NOT 0, when unavailable. Zero storms and an unreachable feed
        // are the two things this whole increment exists to keep apart.
        count: pacificUnavailable ? null : stormPositions.storms.length,
        nearest: pacificNearest,
      },
    },
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

      // NWS alerts carry a polygon OR only their affected zone codes. Until
      // P33 a zone-only alert was given [-157.8, 20.5] — a point in the Kaʻiwi
      // Channel — with nothing in the payload marking it as invented, so no
      // consumer could tell a fabricated fire-weather location from a real
      // one. On a wildfire-first platform that is the worst shape this defect
      // takes. We now emit null and say so.
      //
      // geometry_synthesized here means "there is no trustworthy geometry on
      // this feature", NOT "a point was invented" — nothing is invented any
      // more. It matches the flag /api/hazards/alerts already emits so a
      // client needs one gate, not two. The alert itself is never dropped:
      // area carries the location as text, which is what NWS actually said.
      const geometry = alert.geometry ?? null;

      return {
        type: "Feature",
        geometry,
        properties: {
          id: `fire-weather-nws-${i}`,
          event: props.event,
          headline: props.headline ?? props.event,
          area: props.areaDesc ?? "Hawaiʻi",
          // Alias of `area` under the name the alerts payload uses. With null
          // geometry the area text is the only locator a client has, and it
          // should not have to know which layer it is reading to find it.
          area_desc: props.areaDesc ?? "Hawaiʻi",
          zone_based: !alert.geometry,
          geometry_synthesized: !alert.geometry,
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
//
// P29a-1 · WHY THE FETCH IS SPLIT OUT OF THE HANDLER.
// buildMorningBrief (:1374) calls handleHurricane inside a 6-way
// Promise.allSettled, and handleHazardsSummary already holds an open NWS
// connection. P29a-2 adds 2N ArcGIS fetches (forecast track + cone, one pair
// per storm) INSIDE handleHurricane. If the brief and the summary keep calling
// the handler, they inherit that fan-out and breach Cloudflare's 6-connection
// cap the day a third storm spins up. So position fetching lives here, in one
// function with exactly one outbound request, and the two aggregate callers
// bind to IT rather than to the handler. The redirection is wired now, before
// the fan-out exists, so P29a-2 is a change to one function instead of three.

const KT_TO_MPH = 1.15078;
const KM_TO_MI = 0.621371;

// NHC issues a forecast advisory every 6 h. 9 h is one full cycle plus a 3 h
// grace window for late issuance and mirror lag — past that the advisory is
// genuinely behind, not merely between issuances.
const ADVISORY_STALE_AFTER_MS = 9 * 60 * 60 * 1000;

const COMPASS_16 = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const;

function compass16(deg: number): string {
  return COMPASS_16[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

type NearestIsland = {
  island_key: IslandKey;
  island_label: string;
  distance_mi: number;
  // Bearing FROM THE ISLAND TOWARD THE STORM — i.e. "stand on Maui, look this
  // way, the storm is out there". The opposite convention (storm → island)
  // reads as the storm's heading and would be mistaken for movement direction,
  // which is a separate field. The field name carries the direction so the two
  // can never be confused by a reader who has not opened this file.
  bearing_from_island_deg: number;
  bearing_compass: string;
};

type NormalizedStorm = {
  id: string;
  storm_id: string | null;
  bin_number: string | null;
  name: string;
  classification: string;
  lon: number;
  lat: number;
  wind_mph: number | null;
  movement: string;
  advisory_number: string | null;
  advisory_issued_at: string | null;
  advisory_stale: boolean | null;
  event_time: string | null;
  event_time_source: 'advisory' | 'last_update' | 'unknown';
  current_position_nearest_island: NearestIsland | null;
  // P29d. The Wind Speed Probabilities product URL, taken from the feed rather
  // than constructed from the basin. NHC publishes it per storm
  // (windSpeedProbabilities.url), so there is no filename pattern to guess and
  // no way to build a URL that points at another storm's product. Null when the
  // feed omits it — that becomes 'unsupported_basin', never a guessed URL.
  // INTERNAL ONLY: consumed by fetchWindProbabilities, never emitted.
  wind_prob_url: string | null;
};

type StormPositions = {
  storms: NormalizedStorm[];
  raw_count: number;
  ok: boolean;
};

// Nearest island to a storm's CURRENT position. Deliberately named for the
// current position throughout: P29a-2 adds forecast_closest_approach beside
// this, and a reader glancing at a field called merely "nearest_island" would
// have no way to tell a live measurement from a five-day projection.
function nearestIslandTo(lon: number, lat: number): NearestIsland | null {
  let best: NearestIsland | null = null;
  let bestKm = Infinity;
  for (const isl of ISLAND_CENTROIDS) {
    // haversineKm is LON-FIRST and returns KILOMETRES (:EARTH_RADIUS_KM).
    const km = haversineKm(lon, lat, isl.lon, isl.lat);
    if (!isFinite(km) || km >= bestKm) continue;
    bestKm = km;
    const bearing = bearingDeg(isl.lon, isl.lat, lon, lat);
    best = {
      island_key: isl.key,
      island_label: isl.label,
      // Statute miles, matching the existing wind_mph unit the client renders
      // with a literal " mph" suffix. NHC speaks nautical miles internally;
      // converting here keeps one unit system in the payload.
      distance_mi: Math.round(km * KM_TO_MI),
      bearing_from_island_deg: Math.round(bearing),
      bearing_compass: compass16(bearing),
    };
  }
  return best;
}

// The one outbound request on this path. No other fetch belongs in here.
async function fetchStormPositions(): Promise<StormPositions> {
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

    // Filter Pacific basin storms only (relevant to Hawaii).
    //
    // P29a-1: this previously read `s.basin || s.id`. CurrentStorms.json has NO
    // `basin` key on any storm — verified against the live feed — so the filter
    // ran entirely on `id` and only appeared correct because NHC numbers CPHC
    // storms in the EP sequence ("ep112026" for Karina, whose bin is CP5).
    // `binNumber` is the field that actually carries the basin ("EP3", "CP4",
    // "CP5"); it is read first, with `id` retained as the fallback so the pass
    // set is unchanged for any storm that lacks a bin.
    const pacificStorms = storms.filter((s: any) => {
      const basin = String(s?.binNumber || s?.id || '').toUpperCase();
      return basin.includes('CP') || basin.includes('EP') || basin.includes('CENTRAL') || basin.includes('EAST');
    });

    // NHC CurrentStorms.json has NO `center` object — the previous filter read
    // s.center.lat/.lon, which is undefined for every storm, so EVERY Pacific
    // storm was dropped and the endpoint reported "No active Pacific storms"
    // permanently. Position lives in latitudeNumeric / longitudeNumeric.
    //
    // The "16.2N" / "147.9W" strings are display text and are deliberately NOT
    // parsed as a fallback: deriving a hemisphere from a trailing letter is the
    // kind of inference Invariant III forbids. Numeric fields are authoritative;
    // anything else is dropped.
    //
    // `intensity` is in KNOTS (NHC advisory convention, confirmed by internal
    // consistency — a storm classified TS at intensity 35 must be 35 kt, since
    // 35 mph would sit below the 34 kt / 39 mph tropical-storm threshold). The
    // client renders wind_mph with a literal " mph" suffix, so it is converted
    // here rather than shipped under a mislabelled unit.
    const normalized: NormalizedStorm[] = pacificStorms
      .map((s: any, idx: number): NormalizedStorm | null => {
        const lat = s?.latitudeNumeric;
        const lon = s?.longitudeNumeric;
        // Drop, never infer. A storm we cannot place is not a storm we can draw.
        if (typeof lat !== 'number' || !isFinite(lat) || lat < -90 || lat > 90) return null;
        if (typeof lon !== 'number' || !isFinite(lon) || lon < -180 || lon > 180) return null;

        const kt = Number(s?.intensity);
        const windMph = isFinite(kt) && kt > 0 ? Math.round(kt * KT_TO_MPH) : null;

        // movementDir is degrees true, movementSpeed is knots. Both must be
        // present or the string stays empty — a half-known heading is worse
        // than none. Units are written out so the value cannot be misread.
        const dir = Number(s?.movementDir);
        const spd = Number(s?.movementSpeed);
        const movement = isFinite(dir) && isFinite(spd)
          ? `${Math.round(dir)}° at ${Math.round(spd * KT_TO_MPH)} mph`
          : '';

        // Advisory provenance. Every field is copied from CurrentStorms.json as
        // it stands; nothing here is synthesised, and an absent field is null
        // rather than a placeholder that would read as a real value.
        const issuance = typeof s?.forecastAdvisory?.issuance === 'string' && s.forecastAdvisory.issuance
          ? s.forecastAdvisory.issuance
          : null;
        const lastUpdate = typeof s?.lastUpdate === 'string' && s.lastUpdate ? s.lastUpdate : null;
        const advisoryIssuedAt = issuance ?? lastUpdate;
        const eventTimeSource: NormalizedStorm['event_time_source'] =
          issuance ? 'advisory' : lastUpdate ? 'last_update' : 'unknown';

        // NULL, not false, when the timestamp is missing. "We do not know how
        // old this advisory is" and "this advisory is current" are different
        // facts, and a false-by-default would collapse them into the reassuring
        // one — the same silent-failure family the raw_count guard below exists
        // to prevent.
        const issuedMs = advisoryIssuedAt ? Date.parse(advisoryIssuedAt) : NaN;
        const advisoryStale = isFinite(issuedMs)
          ? (Date.now() - issuedMs) > ADVISORY_STALE_AFTER_MS
          : null;

        return {
          id: s?.id || `hurricane-${idx}`,
          storm_id: typeof s?.id === 'string' && s.id ? s.id : null,
          bin_number: typeof s?.binNumber === 'string' && s.binNumber ? s.binNumber : null,
          name: s?.name || 'Unnamed Storm',
          classification: s?.classification || s?.type || 'Tropical System',
          lon,
          lat,
          wind_mph: windMph,
          movement,
          advisory_number: typeof s?.forecastAdvisory?.advNum === 'string' && s.forecastAdvisory.advNum
            ? s.forecastAdvisory.advNum
            : null,
          advisory_issued_at: advisoryIssuedAt,
          advisory_stale: advisoryStale,
          // event_time used to be the REQUEST time, so a 12-hour-old advisory
          // rendered as freshly observed. It now carries the advisory's own
          // issuance, and event_time_source says which field it came from so a
          // consumer can tell an advisory timestamp from a feed-update one.
          event_time: advisoryIssuedAt,
          event_time_source: eventTimeSource,
          current_position_nearest_island: nearestIslandTo(lon, lat),
          wind_prob_url: typeof s?.windSpeedProbabilities?.url === 'string' && s.windSpeedProbabilities.url
            ? s.windSpeedProbabilities.url
            : null,
        };
      })
      .filter((s: NormalizedStorm | null): s is NormalizedStorm => s !== null);

    // raw_count is the PACIFIC candidate count, not every storm NHC lists —
    // using the unfiltered total would make a quiet Pacific read as
    // "unavailable" whenever an Atlantic storm was active.
    return { storms: normalized, raw_count: pacificStorms.length, ok: true };
  } catch (e: unknown) {
    // Upstream unreachable is NOT a quiet Pacific. ok:false is the only thing
    // that distinguishes them; every caller must branch on it before reporting
    // a count.
    return { storms: [], raw_count: 0, ok: false };
  }
}

// Single source of truth for the three-way status every caller reports. Derived
// here rather than re-implemented per caller so the hurricane endpoint, the
// morning brief and the hazards summary can never disagree about whether the
// Pacific is quiet or the feed is down.
function stormPositionsStatus(res: StormPositions): 'active' | 'none' | 'unavailable' {
  if (!res.ok) return 'unavailable';
  if (res.storms.length > 0) return 'active';
  // Silent-failure guard, same family as the Number(null)===0 trap: "upstream
  // had no storms" and "upstream had storms we could not validate" must never
  // render as the same reassuring sentence.
  if (res.raw_count > 0) return 'unavailable';
  return 'none';
}

// The four sentences this path can say, in one place. handleHurricane and
// buildMorningBrief both render it, so an outage cannot be worded reassuringly
// in one surface and honestly in the other. Strings are unchanged from the
// pre-P29a-1 envelope so existing consumers see the same text.
function stormPositionsMessage(res: StormPositions): string {
  const status = stormPositionsStatus(res);
  // P29a-4. This said "near Hawaiʻi" while the same response reported Marie at
  // 2,311 mi with no Hawaiʻi location named in its own NHC product — a proximity
  // claim contradicted by three other fields beside it, and one that no code on
  // either side ever evaluated. The string is consumed by API clients and by
  // brief.hurricane.note, which share no notion of "near", so the honest move is
  // to drop the claim rather than refine it. Distance lives in
  // current_position_nearest_island and forecast_closest_approach, per storm,
  // where it is measured.
  if (status === 'active') return `${res.storms.length} active Pacific storm(s) tracked by NHC.`;
  if (status === 'none') return 'No active Pacific storms.';
  return res.ok
    ? 'Pacific storm data was received but could not be validated. Check the National Hurricane Center directly.'
    : 'Pacific storm data is temporarily unavailable. Check the National Hurricane Center directly.';
}


// ── P29a-2 · NHC FORECAST POINTS → TRACK + CLOSEST APPROACH ────────────────
//
// Source is the NHC ArcGIS MapServer, queried as GeoJSON. This deliberately
// replaces the TCM-text route the recon costed out: the .shtml advisory is
// 26 KB of HTML wrapping ~2 KB of fixed-width text whose position lines carry
// hemisphere LETTERS ("141.9W"), and deriving a sign from a trailing letter is
// the inference Invariant III forbids — the same class of bug as the Lala
// incident. The GeoJSON layer ships signed numeric coordinates, a numeric lead
// time and a per-point wind, so nothing has to be inferred from prose.
//
// LAYER NUMBERING RULE (derived, not guessed).
// The MapServer root listing was fetched ONCE during development. Its layers
// are grouped one block per storm bin, in the order AT1–AT5, EP1–EP5, CP1–CP5.
// The first block (AT1) begins at layer 4 and each block is 26 layers wide, so
//     block_base(bin) = 4 + 26 * (basin_index * 5 + (n - 1))
//     basin_index: AT = 0, EP = 1, CP = 2
// and within a block the offsets are fixed:
//     +0 group, +1 Forecast Information, +2 Forecast Points,
//     +3 Forecast Track, +4 Forecast Cone, …
// So Forecast Points = block_base + 2. Checked against the listing for all 15
// bins and confirmed live for three of them: 188 = "EP3 Forecast Points"
// (Marie), 344 = "CP4 Forecast Points" (Lowell), 370 = "CP5 Forecast Points"
// (Karina).
//
// The table below is written out rather than computed at request time. The
// arithmetic is the derivation, not the contract: NHC could renumber, and a
// literal table fails loudly on an unknown bin (forecast_status 'no_layer')
// where a formula would silently compute a plausible-but-wrong layer and hand
// back another storm's track. A bin absent from this table is never guessed.
const NHC_FORECAST_POINT_LAYERS: Readonly<Record<string, number>> = {
  AT1: 6,   AT2: 32,  AT3: 58,  AT4: 84,  AT5: 110,
  EP1: 136, EP2: 162, EP3: 188, EP4: 214, EP5: 240,
  CP1: 266, CP2: 292, CP3: 318, CP4: 344, CP5: 370,
};

// P29c. Forecast Cone sits at block_base + 4, i.e. two past Forecast Points
// (+2). Written out for the same reason the points table is: NHC could
// renumber, and a literal fails loudly on an unknown bin where a formula would
// compute a plausible-but-wrong layer and hand back another storm's cone.
// Confirmed live: 190 = EP3 (Marie), 346 = CP4 (Lowell), 372 = CP5 (Karina).
const NHC_FORECAST_CONE_LAYERS: Readonly<Record<string, number>> = {
  AT1: 8,   AT2: 34,  AT3: 60,  AT4: 86,  AT5: 112,
  EP1: 138, EP2: 164, EP3: 190, EP4: 216, EP5: 242,
  CP1: 268, CP2: 294, CP3: 320, CP4: 346, CP5: 372,
};

const NHC_MAPSERVER_BASE =
  'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';

// Deliberately NOT OUTBOUND_CONCURRENCY_LIMIT (6). This fan-out runs while the
// CurrentStorms.json connection has just closed and before P29c adds a second
// per-storm request for the cone; capping at 4 leaves two connections of
// headroom under Cloudflare's 6-connection ceiling for that increment to spend
// without revisiting this line.
const FORECAST_CONCURRENCY_LIMIT = 4;

// P29a-3. 'prior_advisory' and 'stale_advisory' split what used to collapse
// into 'mismatch'. CurrentStorms.json and the ArcGIS MapServer do NOT update in
// lockstep — the JSON advances first — so an exact advisory-number match made
// every forecast drop for most of each cycle. Measured live in production:
// all three storms sat at delta 1, binnumber and stormname matching, and
// forecast_ok_count was 0 with three hurricanes active. An empty map beside
// three live storms is the "absence reads as safety" failure this feature was
// built to prevent.
type ForecastStatus =
  | 'ok'                    // ArcGIS is on the same advisory as the position
  | 'prior_advisory'        // one cycle behind — KEPT, and labelled with its age
  | 'stale_advisory'        // two or more cycles behind (≥12 h) — dropped
  | 'unavailable'
  | 'mismatch'
  | 'no_layer'
  | 'insufficient_points';

const FORECAST_STATUS_KEPT: ReadonlySet<ForecastStatus> = new Set<ForecastStatus>(['ok', 'prior_advisory']);

// Outcome of verifying one ArcGIS feature against the storm it was requested
// for. A boolean could not carry the age, and the age is the whole point: a
// one-cycle-old forecast is NHC's own previous forecast for THIS storm, not
// some other storm's track, and it is shown with its age stated rather than
// silently withheld.
type ForecastVerdict =
  | { ok: true; status: 'ok' | 'prior_advisory'; ageCycles: 0 | 1 }
  | { ok: false; status: 'mismatch' | 'stale_advisory' };

type ForecastPoint = {
  tau: number;
  valid_time: string | null;
  lat: number;
  lon: number;
  max_wind_kt: number | null;
  gust_kt: number | null;
  storm_type: string | null;
};

type StormForecast = {
  // Retained from P29a-2 for payload-shape stability; same value as
  // forecast_advisory_number below, which is the name a reader can act on.
  advisory_number: string;
  // ── P29a-3 · WHOSE ADVISORY IS THIS, AND HOW OLD ────────────────────
  // The client must never have to infer the forecast's age by comparing two
  // numbers itself, and must never be able to assume the track and the marker
  // came from the same advisory. Both numbers and the delta are stated.
  forecast_advisory_number: string;
  position_advisory_number: string | null;
  forecast_advisory_age_cycles: number;   // 0 or 1; ≥2 never ships
  // ArcGIS `advdate`, VERBATIM — e.g. "500 PM HST Fri Sep 04 2026". A local
  // time with its zone spelled out, which is what a person in Hawaiʻi should
  // see. Deliberately not parsed and not converted to UTC: reformatting it
  // would mean inferring an offset from a timezone abbreviation, and the
  // string is already the honest, readable form.
  forecast_advisory_date: string | null;
  // Great-circle distance between the storm's CURRENT position and the track's
  // origin vertex. At age_cycles 1 the origin is where the storm was at the
  // previous advisory, so the line visibly does not start at the marker. This
  // number exists so P29b can say that out loud instead of leaving the user to
  // notice the gap and distrust the whole layer. ~0 when age_cycles is 0.
  track_origin_offset_mi: number | null;
  point_count: number;
  // HARDCODED false for the whole of P29a-2. The cone polygon is not fetched
  // (P29c) and NHC publishes no fetchable annual track-error table, so this
  // payload carries a centre line with NO uncertainty attached to it. A client
  // that draws the track MUST read this flag and say so: a bare line reads as
  // a promise about where the storm will be, which is the single most
  // dangerous thing this endpoint could imply.
  uncertainty_available: boolean;
  points: ForecastPoint[];
  track: { type: 'LineString'; coordinates: [number, number][] } | null;
};

type ForecastClosestApproach = {
  distance_mi: number;
  island_key: IslandKey;
  island_label: string;
  at_tau: number;
  at_valid_time: string | null;
  // True when the minimum falls on the LAST forecast point. The track may still
  // be closing when the forecast runs out, so this is a truncation warning, not
  // a result: the real closest approach may lie beyond the forecast horizon.
  is_final_point: boolean;
  // Distance to the forecast storm CENTRE. Not to tropical-storm-force winds,
  // not to the cone edge, not to hazardous conditions. The name and this
  // literal both say so because the number is otherwise easy to read as
  // "how far away the danger is".
  basis: 'forecast_center_only';
};

// P29c. 'advisory_divergence' is the cone's own failure mode and exists in no
// other status vocabulary: the cone and the forecast points come from two
// SEPARATE ArcGIS layers, so both can individually pass the CurrentStorms
// attribution guard while describing different advisories. Drawing one
// advisory's cone around another advisory's line is a pairing NHC never
// published — it looks authoritative and is fabricated.
type ConeStatus =
  | 'ok'
  | 'prior_advisory'
  | 'unavailable'
  | 'mismatch'
  | 'advisory_divergence'
  | 'no_layer';

type StormCone = {
  advisory_number: string;
  advisory_age_cycles: number;
  vertex_count: number;          // AFTER simplification
  source_vertex_count: number;   // as NHC published it
  simplified: boolean;
  max_deviation_km: number;      // 0 when simplified is false
  simplification_note?: string;
  // Ring winding is never changed, and a MultiPolygon stays a MultiPolygon.
  // Coordinates are never rounded — only whole vertices are dropped, and only
  // by Douglas–Peucker under a stated bound.
  polygon: any;
};

// ── P29c AMENDMENT · CONE SIMPLIFICATION ──────────────────────────────────
//
// Verbatim cones took the endpoint to 210 KB — 5.4x its previous size, 81% of
// it cone coordinates. The ruling: simplify the GEOMETRY, do not round the
// COORDINATES, and do not gate the cone behind a query param (the map is the
// only consumer and always wants it, so a param just hides the cost from the
// bill rather than removing it).
//
// Why the cone may be simplified when the track may not: the track is nine
// forecast POINTS, each a datum NHC published, and P29a-2 proved our line is
// identical to NHC's own vertex for vertex. The cone is a drawn envelope, not a
// set of measurements, and it is already a 67%-probability boundary rather than
// an edge anything is on one side of. Dropping vertices from it loses no datum.
//
// Douglas–Peucker, NOT "keep every Nth vertex". Uniform sampling discards
// detail exactly where the boundary curves hardest and retains it along
// straight runs — it changes the shape in a way nobody controls. DP keeps
// precisely the vertices that carry the shape and drops the ones that lie
// within a stated distance of the line they sit on.
const CONE_TOLERANCE_LADDER_KM = [0.5, 1, 2, 5] as const;
const CONE_PAYLOAD_BUDGET_BYTES = 100_000;

const KM_PER_DEG_LAT = 110.574;

// Local equirectangular projection. Over a cone spanning a few degrees the
// distortion is far below the tolerances in play, and the alternative —
// haversine inside an O(n log n) inner loop — would cost far more than the
// accuracy is worth here. The projection is only ever used to decide which
// vertices to DROP; every vertex that survives is emitted unmodified.
function coneProject(lon: number, lat: number, refLat: number): [number, number] {
  return [lon * 111.320 * Math.cos(refLat * Math.PI / 180), lat * KM_PER_DEG_LAT];
}

// Perpendicular distance in km from p to segment a-b. A zero-length segment
// degrades to point-to-point, which is what makes the closed-ring call below
// behave as the standard "split at the farthest vertex" opening move.
function coneSegDistKm(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Iterative Douglas–Peucker. Iterative rather than recursive because a cone ring
// runs to ~1600 vertices and a pathological split pattern would put that depth
// on the call stack inside a Worker.
//
// The ring arrives closed (first === last). DP is invoked across the whole
// closed span, so its opening segment is degenerate and every distance is taken
// from the first vertex — the farthest vertex is retained and splits the ring
// into two open chains, which is exactly the correct opening move for a ring.
// Both endpoints are always kept, so closure survives by construction.
function coneSimplifyRing(ring: any[], toleranceKm: number): { ring: any[]; maxDroppedKm: number } {
  const n = ring.length;
  if (n < 5) return { ring, maxDroppedKm: 0 };
  let latSum = 0;
  for (const c of ring) latSum += Number(c[1]);
  const refLat = latSum / n;
  const proj: [number, number][] = ring.map((c: any) => coneProject(Number(c[0]), Number(c[1]), refLat));

  const keep = new Uint8Array(n);
  keep[0] = 1; keep[n - 1] = 1;
  let maxDropped = 0;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;
    let dmax = 0, idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = coneSegDistKm(proj[i], proj[first], proj[last]);
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > toleranceKm && idx > 0) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    } else if (dmax > maxDropped) {
      // Every vertex in this span is being dropped, and dmax is the worst of
      // them against the segment that replaces them. Tracking it here yields the
      // TRUE maximum deviation for free, rather than trusting the tolerance.
      maxDropped = dmax;
    }
  }
  const out: any[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(ring[i]);
  // A closed ring needs at least 4 positions. If DP collapsed it further, the
  // original is kept: a degenerate ring is worse than an unsimplified one.
  if (out.length < 4) return { ring, maxDroppedKm: 0 };
  return { ring: out, maxDroppedKm: maxDropped };
}

function coneRingCount(g: any): number {
  if (!g) return 0;
  if (g.type === 'Polygon') return (g.coordinates || []).reduce((n: number, r: any) => n + (Array.isArray(r) ? r.length : 0), 0);
  if (g.type === 'MultiPolygon') return (g.coordinates || []).reduce((n: number, poly: any) => n + (Array.isArray(poly) ? poly.reduce((m: number, r: any) => m + (Array.isArray(r) ? r.length : 0), 0) : 0), 0);
  return 0;
}

// Simplifies every ring of a Polygon or MultiPolygon. Geometry TYPE is
// preserved — a MultiPolygon is never flattened to a Polygon.
function coneSimplifyGeometry(g: any, toleranceKm: number): { geometry: any; maxDroppedKm: number } {
  let worst = 0;
  const doRings = (rings: any[]) => rings.map((r: any) => {
    if (!Array.isArray(r)) return r;
    const s = coneSimplifyRing(r, toleranceKm);
    if (s.maxDroppedKm > worst) worst = s.maxDroppedKm;
    return s.ring;
  });
  if (g.type === 'Polygon') return { geometry: { type: 'Polygon', coordinates: doRings(g.coordinates || []) }, maxDroppedKm: worst };
  if (g.type === 'MultiPolygon') {
    return {
      geometry: { type: 'MultiPolygon', coordinates: (g.coordinates || []).map((poly: any) => Array.isArray(poly) ? doRings(poly) : poly) },
      maxDroppedKm: worst,
    };
  }
  return { geometry: g, maxDroppedKm: 0 };
}

function coneSimplificationNote(km: number): string {
  return `Boundary simplified for transfer. Maximum deviation from NHC's published cone: ${km} km. ` +
    "The cone itself represents a 67% probability of the storm centre's track, not a hard boundary.";
}

type ForecastResult = {
  status: ForecastStatus;
  forecast: StormForecast | null;
  closest: ForecastClosestApproach | null;
  coneStatus: ConeStatus;
  cone: StormCone | null;
};

// ArcGIS `validtime` is "DD/HHMM" in UTC — no month, no year. Rather than
// guessing a month, the day/time is anchored against two values we already
// hold as authoritative numbers: the advisory's real UTC instant from
// CurrentStorms.json, and the point's numeric lead time. The candidate month
// (previous / same / next) whose instant lands nearest advisory+tau wins, which
// makes a month or year rollover fall out of the arithmetic instead of needing
// a rule. A candidate more than 7 days from the expectation is refused: the
// forecast horizon is 120 h and the synoptic offset at most 6 h, so nothing
// legitimate is ever that far out, while the rejected months sit ~30 days away.
function forecastValidTimeIso(validtime: unknown, tau: number, advisoryIssuedAt: string | null): string | null {
  const m = /^(\d{2})\/(\d{2})(\d{2})$/.exec(String(validtime ?? '').trim());
  if (!m) return null;
  if (!advisoryIssuedAt) return null;
  const anchorMs = Date.parse(advisoryIssuedAt);
  if (!isFinite(anchorMs)) return null;
  if (!isFinite(tau)) return null;

  const day = Number(m[1]);
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  if (day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  const anchor = new Date(anchorMs);
  const targetMs = anchorMs + tau * 3_600_000;

  let bestMs: number | null = null;
  for (const monthDelta of [-1, 0, 1]) {
    const candidate = Date.UTC(
      anchor.getUTCFullYear(), anchor.getUTCMonth() + monthDelta, day, hour, minute, 0, 0,
    );
    // Date.UTC rolls a day past the month's end into the next month. Such a
    // candidate is not the date NHC wrote, so it is discarded rather than used.
    if (new Date(candidate).getUTCDate() !== day) continue;
    if (bestMs === null || Math.abs(candidate - targetMs) < Math.abs(bestMs - targetMs)) bestMs = candidate;
  }
  if (bestMs === null) return null;
  if (Math.abs(bestMs - targetMs) > 7 * 86_400_000) return null;
  return new Date(bestMs).toISOString();
}

function finiteOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Structural verification, not policy. Every feature must prove it belongs to
// the storm it was requested for before ANY of its numbers are used. A forecast
// track drawn onto the wrong storm is worse than no track at all: it is a
// confident, official-looking line pointing somewhere nobody forecast.
//
// Failure is terminal for that storm's forecast — never repaired, never
// re-requested. The position survives untouched.
function forecastFeatureVerdict(props: any, storm: NormalizedStorm): ForecastVerdict {
  // (a) bin number, exact. UNCHANGED by P29a-3 and still absolute: this and
  // (b) are what make tolerating an advisory delta safe at all. A delta of 1
  // on a different storm still drops here, before (c) is ever reached.
  const bin = String(props?.binnumber ?? '').trim();
  if (!bin || !storm.bin_number || bin !== storm.bin_number) return { ok: false, status: 'mismatch' };

  // (b) storm name, case-insensitive. A CONTAINS check, not equality: the
  // Forecast Points layer prefixes the classification ("Hurricane Karina")
  // while CurrentStorms.json carries the bare name ("Karina") — and the
  // sibling Forecast Track layer uses the bare name too, so the two NHC layers
  // do not even agree with each other. Equality would reject every real match.
  const featureName = String(props?.stormname ?? '').trim().toLowerCase();
  const stormName = String(storm.name ?? '').trim().toLowerCase();
  if (!featureName || !stormName || !featureName.includes(stormName)) return { ok: false, status: 'mismatch' };

  // (c) advisory number, GRADED by delta rather than tested for equality.
  //
  // Compared as INTEGERS: CurrentStorms.json zero-pads ("035") and ArcGIS does
  // not ("35"), so a string comparison fails on every advisory past number 9 —
  // it would look like a working guard while silently dropping every forecast.
  // NaN on either side is a mismatch, never a pass.
  const featureAdv = parseInt(String(props?.advisnum ?? ''), 10);
  const stormAdv = parseInt(String(storm.advisory_number ?? ''), 10);
  if (!Number.isFinite(featureAdv) || !Number.isFinite(stormAdv)) return { ok: false, status: 'mismatch' };

  const delta = stormAdv - featureAdv;
  if (delta === 0) return { ok: true, status: 'ok', ageCycles: 0 };
  // One cycle behind. NHC publishes every 6 h, and the GIS mirror trails the
  // JSON, so this is the normal state for part of every cycle. The track is
  // NHC's own previous forecast for this same storm — already proven by (a)
  // and (b) — and it is kept, labelled with its age and its own advisory date.
  if (delta === 1) return { ok: true, status: 'prior_advisory', ageCycles: 1 };
  // Two or more cycles is ≥12 h of drift. Past that the forecast has been
  // superseded twice over and showing it would be worse than showing nothing.
  if (delta >= 2) return { ok: false, status: 'stale_advisory' };
  // ArcGIS ahead of CurrentStorms is an ordering inversion we have no
  // explanation for. Refused rather than accepted: "newer" is an assumption,
  // and an unexplained inversion is exactly when an assumption is least safe.
  return { ok: false, status: 'mismatch' };
}

// Minimum distance from any forecast point to any island centroid.
//
// Computed ONLY across the discrete points NHC actually published. The track
// LineString below is drawn between them, but sampling along that line would
// invent positions NHC never forecast and then report a distance to one of
// them as if it were official.
function forecastClosestApproach(points: readonly ForecastPoint[]): ForecastClosestApproach | null {
  if (points.length === 0) return null;
  let best: ForecastClosestApproach | null = null;
  let bestKm = Infinity;
  let bestIdx = -1;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    for (const isl of ISLAND_CENTROIDS) {
      // haversineKm is LON-FIRST and returns KILOMETRES.
      const km = haversineKm(p.lon, p.lat, isl.lon, isl.lat);
      if (!isFinite(km) || km >= bestKm) continue;
      bestKm = km;
      bestIdx = i;
      best = {
        distance_mi: Math.round(km * KM_TO_MI),
        island_key: isl.key,
        island_label: isl.label,
        at_tau: p.tau,
        at_valid_time: p.valid_time,
        is_final_point: false,
        basis: 'forecast_center_only',
      };
    }
  }
  if (best) best.is_final_point = bestIdx === points.length - 1;
  return best;
}

// One request per storm, capped at FORECAST_CONCURRENCY_LIMIT. Called ONLY from
// handleHurricane — never from fetchStormPositions, and therefore never from
// /api/hazards/summary or the morning brief, both of which bind to
// fetchStormPositions and must keep their P29a-1 connection counts.
async function fetchForecastPoints(
  storms: readonly NormalizedStorm[],
): Promise<Map<string, ForecastResult>> {
  const out = new Map<string, ForecastResult>();

  // P29c. Points AND cone in ONE concurrency pass: 2N jobs at cap 4, so the peak
  // simultaneous outbound stays 4 rather than doubling to a second sequential
  // pass's worth of wall-clock. The CurrentStorms connection has already closed
  // before this pass opens.
  type FcJob = { storm: NormalizedStorm; layer: number; kind: 'points' | 'cone' };
  const jobs: FcJob[] = [];
  for (const s of storms) {
    const pl = s.bin_number ? NHC_FORECAST_POINT_LAYERS[s.bin_number] : undefined;
    const cl = s.bin_number ? NHC_FORECAST_CONE_LAYERS[s.bin_number] : undefined;
    // A bin we have no layer for is reported as such and never fetched. Guessing
    // a layer id would attach some other storm's forecast to this one.
    if (pl === undefined) out.set(s.id, { status: 'no_layer', forecast: null, closest: null, coneStatus: 'no_layer', cone: null });
    else jobs.push({ storm: s, layer: pl, kind: 'points' });
    if (cl !== undefined) jobs.push({ storm: s, layer: cl, kind: 'cone' });
  }

  const settled = await mapWithConcurrency(jobs, FORECAST_CONCURRENCY_LIMIT, async ({ storm, layer, kind }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const url = `${NHC_MAPSERVER_BASE}/${layer}/query?where=1%3D1&outFields=*&f=geojson`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Kahu Ola / kahuola.org' },
      });
      if (!res.ok) throw new Error(`NHC GIS ${res.status}`);
      return { storm, kind, data: await res.json() as any };
    } finally {
      // A timeout is a drop, not a retry. The storm keeps its position and
      // reports forecast_status 'unavailable'.
      clearTimeout(timer);
    }
  });

  // ── Cone pass ────────────────────────────────────────────────────────
  // Resolved first so the points pass below can cross-check advisories. Keyed
  // by storm id; a storm with no cone job simply never appears here.
  const cones = new Map<string, { status: ConeStatus; cone: StormCone | null }>();
  settled.forEach((r, i) => {
    const job = jobs[i];
    if (job.kind !== 'cone') return;
    const storm = job.storm;
    if (r.status === 'rejected') { cones.set(storm.id, { status: 'unavailable', cone: null }); return; }
    const feats = Array.isArray(r.value.data?.features) ? r.value.data.features : [];
    if (feats.length === 0) { cones.set(storm.id, { status: 'unavailable', cone: null }); return; }

    // FIX 2 — the SAME guard the track uses. binnumber exact, stormname
    // contains, advisnum as parsed integers with the graded delta. The cone
    // must never be attached to a storm it was not issued for.
    let age = 0;
    for (const f of feats) {
      const v = forecastFeatureVerdict(f?.properties, storm);
      if (!v.ok) { cones.set(storm.id, { status: 'mismatch', cone: null }); return; }
      if (v.ageCycles > age) age = v.ageCycles;
    }

    const g = feats[0]?.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) {
      cones.set(storm.id, { status: 'unavailable', cone: null });
      return;
    }
    const vertexCount = g.type === 'Polygon'
      ? (Array.isArray(g.coordinates) ? g.coordinates.reduce((n: number, ring: any) => n + (Array.isArray(ring) ? ring.length : 0), 0) : 0)
      : (Array.isArray(g.coordinates) ? g.coordinates.reduce((n: number, poly: any) => n + (Array.isArray(poly) ? poly.reduce((m: number, ring: any) => m + (Array.isArray(ring) ? ring.length : 0), 0) : 0), 0) : 0);
    if (vertexCount < 4) { cones.set(storm.id, { status: 'unavailable', cone: null }); return; }

    // Emitted UNSIMPLIFIED here. The tolerance ladder needs the whole payload's
    // size to choose a rung, and that is only knowable once every storm's
    // envelope exists — so it runs once, in handleHurricane, across all cones.
    cones.set(storm.id, {
      status: age === 1 ? 'prior_advisory' : 'ok',
      cone: {
        advisory_number: String(feats[0]?.properties?.advisnum ?? ''),
        advisory_age_cycles: age,
        vertex_count: vertexCount,
        source_vertex_count: vertexCount,
        simplified: false,
        max_deviation_km: 0,
        polygon: g,
      },
    });
  });

  settled.forEach((r, i) => {
    const job = jobs[i];
    if (job.kind !== 'points') return;
    const storm = job.storm;
    const coneRaw = cones.get(storm.id) ?? { status: 'no_layer' as ConeStatus, cone: null };
    if (r.status === 'rejected') {
      out.set(storm.id, { status: 'unavailable', forecast: null, closest: null, coneStatus: coneRaw.status, cone: coneRaw.cone });
      return;
    }
    const feats = Array.isArray(r.value.data?.features) ? r.value.data.features : [];

    // Verify FIRST, use SECOND. Nothing below this line touches an unverified
    // feature, and a single failed check discards the whole forecast for this
    // storm rather than keeping the features that happened to pass.
    let rejected: ForecastStatus | null = null;
    let ageCycles = 0;
    const verified: any[] = [];
    for (const f of feats) {
      const v = forecastFeatureVerdict(f?.properties, storm);
      if (!v.ok) { rejected = v.status; break; }
      // Every feature in a layer carries the same advisory, but each is checked
      // and the OLDEST age wins — a layer half-refreshed mid-update must be
      // described by its oldest part, never its newest.
      if (v.ageCycles > ageCycles) ageCycles = v.ageCycles;
      verified.push(f);
    }
    if (rejected) {
      out.set(storm.id, { status: rejected, forecast: null, closest: null, coneStatus: coneRaw.status, cone: coneRaw.cone });
      return;
    }

    const points: ForecastPoint[] = verified
      .map((f: any): ForecastPoint | null => {
        const coords = f?.geometry?.type === 'Point' ? f.geometry.coordinates : null;
        if (!Array.isArray(coords) || coords.length < 2) return null;
        const lon = Number(coords[0]);
        const lat = Number(coords[1]);
        // Same validation gate as the position path: drop, never infer.
        //
        // Coordinates come from the GEOMETRY, never from properties.lat/lon —
        // those are display values ROUNDED TO WHOLE DEGREES (Karina's tau=0
        // point reads lat 21 / lon -142 for a storm actually at 20.7 / -141.9).
        // Using them would displace the track by up to ~35 miles.
        if (!isFinite(lat) || lat < -90 || lat > 90) return null;
        if (!isFinite(lon) || lon < -180 || lon > 180) return null;
        const tau = Number(f?.properties?.tau);
        if (!isFinite(tau)) return null;
        return {
          tau,
          valid_time: forecastValidTimeIso(f?.properties?.validtime, tau, storm.advisory_issued_at),
          lat,
          lon,
          max_wind_kt: finiteOrNull(f?.properties?.maxwind),
          gust_kt: finiteOrNull(f?.properties?.gust),
          storm_type: typeof f?.properties?.stormtype === 'string' && f.properties.stormtype
            ? f.properties.stormtype
            : null,
        };
      })
      .filter((p: ForecastPoint | null): p is ForecastPoint => p !== null)
      .sort((a: ForecastPoint, b: ForecastPoint) => a.tau - b.tau);

    // A single point is the storm's current position restated, not a forecast
    // path, and a one-vertex LineString is not renderable. Both are reported as
    // insufficient rather than shipped as a degenerate track.
    if (points.length < 2) {
      out.set(storm.id, { status: 'insufficient_points', forecast: null, closest: null, coneStatus: coneRaw.status, cone: coneRaw.cone });
      return;
    }

    // Coordinates are passed through VERBATIM — no rounding, no smoothing, no
    // interpolation, no extension past the last point. Verified against NHC's
    // own Forecast Track layer (371): the line built this way is identical to
    // theirs vertex for vertex, down to the floating-point representation.
    // Rounding here would end that equivalence.
    const track = {
      type: 'LineString' as const,
      coordinates: points.map((p): [number, number] => [p.lon, p.lat]),
    };

    // Distance from the CURRENT position to the track's origin vertex (lowest
    // tau — tau 0 in every advisory observed). At age_cycles 1 this is the
    // 6-hour gap between where the storm was at the previous advisory and where
    // it is now, and it is the visible symptom of the lag: the line will not
    // start at the marker. Emitted in every case so a consumer can trust the
    // field to exist rather than branching on its absence.
    const trackOriginOffsetMi = Math.round(
      haversineKm(storm.lon, storm.lat, points[0].lon, points[0].lat) * KM_TO_MI,
    );

    const arcgisAdv = String(verified[0]?.properties?.advisnum ?? '');

    // ── FIX 3 · cone/track cross-check ───────────────────────────────
    // The cone and the points come from two SEPARATE layers, so both can pass
    // the CurrentStorms guard independently while describing different
    // advisories — one refreshed, the other not yet. Pairing them anyway would
    // draw an official-looking boundary around a line NHC never paired it with.
    // Compared as parsed INTEGERS for the same zero-padding reason as
    // everywhere else in this file.
    let coneStatus = coneRaw.status;
    let cone = coneRaw.cone;
    if (cone) {
      const coneAdv = parseInt(cone.advisory_number, 10);
      const trackAdv = parseInt(arcgisAdv, 10);
      if (!Number.isFinite(coneAdv) || !Number.isFinite(trackAdv) || coneAdv !== trackAdv) {
        coneStatus = 'advisory_divergence';
        cone = null;
      }
    }

    // ── FIX 5 · uncertainty_available is now DERIVED ─────────────────
    // It was hardcoded false because nothing conveyed spread. It is true only
    // when a cone actually ships, so the flag and the drawing can never
    // disagree — and it goes back to false the moment the cone drops.
    const hasCone = cone !== null && (coneStatus === 'ok' || coneStatus === 'prior_advisory');

    out.set(storm.id, {
      coneStatus,
      cone,
      status: ageCycles === 1 ? 'prior_advisory' : 'ok',
      forecast: {
        advisory_number: arcgisAdv,
        forecast_advisory_number: arcgisAdv,
        position_advisory_number: storm.advisory_number,
        forecast_advisory_age_cycles: ageCycles,
        forecast_advisory_date: typeof verified[0]?.properties?.advdate === 'string' && verified[0].properties.advdate
          ? verified[0].properties.advdate
          : null,
        track_origin_offset_mi: trackOriginOffsetMi,
        // The ACTUAL count. NHC publishes 7 points for one storm and 9 for
        // another in this very snapshot; assuming a fixed 12/24/36/48/72/96/120
        // series would silently drop or fabricate positions.
        point_count: points.length,
        uncertainty_available: hasCone,
        points,
        track,
      },
      closest: forecastClosestApproach(points),
    });
  });

  return out;
}


// ── P29d · NHC WIND SPEED PROBABILITIES FOR NAMED HAWAIʻI LOCATIONS ────────
//
// WHY THIS EXISTS. forecast_closest_approach carries basis
// 'forecast_center_only'. Lowell's centre is hundreds of miles from Niʻihau
// while its 34 kt wind field reaches far beyond the centre, so that distance
// cannot answer "when does it get dangerous here" — and a number that looks
// like it answers that question, but does not, is worse than no number. The
// Wind Speed Probabilities product is NHC's own answer, stated at named
// Hawaiʻi places.
//
// ── SOURCE CHOICE: the text product, not the ArcGIS layers ─────────────────
// Both candidates were fetched and inspected before choosing.
//
// ArcGIS "Probabilistic Winds 34 kts" (layer 395) returned 1.86 MB of 11
// MultiPolygons, ~46,000 vertices, whose only data field is `percentage` as a
// BANDED STRING ("10-20%", "<5%"). It is a contoured surface: it holds no named
// locations, so reading a value for Honolulu would mean point-in-polygon
// against a band — inventing a probability NHC did not publish at that point.
// It also carries NO attribution fields whatsoever (no stormname, binnumber or
// advisnum), so it is an aggregate over every active storm and the attribution
// guard below could not be run against it at all. Disqualified twice over.
//
// The text product carries per-storm attribution in its header and exact
// integer probabilities at named places (BARKING SANDS, LIHUE, NIIHAU, NIHOA,
// NECKER, …). Parsing it is FIXED-WIDTH COLUMN SLICING — no coordinate is ever
// derived, so the hemisphere-letter inference Invariant III forbids does not
// arise here. Grid-point rows like "20N 160W" are passed through as opaque
// labels and their coordinates are deliberately NOT parsed.
//
// ── THE ABSENCE RULE ───────────────────────────────────────────────────────
// A location row exists ONLY when its 5-day cumulative probability clears
// NHC's reporting threshold (3% for 34/50 kt, 1% for 64 kt). Therefore:
//   · a MISSING LOCATION means "below threshold" — NOT 0%
//   · a MISSING PRODUCT means "unknown" — NOT safe
//   · a literal "X" in a cell means "<1%" — NOT zero and NOT null
// These are three distinct states and they stay distinct all the way out: "X"
// ships as the string '<1', an absent location ships as no row at all, and an
// unreachable product ships as null with status 'unavailable'. Nothing here
// ever emits 0 for any of them.

const PWS_CONCURRENCY_LIMIT = FORECAST_CONCURRENCY_LIMIT;

// Status-only. NEVER used to filter, annotate, reorder or drop a row: every
// location the product contains is emitted verbatim regardless of membership
// here. This set exists solely to answer FIX 4's question "did NHC name any
// Hawaiʻi place in this product", which the 'no_hawaii_locations' status
// requires and which cannot be answered without SOME notion of which labels
// are Hawaiʻi. Deliberately generous: because rows ship either way, an
// over-broad set costs nothing, while an over-narrow one would report
// "no Hawaiʻi locations" while a Hawaiʻi row sat in the payload.
//
// Grid points ("20N 160W") are NOT included even where they lie over Hawaiian
// waters — deciding that would mean parsing a coordinate out of a hemisphere
// letter, which is exactly what Invariant III forbids.
const PWS_HAWAII_LOCATIONS: ReadonlySet<string> = new Set([
  // Main islands and installations, as NHC labels them (some truncated to the
  // product's 15-character field — kept verbatim, never expanded).
  'BARKING SANDS', 'LIHUE', 'NIIHAU', 'HONOLULU', 'JOINT BASE PHH',
  'KANEOHE', 'KAHULUI', 'HILO', 'KONA', 'KAILUA KONA', 'SOUTH POINT',
  'MOLOKAI', 'LANAI', 'KAHOOLAWE', 'KAUAI', 'MAUI', 'OAHU', 'HAWAII',
  // Northwestern Hawaiian Islands.
  'NIHOA', 'NECKER', 'FR FRIG SHOALS', 'FRENCH FRIGATE', 'GARDNER PINN',
  'MARO REEF', 'LAYSAN', 'LISIANSKI', 'PEARL HERMES', 'MIDWAY', 'KURE',
  'JOHNSTON', 'JOHNSTON ATOLL',
]);

// NDBC's 51xxx series is its Hawaii region. A documented buoy-numbering fact,
// not a coordinate derived from the label.
const PWS_HAWAII_BUOY_RE = /^BUOY\s+51\d{3}$/;

function pwsIsHawaiiLocation(name: string): boolean {
  const n = name.trim().toUpperCase();
  return PWS_HAWAII_LOCATIONS.has(n) || PWS_HAWAII_BUOY_RE.test(n);
}

// ── P29a-4 · LOCATION CLASSIFICATION ──────────────────────────────────────
//
// The client could not tell 'NIIHAU' — a place people live — from '21N 160W',
// an open-ocean grid point, using any field in the payload. The Worker was
// already computing that distinction in pwsIsHawaiiLocation and throwing it
// away, so the client's only route was to re-implement the allowlist in JS
// (a second copy, guaranteed to drift) or to read a position out of the label
// (hemisphere-letter parsing — the inference Invariant III forbids). The
// classification is emitted from where it already runs.
//
// The grid pattern matches the SHAPE of a coordinate label, not its content.
// No latitude, longitude, hemisphere or distance is ever derived from it: the
// only thing asserted is "this label is written like a coordinate, so it is not
// a place name". A grid row ships exactly as received, with island_key null.
const PWS_GRID_LABEL_RE = /^\d{1,2}[NS]\s+\d{1,3}[EW]$/;

type PwsLocationClass = 'named' | 'buoy' | 'grid' | 'other';

// 'other' is a REAL branch, not a fallthrough for tidiness. If NHC introduces a
// label form none of the three patterns recognise, it must surface as 'other'
// so the gap is visible — being silently forced into 'grid' would tell a client
// "this is open ocean" about something we did not actually recognise. Note this
// also catches a non-Hawaiʻi buoy (say 'BUOY 41043'), since the buoy rule is
// scoped to NDBC's Hawaii 51xxx series: unrecognised is the honest answer there.
function pwsLocationClass(name: string): PwsLocationClass {
  const n = name.trim().toUpperCase();
  if (PWS_HAWAII_LOCATIONS.has(n)) return 'named';
  if (PWS_HAWAII_BUOY_RE.test(n)) return 'buoy';
  if (PWS_GRID_LABEL_RE.test(n)) return 'grid';
  return 'other';
}

// ── NHC LABEL → ISLAND KEY ────────────────────────────────────────────────
// One-to-one, written out, and deliberately short. A label appears here ONLY
// when it names a place on an island that ISLAND_CENTROIDS actually holds and
// the match is unambiguous. Everything else is null — there is no fuzzy match,
// no substring match, and above all no nearest-centroid fallback.
//
// The Northwestern Hawaiian Islands (NIHOA, NECKER, FR FRIG SHOALS, GARDNER
// PINN, MARO REEF, LAYSAN, LISIANSKI, PEARL HERMES, MIDWAY, KURE) are ALL null.
// They are real islands with real people and real probabilities — Nihoa is at
// 88% for 34 kt in the current advisory — but they are not in ISLAND_CENTROIDS,
// and attaching them to the nearest main island would put Nihoa's 88% under
// Kauaʻi's name. That is a false statement about which island is at risk, and
// it is exactly the kind of quiet inference this codebase has been burned by.
// Null is the correct answer: "this is a real location we cannot key".
//
// 'HAWAII' is null too: as a bare label it is ambiguous between the island and
// the state, and guessing which would be a coin flip on a safety surface.
//
// The value type is IslandKey, so a typo fails the BUILD rather than shipping.
// The runtime assertion below additionally catches an IslandKey that is valid
// but absent from ISLAND_CENTROIDS, which typing alone cannot see.
const PWS_LABEL_TO_ISLAND: Readonly<Record<string, IslandKey>> = {
  'BARKING SANDS': 'kauai',      // PMRF, west Kauaʻi
  'LIHUE': 'kauai',
  'KAUAI': 'kauai',
  'NIIHAU': 'niihau',
  'HONOLULU': 'oahu',
  'JOINT BASE PHH': 'oahu',      // Joint Base Pearl Harbor–Hickam
  'KANEOHE': 'oahu',
  'OAHU': 'oahu',
  'KAHULUI': 'maui',
  'MAUI': 'maui',
  'MOLOKAI': 'molokai',
  'LANAI': 'lanai',
  'KAHOOLAWE': 'kahoolawe',
  'HILO': 'hawaii',
  'KONA': 'hawaii',
  'KAILUA KONA': 'hawaii',       // disambiguated from Kailua, Oʻahu by "KONA"
  'SOUTH POINT': 'hawaii',       // Ka Lae
};

// P29a-4b. This was a module-load assertion that THREW. That was wrong, and the
// reason is the blast radius rather than the check itself.
//
// ISLAND_CENTROIDS is derived from FIRE_DANGER_ISLANDS — a FIRE-layer constant.
// The realistic trigger is not a deliberate cast: it is someone editing
// fire-danger to remove or rename an island. tsc still passes as long as the key
// remains in the IslandKey union, and the Worker then refuses to boot at module
// scope. A hurricane display-label table would take down /api/hazards/summary,
// and with it the FIRMS fire signal, on a wildfire-first platform. That is an
// Invariant II violation: one layer's config drift must never remove another
// layer's data.
//
// Not emitting an unresolvable key is still correct. Refusing to serve is not.
// So the check stays and the consequence changes: the key resolves to null and
// the degradation is REPORTED in the payload rather than swallowed.
//
// The compile-time guard is untouched — PWS_LABEL_TO_ISLAND is typed
// Readonly<Record<string, IslandKey>>, so an honest typo still fails the build
// before it can reach a commit. This path only catches the case typing cannot
// see: a key valid in the union but no longer carried by ISLAND_CENTROIDS.
function pwsResolveIslandKey(name: string): { key: IslandKey | null; degraded: boolean } {
  const mapped = PWS_LABEL_TO_ISLAND[name.trim().toUpperCase()];
  // No mapping is the ordinary case — grid points, buoys, every NWHI island.
  // Not a degradation, just an honest null.
  if (mapped === undefined) return { key: null, degraded: false };
  // Mapped, but the distance layer no longer carries that island. Emitting the
  // key would hand a consumer an id it cannot resolve; emitting null quietly
  // would hide a real config drift. Do neither: null AND say so.
  if (!ISLAND_CENTROIDS.some((i) => i.key === mapped)) return { key: null, degraded: true };
  return { key: mapped, degraded: false };
}

type WindProbStatus =
  | 'ok'
  | 'no_hawaii_locations'
  | 'prior_advisory'
  | 'unavailable'
  | 'mismatch'
  | 'unsupported_basin';

// A probability is either an exact integer percent, or the literal '<1' for the
// product's "X". '<1' is a REAL READING meaning "below one percent" — it is not
// missing data and it is not zero. Typing it as a string union rather than
// coercing to a number is what stops a downstream `?? 0` from erasing it.
type WindProbValue = number | '<1';

type WindProbWindow = {
  tau: number;
  incremental_pct: WindProbValue;   // chance of onset WITHIN this window
  cumulative_pct: WindProbValue;    // chance of onset by the end of it
};

type WindProbLocation = {
  // VERBATIM from the product, truncations included ("JOINT BASE PHH",
  // "FR FRIG SHOALS"). Not expanded, not normalised, not mapped to an island
  // key or a coordinate — every one of those would be a guess, and how to
  // display a place name is a display concern.
  name: string;
  // P29a-4. Derived from the label's SHAPE and from the allowlist — never from
  // reading a coordinate out of the label. Classifies, never filters: every row
  // the product contains ships regardless of class.
  location_class: PwsLocationClass;
  // Non-null ONLY for an unambiguous main-island place present in
  // ISLAND_CENTROIDS. Null for every NWHI island, every buoy, every grid point
  // and every label we cannot key with confidence — see PWS_LABEL_TO_ISLAND.
  island_key: IslandKey | null;
  threshold_kt: number;             // 34 | 50 | 64
  windows: WindProbWindow[];
  peak_cumulative_pct: WindProbValue;
};

type WindProbabilities = {
  status: WindProbStatus;
  advisory_number: string;
  advisory_age_cycles: number;
  locations: WindProbLocation[];
  // ── ROW COUNTS (compatibility) ──────────────────────────────────────
  // location_count and hawaii_location_count count ROWS, not locations: a
  // location contributes up to three rows, one per wind threshold. The names
  // say "location" and the values do not, which is a naming defect — but both
  // are already published, and silently changing what a shipped field counts is
  // worse than a bad name. They are frozen. DISPLAY THE distinct_* FIELDS
  // BELOW; for Lowell today these read 49 rows against 21 distinct locations.
  location_count: number;
  // Kept even when status is 'prior_advisory' so the "NHC named no Hawaiʻi
  // place" fact is never masked by the status precedence below.
  hawaii_location_count: number;
  // ── HONEST COUNTS (P29a-4) ──────────────────────────────────────────
  row_count: number;                      // == location_count, correctly named
  distinct_location_count: number;        // distinct labels of any class
  distinct_hawaii_location_count: number; // distinct 'named' + 'buoy'
  // Distinct 'named' only. THIS is the number to put in front of a person:
  // places, not rows, not buoys, not ocean grid points.
  distinct_named_place_count: number;
  // P29a-4b. True when a label in this storm's rows mapped to an island key
  // ISLAND_CENTROIDS no longer carries — its island_key is null and this says
  // why. Normally false; a true here means the label table and the fire layer's
  // island list have drifted apart and someone should look.
  island_key_map_degraded: boolean;
  below_threshold_note: string;
};

type WindProbResult = { status: WindProbStatus; probabilities: WindProbabilities | null };

const PWS_BELOW_THRESHOLD_NOTE =
  "Locations absent from this product are below NHC's reporting threshold " +
  '(3% for 34/50 kt, 1% for 64 kt), not at zero probability.';

// The product is plain ASCII inside a <pre>; the only entities the page can
// introduce are the five XML ones. A full HTML decoder is not warranted and an
// unknown entity is left as-is rather than guessed at — a stray "&foo;" in a
// label is preferable to a mangled one.
function decodeBasicEntities(s: string): string {
  return s
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');   // last, so "&amp;lt;" does not become "<"
}

// "X" -> '<1'. Any other token must parse to a finite integer or the row is
// refused: a half-read row is not a row worth shipping.
function pwsValue(tok: string): WindProbValue | null {
  const t = tok.trim().toUpperCase();
  if (t === 'X') return '<1';
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

// '<1' sorts below every integer. Never resolved to 0 for the comparison.
function pwsPeak(windows: readonly WindProbWindow[]): WindProbValue {
  let peak: WindProbValue = '<1';
  for (const w of windows) {
    const c = w.cumulative_pct;
    if (typeof c === 'number' && (peak === '<1' || c > peak)) peak = c;
  }
  return peak;
}

type PwsParsed = {
  stormName: string;
  advisoryNumber: number;
  advisoryNumberRaw: string;
  locations: WindProbLocation[];
  // True when at least one row in THIS product mapped to an island key that
  // ISLAND_CENTROIDS no longer carries. Accumulated during the parse so it
  // describes exactly the rows that shipped, not the whole table.
  islandKeyMapDegraded: boolean;
};

// Fixed-width parse. Column geometry, verified against the live product:
//   cols  0-14  location label (15 wide; holds embedded spaces, so this MUST be
//               sliced by position — a whitespace split would shred
//               "BARKING SANDS" and "FR FRIG SHOALS")
//   cols 15-16  threshold in kt
//   cols 17+    one bare value for the first window, then six "N(C)" pairs
// Lead times are read from the product's own "FORECAST HOUR" line rather than
// hardcoded, so a change to the window series is inherited instead of silently
// mislabelled.
function parsePwsProduct(text: string): PwsParsed | null {
  const headerRe = /^(.*?)\s+WIND SPEED PROBABILITIES NUMBER\s+(\d+)\s*$/im;
  const h = headerRe.exec(text);
  if (!h) return null;
  const advisoryNumberRaw = h[2];
  const advisoryNumber = parseInt(advisoryNumberRaw, 10);
  if (!Number.isFinite(advisoryNumber)) return null;
  // "HURRICANE LOWELL" / "TROPICAL STORM KARINA" — the classification prefix is
  // kept; the attribution guard does a containment test, exactly as the
  // forecast-track guard does for the same reason.
  const stormName = h[1].trim();

  const lines = text.split('\n');
  const fhLine = lines.find((l) => l.trim().startsWith('FORECAST HOUR'));
  if (!fhLine) return null;
  const taus = (fhLine.match(/\((\d+)\)/g) || []).map((m) => parseInt(m.slice(1, -1), 10));
  if (taus.length === 0 || taus.some((t) => !Number.isFinite(t))) return null;

  const locations: WindProbLocation[] = [];
  let islandKeyMapDegraded = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.length < 18) continue;
    const kt = parseInt(line.slice(15, 17), 10);
    if (kt !== 34 && kt !== 50 && kt !== 64) continue;
    const name = line.slice(0, 15).trim();
    if (!name) continue;

    const rest = line.slice(17);
    // First window is printed bare (no parentheses): within the opening period
    // the incremental and cumulative chances are the same number, which the
    // live product confirms arithmetically — for 15N 165W, 1 then 62(63).
    const firstM = /^\s*(\d+|X)(?=\s)/i.exec(rest);
    if (!firstM) continue;
    const pairs = [...rest.matchAll(/(\d+|X)\s*\(\s*(\d+|X)\s*\)/gi)];
    if (pairs.length + 1 !== taus.length) continue;   // shape changed — refuse the row

    const first = pwsValue(firstM[1]);
    if (first === null) continue;
    const windows: WindProbWindow[] = [{ tau: taus[0], incremental_pct: first, cumulative_pct: first }];
    let bad = false;
    for (let i = 0; i < pairs.length; i++) {
      const inc = pwsValue(pairs[i][1]);
      const cum = pwsValue(pairs[i][2]);
      if (inc === null || cum === null) { bad = true; break; }
      windows.push({ tau: taus[i + 1], incremental_pct: inc, cumulative_pct: cum });
    }
    if (bad) continue;

    const island = pwsResolveIslandKey(name);
    if (island.degraded) islandKeyMapDegraded = true;
    locations.push({
      name,
      location_class: pwsLocationClass(name),
      island_key: island.key,
      threshold_kt: kt,
      windows,
      peak_cumulative_pct: pwsPeak(windows),
    });
  }

  return { stormName, advisoryNumber, advisoryNumberRaw, locations, islandKeyMapDegraded };
}

// Attribution, to the same standard as the forecast-track guard. The product
// must prove it is this storm's before a single number is read from it.
// Advisory numbers are compared as PARSED INTEGERS — CurrentStorms zero-pads
// ("037") and the product header does not ("37") — and a delta of exactly 1 is
// tolerated as prior_advisory, matching the graded rule already shipped for the
// GIS lag. Anything else drops the whole block.
function pwsVerdict(parsed: PwsParsed, storm: NormalizedStorm): ForecastVerdict {
  const featureName = parsed.stormName.trim().toLowerCase();
  const stormName = String(storm.name ?? '').trim().toLowerCase();
  if (!featureName || !stormName || !featureName.includes(stormName)) return { ok: false, status: 'mismatch' };

  const stormAdv = parseInt(String(storm.advisory_number ?? ''), 10);
  if (!Number.isFinite(stormAdv) || !Number.isFinite(parsed.advisoryNumber)) return { ok: false, status: 'mismatch' };

  const delta = stormAdv - parsed.advisoryNumber;
  if (delta === 0) return { ok: true, status: 'ok', ageCycles: 0 };
  if (delta === 1) return { ok: true, status: 'prior_advisory', ageCycles: 1 };
  if (delta >= 2) return { ok: false, status: 'stale_advisory' };
  return { ok: false, status: 'mismatch' };
}

// One request per storm, capped. Called ONLY from handleHurricane — never from
// fetchStormPositions, so /api/hazards/summary and the morning brief cannot
// reach it and cannot be changed by a PWS outage.
async function fetchWindProbabilities(
  storms: readonly NormalizedStorm[],
): Promise<Map<string, WindProbResult>> {
  const out = new Map<string, WindProbResult>();

  // No URL in the feed means no product to ask for. Reported as such rather
  // than guessed at from the basin.
  for (const s of storms) {
    if (!s.wind_prob_url) out.set(s.id, { status: 'unsupported_basin', probabilities: null });
  }
  const fetchable = storms.filter((s): s is NormalizedStorm & { wind_prob_url: string } => !!s.wind_prob_url);

  const settled = await mapWithConcurrency(fetchable, PWS_CONCURRENCY_LIMIT, async (storm) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(storm.wind_prob_url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Kahu Ola / kahuola.org' },
      });
      if (!res.ok) throw new Error(`NHC PWS ${res.status}`);
      return { storm, body: await res.text() };
    } finally {
      // A timeout is a drop, not a retry.
      clearTimeout(timer);
    }
  });

  settled.forEach((r, i) => {
    const storm = fetchable[i];
    // Fetch failure is UNKNOWN, never safe. It must not look like a quiet sky.
    if (r.status === 'rejected') {
      out.set(storm.id, { status: 'unavailable', probabilities: null });
      return;
    }

    // The product is served as HTML with the text inside a single <pre>.
    const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(r.value.body);
    const text = pre ? decodeBasicEntities(pre[1]) : '';
    const parsed = text ? parsePwsProduct(text) : null;
    if (!parsed) {
      // Could not read it — same state as could not fetch it. Not zero.
      out.set(storm.id, { status: 'unavailable', probabilities: null });
      return;
    }

    const verdict = pwsVerdict(parsed, storm);
    if (!verdict.ok) {
      // stale_advisory collapses into 'mismatch' here: this endpoint's PWS
      // status vocabulary has no stale state, and refusing is the same action.
      out.set(storm.id, { status: 'mismatch', probabilities: null });
      return;
    }

    const hawaiiCount = parsed.locations.reduce((n, l) => n + (pwsIsHawaiiLocation(l.name) ? 1 : 0), 0);

    // Distinct LOCATIONS, keyed on the verbatim label. Each contributes up to
    // three rows (34/50/64 kt), which is the whole reason the row counts above
    // read so much higher than the number of places involved.
    const distinctNames = new Set<string>();
    const distinctHawaii = new Set<string>();
    const distinctNamed = new Set<string>();
    for (const l of parsed.locations) {
      distinctNames.add(l.name);
      if (l.location_class === 'named' || l.location_class === 'buoy') distinctHawaii.add(l.name);
      if (l.location_class === 'named') distinctNamed.add(l.name);
    }

    // Status precedence: age caveat outranks the Hawaiʻi-presence report,
    // because a stale reading is the more important thing to say about the
    // whole block. hawaii_location_count is emitted either way, so choosing
    // 'prior_advisory' here never hides the "no Hawaiʻi rows" fact.
    const status: WindProbStatus =
      verdict.ageCycles === 1 ? 'prior_advisory'
        : hawaiiCount === 0 ? 'no_hawaii_locations'
          : 'ok';

    // NOTE the object is emitted even for 'no_hawaii_locations'. That is the
    // whole point of the state: "NHC published this and named no Hawaiʻi place"
    // is EVIDENCE, and it must not be confused with 'unavailable', which is the
    // absence of evidence and ships null. An empty array alone could never
    // carry that distinction.
    out.set(storm.id, {
      status,
      probabilities: {
        status,
        advisory_number: parsed.advisoryNumberRaw,
        advisory_age_cycles: verdict.ageCycles,
        locations: parsed.locations,
        location_count: parsed.locations.length,
        hawaii_location_count: hawaiiCount,
        row_count: parsed.locations.length,
        distinct_location_count: distinctNames.size,
        distinct_hawaii_location_count: distinctHawaii.size,
        distinct_named_place_count: distinctNamed.size,
        island_key_map_degraded: parsed.islandKeyMapDegraded,
        below_threshold_note: PWS_BELOW_THRESHOLD_NOTE,
      },
    });
  });

  return out;
}

async function handleHurricane(cors: CorsHeaders): Promise<Response> {
  const res = await fetchStormPositions();

  if (!res.ok) {
    // Upstream unreachable is NOT the same as a quiet Pacific. Reporting 'none'
    // here meant an NHC outage during a hurricane warning read as reassuring
    // calm — the same silent-failure family raw_count was added to prevent on
    // the validation path. Fail closed and say so.
    //
    // stale_after_seconds matches the success path: omitting it handed a client
    // `undefined` for freshness at precisely the moment the data was worst.
    return jsonResp({
      ...buildHazardEnvelope('hurricane', 'NHC', 'hawaii', [],
        {
          status: 'unavailable',
          count: 0,
          raw_count: 0,
          message: 'Pacific storm data is temporarily unavailable. Check the National Hurricane Center directly.',
        }, {}
      ),
      stale_after_seconds: 1800,
    }, 200, cors);
  }

  // P29a-2. Forecast fetching lives HERE and nowhere else: this is the only
  // caller of fetchForecastPoints, so the summary and the morning brief — both
  // bound to fetchStormPositions — cannot inherit the per-storm fan-out.
  //
  // A forecast failure must never degrade the position layer. Positions are
  // independently valid: they came from a different upstream that already
  // succeeded, and a storm whose track we could not draw is still a storm the
  // reader needs to see on the map. So this is wrapped, and a total collapse
  // leaves every storm with forecast null / forecast_status 'unavailable' while
  // summary.status stays 'active'.
  let forecasts: Map<string, ForecastResult>;
  try {
    forecasts = await fetchForecastPoints(res.storms);
  } catch {
    forecasts = new Map();
  }

  // P29d. A SECOND sequential pass, not a widening of the first: the forecast
  // fan-out has fully settled before this one opens a connection, so the peak
  // simultaneous outbound for this endpoint stays at the per-pass cap (4) rather
  // than summing to 8. Wrapped for the same reason the forecast fetch is — a
  // probabilities outage must leave positions, tracks and closest-approach
  // values completely untouched.
  let windProbs: Map<string, WindProbResult>;
  try {
    windProbs = await fetchWindProbabilities(res.storms);
  } catch {
    windProbs = new Map();
  }

  const signals: Feature[] = res.storms.map((s): Feature => {
    const f = forecasts.get(s.id) ?? { status: 'unavailable' as ForecastStatus, forecast: null, closest: null, coneStatus: 'unavailable' as ConeStatus, cone: null };
    const wp = windProbs.get(s.id) ?? { status: 'unavailable' as WindProbStatus, probabilities: null };
    return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    properties: {
      id: s.id,
      source: 'National Hurricane Center',
      source_label: 'NHC',
      name: s.name,
      classification: s.classification,
      wind_mph: s.wind_mph,
      movement: s.movement,
      risk_index: 'HIGH',
      severity: 'HIGH',
      event_time: s.event_time,
      note: 'Active Pacific storm. Monitor NHC for official track and cone.',
      // ── ADDITIVE (P29a-1). Every field above is byte-shape identical to
      // pre-P29a-1 except event_time, which now carries the advisory issuance
      // instead of the request time.
      storm_id: s.storm_id,
      bin_number: s.bin_number,
      advisory_number: s.advisory_number,
      advisory_issued_at: s.advisory_issued_at,
      advisory_stale: s.advisory_stale,
      event_time_source: s.event_time_source,
      current_position_nearest_island: s.current_position_nearest_island,
      // ── ADDITIVE (P29a-2) ───────────────────────────────────────────
      // current_position_nearest_island above is UNCHANGED and stays. The two
      // distances answer different questions — where the storm is now, versus
      // how close NHC forecasts it will come — and must never be conflated,
      // which is why both names carry their own tense.
      forecast_status: f.status,
      forecast: f.forecast,
      forecast_closest_approach: f.closest,
      // ── ADDITIVE (P29c) ─────────────────────────────────────────────
      // The cone describes where the storm's CENTRE may travel. It is NOT a
      // damage boundary, and a reader who treats "outside the cone" as "safe"
      // has been misled — which is why the client is required to caption it
      // alongside the per-location wind probabilities.
      cone_status: f.coneStatus,
      cone: f.cone,
      // ── ADDITIVE (P29d) ─────────────────────────────────────────────
      // The honest counterpart to forecast_closest_approach. That field is a
      // distance to the forecast CENTRE; this is NHC's own probability of
      // damaging wind arriving AT a named place. A consumer showing the
      // distance without these is implying an answer the distance cannot give.
      wind_probabilities_status: wp.status,
      wind_probabilities: wp.probabilities,
    },
    };
  });

  // A storm absent from the map defaults to 'unavailable' — the same default
  // the signal loop above applies — so the three counters always sum to
  // forecast_total_count and a missing entry can never go uncounted.
  // ── P29c AMENDMENT · tolerance ladder ────────────────────────────────
  // The rung is chosen by MEASURING the serialised payload, not by guessing.
  // Smallest tolerance that brings the whole response under budget wins, so a
  // quiet Pacific with one small cone keeps near-full fidelity and only a busy
  // one pays. Escalating at request time also means the choice tracks the storm
  // count instead of being tuned to whatever three storms happened to be up the
  // day it was written.
  //
  // If even the largest rung cannot fit, the largest rung is used anyway and
  // the payload is simply large: silently DROPPING cones to hit a byte target
  // would trade a size problem for a safety one.
  const coneList = signals
    .map((f) => (f.properties as any).cone as (StormCone | null))
    .filter((c): c is StormCone => !!c);

  if (coneList.length) {
    const originals = coneList.map((c) => c.polygon);
    const baseBytes = JSON.stringify(signals).length
      - originals.reduce((n, g) => n + JSON.stringify(g).length, 0);
    for (let rung = 0; rung < CONE_TOLERANCE_LADDER_KM.length; rung++) {
      const tol = CONE_TOLERANCE_LADDER_KM[rung];
      const simplified = originals.map((g) => coneSimplifyGeometry(g, tol));
      const bytes = baseBytes + simplified.reduce((n, s2) => n + JSON.stringify(s2.geometry).length, 0);
      const lastRung = rung === CONE_TOLERANCE_LADDER_KM.length - 1;
      if (bytes < CONE_PAYLOAD_BUDGET_BYTES || lastRung) {
        coneList.forEach((c, i) => {
          c.polygon = simplified[i].geometry;
          c.vertex_count = coneRingCount(simplified[i].geometry);
          c.simplified = c.vertex_count < c.source_vertex_count;
          c.max_deviation_km = c.simplified ? tol : 0;
          // Never claim simplified:false while the geometry has in fact been
          // reduced — the flag is derived from the vertex counts, not asserted.
          if (c.simplified) c.simplification_note = coneSimplificationNote(tol);
          else delete c.simplification_note;
        });
        break;
      }
    }
  }

  const forecastOkCount = res.storms.reduce(
    (n, s) => n + ((forecasts.get(s.id)?.status ?? 'unavailable') === 'ok' ? 1 : 0), 0,
  );
  // P29a-3. Kept separate from ok_count rather than folded into it: ok_count
  // keeps its P29a-2 meaning of "current advisory", so a consumer already
  // reading it is not silently handed older forecasts under the same name.
  const forecastPriorCount = res.storms.reduce(
    (n, s) => n + ((forecasts.get(s.id)?.status ?? 'unavailable') === 'prior_advisory' ? 1 : 0), 0,
  );
  // Everything not shown: stale_advisory, mismatch, unavailable, no_layer,
  // insufficient_points. Derived from the kept set rather than by listing the
  // drop statuses, so a status added later is counted as dropped by default —
  // failing closed instead of vanishing from every counter.
  // Counts a cone that actually SHIPS — 'ok' or 'prior_advisory' with a
  // non-null polygon. Matches exactly what uncertainty_available reports.
  const coneOkCount = res.storms.reduce((n, s) => {
    const f = forecasts.get(s.id);
    return n + ((f?.cone && (f.coneStatus === 'ok' || f.coneStatus === 'prior_advisory')) ? 1 : 0);
  }, 0);
  const windProbOkCount = res.storms.reduce(
    (n, s) => n + ((windProbs.get(s.id)?.status ?? 'unavailable') === 'ok' ? 1 : 0), 0,
  );
  const forecastDroppedCount = res.storms.reduce(
    (n, s) => n + (FORECAST_STATUS_KEPT.has(forecasts.get(s.id)?.status ?? 'unavailable') ? 0 : 1), 0,
  );

  const envelope = buildHazardEnvelope('hurricane', 'NHC', 'hawaii', signals,
    {
      // Unchanged: driven by POSITION availability only. A forecast outage is
      // reported per storm in forecast_status and in the two counts below; it
      // must not make an endpoint full of real storm positions read as broken.
      status: stormPositionsStatus(res),
      count: signals.length,
      raw_count: res.raw_count,
      // Wording deliberately untouched in this increment — the "near Hawaiʻi"
      // claim that no code evaluates is P29b's to fix.
      message: stormPositionsMessage(res),
      // ok_count keeps its P29a-2 semantics: current-advisory forecasts ONLY.
      forecast_ok_count: forecastOkCount,
      forecast_prior_count: forecastPriorCount,
      forecast_dropped_count: forecastDroppedCount,
      forecast_total_count: signals.length,
      cone_ok_count: coneOkCount,
      cone_total_count: signals.length,
      // ok_count counts storms whose probabilities were read AND verified AND
      // named at least one Hawaiʻi place. 'no_hawaii_locations' is deliberately
      // NOT counted here — it is a successful read, but counting it as ok would
      // let "NHC named nowhere in Hawaiʻi" and "NHC named Niʻihau at 35%" share
      // a number. The per-storm status carries that distinction.
      wind_prob_ok_count: windProbOkCount,
      wind_prob_total_count: signals.length,
    }, { authority: 'official', note: 'National Hurricane Center active storm data.' });
  return jsonResp({ ...envelope, stale_after_seconds: 1800 }, 200, cors);
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
