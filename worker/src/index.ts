/**
 * Kahu Ola — Tile Broker Worker V4.3.1
 * Routes: kahuola.org/api/*
 * Keys: server-side only, never exposed to client
 */

export interface Env {
  NASA_FIRMS_MAP_KEY: string;
  AIRNOW_API_KEY: string;
}

// ── Constants ────────────────────────────────────────────────────────────────
const ALLOWED_ORIGIN = 'https://kahuola.org';
const FETCH_TIMEOUT  = 8_000;

// ── CORS ─────────────────────────────────────────────────────────────────────
function corsHeaders(origin: string | null): Record<string, string> {
  const base: Record<string, string> = { 'Vary': 'Origin' };
  if (origin === ALLOWED_ORIGIN) {
    base['Access-Control-Allow-Origin']  = ALLOWED_ORIGIN;
    base['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS';
    base['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return base;
}

function jsonResp(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function err(status: number, msg: string, cors: Record<string, string>): Response {
  return jsonResp({ error: msg }, status, cors);
}

// ── Main handler ─────────────────────────────────────────────────────────────
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url    = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors   = corsHeaders(origin);

    // Preflight
    if (request.method === 'OPTIONS') {
      if (origin !== null && origin !== ALLOWED_ORIGIN) {
        return new Response(null, { status: 403, headers: { 'Vary': 'Origin' } });
      }
      return new Response(null, { status: 204, headers: cors });
    }

    // Method guard
    if (!['GET', 'HEAD'].includes(request.method)) {
      return err(405, 'Method not allowed', cors);
    }

    // Block non-kahuola origins (null origin = direct/server-to-server, allowed)
    if (origin !== null && origin !== ALLOWED_ORIGIN) {
      return err(403, 'Forbidden', cors);
    }

    const path = url.pathname;

    // ── /api/tiles/health ──────────────────────────────────────────────────
    if (path === '/api/tiles/health' || path === '/api/health') {
      return handleHealth(env, cors);
    }

    // ── /api/firms/hotspots ────────────────────────────────────────────────
    if (path === '/api/firms/hotspots') {
      return handleFirmsHotspots(url, env, cors);
    }

    // ── /api/tiles/wms/:id ─────────────────────────────────────────────────
    const wmsMatch = path.match(/^\/api\/tiles\/wms\/([a-z_]+)$/);
    if (wmsMatch) {
      return handleWms(wmsMatch[1], url, env, cors);
    }

    // ── /api/tiles/xyz/airnow/:z/:x/:y.png ───────────────────────────────
    const xyzMatch = path.match(/^\/api\/tiles\/xyz\/airnow\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (xyzMatch) {
      return handleAirnowXyz(xyzMatch[1], xyzMatch[2], xyzMatch[3], env, cors);
    }

    // ── /api/tiles/geojson/:id ─────────────────────────────────────────────
    const geoMatch = path.match(/^\/api\/tiles\/geojson\/([a-z_-]+)$/);
    if (geoMatch) {
      return handleGeojson(geoMatch[1], cors);
    }

    return err(404, 'Not found', cors);
  },
};

// ── Health ───────────────────────────────────────────────────────────────────
function handleHealth(env: Env, cors: Record<string, string>): Response {
  return jsonResp({
    status: 'ok',
    generated_at: new Date().toISOString(),
    upstreams: {
      firms:   !!env.NASA_FIRMS_MAP_KEY,
      hms:     true,
      goes:    true,
      pacioos: true,
      airnow:  !!env.AIRNOW_API_KEY,
      wfigs:   true,
    },
  }, 200, cors);
}

// ── FIRMS hotspots — area CSV → GeoJSON ──────────────────────────────────────
async function handleFirmsHotspots(
  url: URL, env: Env, cors: Record<string, string>
): Promise<Response> {
  if (!env.NASA_FIRMS_MAP_KEY) {
    return err(503, 'NASA_FIRMS_MAP_KEY not configured', cors);
  }

  const dataset = url.searchParams.get('dataset') || 'VIIRS_SNPP_NRT';
  const days    = Math.min(10, Math.max(1, parseInt(url.searchParams.get('days') || '1', 10)));
  const bboxRaw = url.searchParams.get('bbox') || '';
  const limit   = Math.min(5000, Math.max(1, parseInt(url.searchParams.get('limit') || '1000', 10)));

  const parts = bboxRaw.split(',').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) {
    return err(400, 'bbox must be WEST,SOUTH,EAST,NORTH', cors);
  }
  const [west, south, east, north] = parts;

  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
    return err(400, 'Invalid bbox values', cors);
  }

  // FIRMS area CSV API — key in URL path, never in a client-visible location
  const firmsUrl =
    `https://firms.modaps.eosdis.nasa.gov/api/area/csv/` +
    `${env.NASA_FIRMS_MAP_KEY}/${dataset}/` +
    `${west},${south},${east},${north}/${days}`;

  // Cache key must not contain the secret — use a key-free representation
  const cacheUrl =
    `https://firms.modaps.eosdis.nasa.gov/api/area/csv/_/${dataset}/` +
    `${west},${south},${east},${north}/${days}`;

  const t0 = Date.now();
  let csvText: string;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const res = await fetch(firmsUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return err(502, `FIRMS upstream error: ${res.status}`, cors);
    }
    csvText = await res.text();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return err(504, `FIRMS fetch failed: ${msg}`, cors);
  }
  const upstreamLatencyMs = Date.now() - t0;

  const geojson = firmsCsvToGeojson(csvText, limit);

  const body = {
    ...geojson,
    properties: {
      returnedRecords: geojson.features.length,
      dataset,
      days,
      bbox: { west, south, east, north },
      upstreamLatencyMs,
      generated_at: new Date().toISOString(),
    },
  };

  // Cache the key-free URL so secrets never appear in cache storage
  const cache    = caches.default;
  const response = new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/geo+json',
      'Cache-Control': 'public, max-age=300',
      'X-Kahuola-Cache': 'MISS',
      ...cors,
    },
  });
  await cache.put(new Request(cacheUrl), response.clone());
  return response;
}

