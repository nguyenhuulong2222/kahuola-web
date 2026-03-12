/**
 * Kahu Ola — Tile Broker Worker V4.6 Hawaii Smart Flood Edition
 * Routes: kahuola.org/api/*
 * Notes:
 * - Preserves existing tiles/FIRMS broker structure
 * - Adds statewide Hawaiʻi flood intelligence routes
 * - Official flash-flood polygons come from NWS alerts
 * - Context/radar layers use smart island cells instead of coarse rectangles
 */

export interface Env {
  NASA_FIRMS_MAP_KEY: string;
  AIRNOW_API_KEY: string;
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

const SMART_HAWAII_CELLS: IslandCell[] = [
  {
    id: 'kauai-north-windward', island: 'Kauaʻi', zone: 'North Windward', terrain: 'WINDWARD', coastalExposure: 'MODERATE', runoff: 'HIGH', drainage: 'Hanalei and north shore drainages',
    ring: [[-159.75,22.20],[-159.40,22.23],[-159.32,22.02],[-159.56,21.94],[-159.78,22.03],[-159.75,22.20]],
  },
  {
    id: 'kauai-south-lowland', island: 'Kauaʻi', zone: 'South Coastal Lowland', terrain: 'COASTAL', coastalExposure: 'HIGH', runoff: 'MODERATE', drainage: 'Poʻipū to Līhuʻe lowlands',
    ring: [[-159.70,21.96],[-159.42,21.98],[-159.34,21.84],[-159.53,21.75],[-159.72,21.82],[-159.70,21.96]],
  },
  {
    id: 'oahu-windward', island: 'Oʻahu', zone: 'Koʻolau Windward', terrain: 'WINDWARD', coastalExposure: 'MODERATE', runoff: 'HIGH', drainage: 'Kāneʻohe and Koʻolau valleys',
    ring: [[-158.15,21.59],[-157.67,21.58],[-157.60,21.40],[-157.78,21.28],[-158.05,21.33],[-158.15,21.59]],
  },
  {
    id: 'oahu-honolulu-lowland', island: 'Oʻahu', zone: 'Honolulu Urban Lowland', terrain: 'URBAN_LOWLAND', coastalExposure: 'HIGH', runoff: 'MODERATE', drainage: 'Honolulu stormwater corridor',
    ring: [[-158.08,21.37],[-157.70,21.37],[-157.67,21.22],[-157.91,21.19],[-158.09,21.26],[-158.08,21.37]],
  },
  {
    id: 'molokai-east', island: 'Molokaʻi', zone: 'East Valley Slopes', terrain: 'VALLEY', coastalExposure: 'MODERATE', runoff: 'HIGH', drainage: 'East Molokaʻi stream gullies',
    ring: [[-156.98,21.18],[-156.48,21.19],[-156.42,21.01],[-156.65,20.94],[-156.95,20.99],[-156.98,21.18]],
  },
  {
    id: 'lanai-south', island: 'Lānaʻi', zone: 'South Slope', terrain: 'LEEWARD', coastalExposure: 'MODERATE', runoff: 'LOW', drainage: 'Lānaʻi south slope runoff',
    ring: [[-157.08,20.88],[-156.80,20.89],[-156.76,20.69],[-156.97,20.63],[-157.10,20.75],[-157.08,20.88]],
  },
  {
    id: 'maui-windward', island: 'Maui', zone: 'Hāna / East Windward', terrain: 'WINDWARD', coastalExposure: 'MODERATE', runoff: 'HIGH', drainage: 'Hāna and east slope drainages',
    ring: [[-156.20,20.98],[-155.86,20.97],[-155.78,20.74],[-155.98,20.61],[-156.22,20.73],[-156.20,20.98]],
  },
  {
    id: 'maui-central-lowland', island: 'Maui', zone: 'Central Maui Lowland', terrain: 'URBAN_LOWLAND', coastalExposure: 'HIGH', runoff: 'MODERATE', drainage: 'Kahului / Wailuku drainage plain',
    ring: [[-156.63,20.97],[-156.28,20.97],[-156.22,20.74],[-156.48,20.67],[-156.66,20.78],[-156.63,20.97]],
  },
  {
    id: 'maui-west-gulch', island: 'Maui', zone: 'West Maui Gulches', terrain: 'VALLEY', coastalExposure: 'MODERATE', runoff: 'HIGH', drainage: 'West Maui gulch systems',
    ring: [[-156.86,21.03],[-156.56,21.05],[-156.47,20.86],[-156.62,20.74],[-156.84,20.82],[-156.86,21.03]],
  },
  {
    id: 'hawaii-hilo-hamakua', island: 'Hawaiʻi Island', zone: 'Hilo / Hāmākua Windward', terrain: 'WINDWARD', coastalExposure: 'MODERATE', runoff: 'HIGH', drainage: 'Hilo urban streams and Hāmākua gulches',
    ring: [[-155.34,20.34],[-154.86,20.34],[-154.82,19.98],[-155.04,19.80],[-155.30,19.92],[-155.34,20.34]],
  },
  {
    id: 'hawaii-kona-leeward', island: 'Hawaiʻi Island', zone: 'Kona Leeward Slope', terrain: 'LEEWARD', coastalExposure: 'MODERATE', runoff: 'LOW', drainage: 'Kona leeward runoff corridors',
    ring: [[-156.18,19.99],[-155.78,19.99],[-155.70,19.56],[-155.95,19.42],[-156.15,19.65],[-156.18,19.99]],
  },
  {
    id: 'hawaii-kau-coastal', island: 'Hawaiʻi Island', zone: 'Kaʻū Coastal Plain', terrain: 'COASTAL', coastalExposure: 'HIGH', runoff: 'MODERATE', drainage: 'Kaʻū coastal drainages and low crossings',
    ring: [[-155.86,19.54],[-155.28,19.56],[-155.18,19.14],[-155.55,19.00],[-155.84,19.16],[-155.86,19.54]],
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
  if (!upstream.ok) return err(502, `Flash flood upstream failed: ${upstream.error}`, cors);

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

  return jsonResp(
    buildHazardEnvelope(
      'flash-flood',
      'NWS',
      region,
      signals,
      {
        status: signals.length > 0 ? 'active' : 'none',
        count: signals.length,
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

async function handleRainRadar(url: URL, cors: CorsHeaders): Promise<Response> {
  const region = resolveRegion(url);
  const signals = buildRadarSignals(region);
  const heavyCount = signals.filter((f) => f.properties.intensity === 'HEAVY').length;
  const moderateCount = signals.filter((f) => f.properties.intensity === 'MODERATE').length;

  return jsonResp(
    buildHazardEnvelope(
      'rain-radar',
      'NOAA',
      region,
      signals,
      {
        status: signals.length ? 'detected' : 'none',
        count: signals.length,
        heavy_count: heavyCount,
        moderate_count: moderateCount,
        message: signals.length
          ? 'Smart statewide Hawaiʻi rain context is available in safe civic mode.'
          : 'No rain radar context cells were returned in this snapshot.',
      },
      {
        authority: 'contextual',
        note: 'Kahu Ola serves smart island-aware rain context cells for statewide Hawaiʻi without long upstream sampling requests.',
      },
    ),
    200,
    cors,
  );
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
          source: 'PacIOOS',
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

  return jsonResp(
    buildHazardEnvelope(
      'flood-context',
      'PacIOOS',
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
    ),
    200,
    cors,
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') return optionsResp(origin);
    if (!['GET', 'HEAD'].includes(request.method)) return err(405, 'Method not allowed', cors);
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return err(403, 'Forbidden', cors);

    const path = url.pathname;

    if (path === '/api/tiles/health' || path === '/api/health') return handleHealth(env, cors);
    if (path === '/api/hazards/flash-flood' || path === '/hazards/flash-flood') return handleFlashFlood(url, cors);
    if (path === '/api/hazards/flood-context' || path === '/hazards/flood-context') return handleFloodContext(url, cors);
    if (path === '/api/hazards/rain-radar' || path === '/hazards/rain-radar') return handleRainRadar(url, cors);
    if (path === '/api/firms/hotspots') return handleFirmsHotspots(url, env, cors);

    const wmsMatch = path.match(/^\/api\/tiles\/wms\/([a-z_]+)$/);
    if (wmsMatch) return handleWms(wmsMatch[1], url, env, cors);

    const xyzMatch = path.match(/^\/api\/tiles\/xyz\/airnow\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (xyzMatch) return handleAirnowXyz(xyzMatch[1], xyzMatch[2], xyzMatch[3], env, cors);

    const geoMatch = path.match(/^\/api\/tiles\/geojson\/([a-z_-]+)$/);
    if (geoMatch) return handleGeojson(geoMatch[1], cors);

    return err(404, 'Not found', cors);
  },
};

function handleHealth(env: Env, cors: CorsHeaders): Response {
  return jsonResp({
    status: 'ok',
    generated_at: new Date().toISOString(),
    upstreams: {
      firms: !!env.NASA_FIRMS_MAP_KEY,
      hms: true,
      goes: true,
      pacioos: true,
      airnow: !!env.AIRNOW_API_KEY,
      wfigs: true,
      nws: true,
    },
  }, 200, cors);
}

async function handleFirmsHotspots(url: URL, env: Env, cors: CorsHeaders): Promise<Response> {
  if (!env.NASA_FIRMS_MAP_KEY) return err(503, 'NASA_FIRMS_MAP_KEY not configured', cors);

  const dataset = url.searchParams.get('dataset') || 'VIIRS_SNPP_NRT';
  const days = Math.min(10, Math.max(1, parseInt(url.searchParams.get('days') || '1', 10)));
  const bboxRaw = url.searchParams.get('bbox') || '';
  const limit = Math.min(5000, Math.max(1, parseInt(url.searchParams.get('limit') || '1000', 10)));

  const parts = bboxRaw.split(',').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return err(400, 'bbox must be WEST,SOUTH,EAST,NORTH', cors);
  const [west, south, east, north] = parts;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
    return err(400, 'Invalid bbox values', cors);
  }

  const firmsUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${env.NASA_FIRMS_MAP_KEY}/${dataset}/${west},${south},${east},${north}/${days}`;
  const cacheUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/_/${dataset}/${west},${south},${east},${north}/${days}`;
  const cache = caches.default;
  const cacheReq = new Request(cacheUrl);
  const cached = await cache.match(cacheReq);
  if (cached) {
    const headers = new Headers(cached.headers);
    Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
    headers.set('X-Kahuola-Cache', 'HIT');
    return new Response(cached.body, { status: cached.status, headers });
  }

  const t0 = Date.now();
  let csvText = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const res = await fetch(firmsUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return err(502, `FIRMS upstream error: ${res.status}`, cors);
    csvText = await res.text();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return err(504, `FIRMS fetch failed: ${msg}`, cors);
  }

  const geojson = firmsCsvToGeojson(csvText, limit);
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

function firmsCsvToGeojson(csv: string, limit: number): { type: string; features: unknown[] } {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return { type: 'FeatureCollection', features: [] };

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

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        brightness: row.bright_ti4 || row.brightness || '',
        bright_ti4: row.bright_ti4 || '',
        bright_ti5: row.bright_ti5 || '',
        frp: row.frp || '',
        confidence: row.confidence || '',
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
  goes: { url: 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_ctp/ows', ttl: 600 },
  pacioos: { url: 'https://pae-paha.pacioos.hawaii.edu/thredds/wms/dhw_5km', ttl: 3600 },
};

async function handleWms(id: string, url: URL, env: Env, cors: CorsHeaders): Promise<Response> {
  const upstream = WMS_UPSTREAMS[id];
  if (!upstream) return err(404, `Unknown WMS source: ${id}`, cors);

  const service = (url.searchParams.get('SERVICE') || '').toUpperCase();
  const request = (url.searchParams.get('REQUEST') || '').toUpperCase();
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
  if (!env.AIRNOW_API_KEY) return err(503, 'Service temporarily unavailable', cors);

  const cacheUrl = `https://tiles.airnowtech.org/airnow/today/${zi}/${xi}/${yi}.png`;
  const fetchUrl = `${cacheUrl}?api_key=${env.AIRNOW_API_KEY}`;
  return proxyFetch(fetchUrl, cacheUrl, 600, cors);
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

async function proxyFetch(fetchUrl: string, cacheUrl: string, ttlSeconds: number, cors: CorsHeaders): Promise<Response> {
  const cache = caches.default;
  const cacheReq = new Request(cacheUrl);
  const cached = await cache.match(cacheReq);
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