// ── CSV parser ────────────────────────────────────────────────────────────────
function firmsCsvToGeojson(csv: string, limit: number): { type: string; features: unknown[] } {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return { type: 'FeatureCollection', features: [] };

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const features: unknown[] = [];

  for (let i = 1; i < lines.length && features.length < limit; i++) {
    const vals = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    if (vals.length < headers.length) continue;

    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] ?? ''; });

    const lat = parseFloat(row['latitude']  || row['lat'] || '');
    const lng = parseFloat(row['longitude'] || row['lon'] || row['lng'] || '');
    if (isNaN(lat) || isNaN(lng)) continue;

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        brightness:  row['bright_ti4'] || row['brightness'] || '',
        bright_ti4:  row['bright_ti4'] || '',
        bright_ti5:  row['bright_ti5'] || '',
        frp:         row['frp'] || '',
        confidence:  row['confidence'] || '',
        acq_date:    row['acq_date'] || '',
        acq_time:    row['acq_time'] || '',
        satellite:   row['satellite'] || '',
        instrument:  row['instrument'] || '',
        daynight:    row['daynight'] || '',
        track:       row['track'] || '',
        scan:        row['scan'] || '',
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

// ── WMS proxy ────────────────────────────────────────────────────────────────
const WMS_UPSTREAMS: Record<string, { url: string; ttl: number; keySecret?: keyof Env; keyParam?: string }> = {
  firms:   { url: 'https://firms.modaps.eosdis.nasa.gov/mapserver/wms/South_America/', ttl: 300,  keySecret: 'NASA_FIRMS_MAP_KEY', keyParam: 'MAP_KEY' },
  hms:     { url: 'https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/',          ttl: 900 },
  goes:    { url: 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_ctp/ows',                   ttl: 600 },
  pacioos: { url: 'https://pae-paha.pacioos.hawaii.edu/thredds/wms/dhw_5km',                       ttl: 3600 },
};

async function handleWms(
  id: string, url: URL, env: Env, cors: Record<string, string>
): Promise<Response> {
  const upstream = WMS_UPSTREAMS[id];
  if (!upstream) return err(404, `Unknown WMS source: ${id}`, cors);

  const service = (url.searchParams.get('SERVICE') || '').toUpperCase();
  const request = (url.searchParams.get('REQUEST') || '').toUpperCase();

  if (service !== 'WMS') return err(400, 'SERVICE=WMS required', cors);
  if (!['GETMAP', 'GETCAPABILITIES'].includes(request)) {
    return err(400, 'REQUEST must be GetMap or GetCapabilities', cors);
  }

  if (request === 'GETMAP') {
    const w   = parseInt(url.searchParams.get('WIDTH')  || '0', 10);
    const h   = parseInt(url.searchParams.get('HEIGHT') || '0', 10);
    const fmt = url.searchParams.get('FORMAT') || '';
    const bbox = url.searchParams.get('BBOX') || '';
    const crs  = url.searchParams.get('CRS') || url.searchParams.get('SRS') || '';

    if (w < 1 || h < 1 || w > 2048 || h > 2048) return err(400, 'WIDTH/HEIGHT must be 1–2048', cors);
    if (!['image/png', 'image/jpeg'].includes(fmt)) return err(400, 'FORMAT must be image/png or image/jpeg', cors);
    if (!bbox) return err(400, 'BBOX required', cors);
    if (!crs)  return err(400, 'CRS or SRS required', cors);
  }

  // Key guard — 503 if secret absent
  if (upstream.keySecret) {
    if (!env[upstream.keySecret]) {
      return err(503, 'Service temporarily unavailable', cors);
    }
  }

  // Build cache URL (client params only, no secret)
  const cacheParams = new URLSearchParams(url.searchParams);
  const cacheUrl = `${upstream.url}?${cacheParams.toString()}`;

  // Build fetch URL (client params + injected key)
  const fetchParams = new URLSearchParams(url.searchParams);
  if (upstream.keySecret && upstream.keyParam) {
    fetchParams.set(upstream.keyParam, env[upstream.keySecret]);
  }
  const fetchUrl = `${upstream.url}?${fetchParams.toString()}`;

  return proxyFetch(fetchUrl, cacheUrl, upstream.ttl, cors);
}

// ── AirNow XYZ ───────────────────────────────────────────────────────────────
async function handleAirnowXyz(
  z: string, x: string, y: string, env: Env, cors: Record<string, string>
): Promise<Response> {
  const zi = parseInt(z, 10);
  const xi = parseInt(x, 10);
  const yi = parseInt(y, 10);

  if (isNaN(zi) || isNaN(xi) || isNaN(yi)) return err(400, 'z/x/y must be integers', cors);
  if (zi < 0 || zi > 18)                   return err(400, 'z must be 0–18', cors);

  // 503 if key absent
  if (!env.AIRNOW_API_KEY) {
    return err(503, 'Service temporarily unavailable', cors);
  }

  // Cache key — no secret
  const cacheUrl = `https://tiles.airnowtech.org/airnow/today/${zi}/${xi}/${yi}.png`;
  // Fetch URL — with key
  const fetchUrl = `${cacheUrl}?api_key=${env.AIRNOW_API_KEY}`;

  return proxyFetch(fetchUrl, cacheUrl, 600, cors);
}

// ── GeoJSON proxy ─────────────────────────────────────────────────────────────
const GEOJSON_UPSTREAMS: Record<string, { url: string; ttl: number }> = {
  wfigs: {
    url: 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson&resultRecordCount=500',
    ttl: 600,
  },
};

async function handleGeojson(
  id: string, cors: Record<string, string>
): Promise<Response> {
  const upstream = GEOJSON_UPSTREAMS[id];
  if (!upstream) return err(404, `Unknown GeoJSON source: ${id}`, cors);
  // No secrets needed — fetch URL and cache URL are the same
  return proxyFetch(upstream.url, upstream.url, upstream.ttl, cors);
}

// ── Generic proxy with cache ──────────────────────────────────────────────────
// fetchUrl  — actual upstream URL (may include injected secret in query params)
// cacheUrl  — URL used as cache key (must NOT contain secret values)
async function proxyFetch(
  fetchUrl: string,
  cacheUrl: string,
  ttlSeconds: number,
  cors: Record<string, string>,
): Promise<Response> {
  const cache    = caches.default;
  const cacheReq = new Request(cacheUrl);

  // Check cache
  const cached = await cache.match(cacheReq);
  if (cached) {
    const headers = new Headers(cached.headers);
    Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
    headers.set('X-Kahuola-Cache', 'HIT');
    return new Response(cached.body, { status: cached.status, headers });
  }

  // Fetch upstream with timeout
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

  if (shouldCache) {
    await cache.put(cacheReq, response.clone());
  }

  return response;
}
