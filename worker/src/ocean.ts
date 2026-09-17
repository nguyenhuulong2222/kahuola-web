/**
 * Kahu Ola — P23 Ocean Intelligence (context overlays)
 * ─────────────────────────────────────────────────────────────────────────
 * Three additive read-only routes:
 *
 *   GET /api/ocean/surf              High surf / swell
 *   GET /api/ocean/rip-current       NWS HFO Surf Zone Forecast
 *   GET /api/ocean/tropical-outlook  NHC / CPHC formation outlook
 *
 * DOCTRINE POSITION
 * These are CONTEXT OVERLAYS, not canonical hazard signals
 * (Kahu_Ola_V4_7_Doctrine.md §III). Every envelope carries
 * layer_class: "context" so no consumer can promote them into the Event
 * Priority ladder, which stays Fire > Flood > Storm > Volcanic > Monitoring
 * (SYSTEM_INVARIANTS.md, Invariant 8).
 *
 * This module adds NOTHING to existing routes, parsers or cache keys. Every
 * upstream URL here is new, so every cache key is new. It reuses the shared
 * cachedJsonFetch / cachedTextFetch / fetchNwsAlerts helpers by injection
 * (see OceanDeps) rather than importing index.ts, which would be circular.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UPSTREAM VERIFICATION — performed 2026-09-12, not assumed from memory.
 * Findings that changed the design are recorded at each call site; the two
 * that changed it most:
 *
 *   1. The NWS HFO Surf Zone Forecast (SRF) DOES NOT CONTAIN a rip current
 *      risk level. HFO issues 34 product types and none of them carry one.
 *      The product has a single generic safety sentence and a per-shore surf
 *      height table. `risk` is therefore reported as null with an explicit
 *      basis, never derived from surf height — see handleOceanRipCurrent.
 *
 *   2. NHC publishes the Graphical Tropical Weather Outlook as KMZ and
 *      shapefile ONLY — there is no GeoJSON. Per spec, polygons are skipped
 *      and the text outlook is served with geometry: null.
 */

/* ── Shared helpers, injected from index.ts to avoid a circular import ──── */
export interface OceanDeps {
  cachedJsonFetch(url: string, ttl: number, accept?: string): Promise<any>;
  cachedTextFetch(url: string, ttl: number): Promise<string>;
  fetchNwsAlerts(cors: Record<string, string>, areas?: string[] | null, opts?: { useCache?: boolean }): Promise<any>;
  jsonResp(body: unknown, status?: number, extraHeaders?: Record<string, string>): Response;
}

const LAYER_CLASS = 'context' as const;
const SCHEMA_VERSION = 'v1';

/** Route TTLs, matched to how often each upstream actually changes. */
const SURF_TTL = 1800;   // buoys report ~hourly (51001) to ~30 min (waveriders)
const RIP_TTL = 3600;    // SRF is issued about twice a day
const TWO_TTL = 7200;    // tropical outlook is issued every 6 h
const WQ_TTL = 1800;     // DOH posts on business hours; NWS history is hourly-rounded

/**
 * Last-good-envelope snapshot, used only when every upstream for a route
 * fails. Namespaced on a hostname this Worker does not serve, so a snapshot
 * key can never collide with an existing cache key or a real request.
 */
const SNAPSHOT_TTL = 86_400;
const SNAPSHOT_ORIGIN = 'https://ocean-snapshot.kahuola.invalid';

/**
 * Route-level envelope cache, separate from the per-upstream caches used by
 * cachedJsonFetch/cachedTextFetch.
 *
 * Without this, X-Kahuola-Cache always reported MISS even when every upstream
 * came from cache — the response was cheap but the header said otherwise, and
 * a header that misreports cache state is worse than no header. HIT now means
 * this exact envelope came from the edge cache.
 *
 * Same .invalid namespace discipline as the snapshot keys: a hostname this
 * Worker never serves, so no collision with an existing cache key is possible.
 */
const ROUTE_CACHE_ORIGIN = 'https://ocean-route.kahuola.invalid';

async function readRouteCache(route: string, cors: Record<string, string>): Promise<Response | null> {
  try {
    const hit = await caches.default.match(new Request(`${ROUTE_CACHE_ORIGIN}/${route}`));
    if (!hit) return null;
    const ct = (hit.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('json')) return null;
    const headers = new Headers(hit.headers);
    Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
    headers.set('X-Kahuola-Cache', 'HIT');
    return new Response(hit.body, { status: 200, headers });
  } catch {
    return null;   // a cache read must never fail the request
  }
}

async function writeRouteCache(route: string, body: unknown, ttl: number): Promise<void> {
  try {
    await caches.default.put(
      new Request(`${ROUTE_CACHE_ORIGIN}/${route}`),
      new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` },
      }),
    );
  } catch {
    /* a cache write must never fail the request */
  }
}

type Freshness = 'FRESH' | 'STALE_OK' | 'STALE_DROP';

/**
 * The only thing this module writes to the log: one structured line, on
 * failure, naming the stage. No payload, no PII, no request identifiers.
 * There is no success-path logging and no console.log anywhere.
 */
function logEvent(event: string, detail: string): void {
  console.error(JSON.stringify({ evt: event, detail, ts: new Date().toISOString() }));
}

function envelope(layer: string, source: string, extra: Record<string, unknown>) {
  return {
    ok: true,
    layer,
    layer_class: LAYER_CLASS,
    source,
    region: 'hawaii',
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    ...extra,
  };
}

function jsonHeaders(ttl: number, cacheState: 'HIT' | 'MISS', cors: Record<string, string>) {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': `public, max-age=${ttl}`,
    'X-Kahuola-Cache': cacheState,
    ...cors,
  };
}

/** Age in seconds of an ISO timestamp, or null if it will not parse. */
function ageSeconds(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 1000));
}

/**
 * Invariant 4: freshness is always computed and always published, and
 * STALE_DROP is never rendered — callers drop those signals entirely.
 * An unparseable timestamp is STALE_DROP, never FRESH.
 */
function classify(age: number | null, staleOk: number, staleDrop: number): Freshness {
  if (age === null) return 'STALE_DROP';
  if (age <= staleOk) return 'FRESH';
  if (age <= staleDrop) return 'STALE_OK';
  return 'STALE_DROP';
}

async function readSnapshot(route: string): Promise<any | null> {
  try {
    const hit = await caches.default.match(new Request(`${SNAPSHOT_ORIGIN}/${route}`));
    if (!hit) return null;
    const ct = (hit.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('json')) return null;
    return await hit.json();
  } catch {
    return null;   // a cache read must never fail the request
  }
}

async function writeSnapshot(route: string, body: unknown): Promise<void> {
  try {
    await caches.default.put(
      new Request(`${SNAPSHOT_ORIGIN}/${route}`),
      new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${SNAPSHOT_TTL}` },
      }),
    );
  } catch {
    /* a cache write must never fail the request */
  }
}

/**
 * Invariant 3 / Invariant 9: a route that cannot reach anything still answers
 * 200 with a renderable envelope. It serves the last good snapshot when one
 * exists — relabelled STALE_OK so the client can say so — and an empty
 * envelope otherwise. It never 500s and never returns a blank body.
 */
async function degradedResponse(
  route: string,
  layer: string,
  source: string,
  ttl: number,
  cors: Record<string, string>,
  deps: OceanDeps,
  status: string,
) {
  const snap = await readSnapshot(route);
  if (snap && typeof snap === 'object') {
    return deps.jsonResp(
      {
        ...snap,
        generated_at: new Date().toISOString(),
        freshness: 'STALE_OK',
        status: 'stale_snapshot',
        snapshot_generated_at: snap.generated_at ?? null,
        note: 'Live sources unavailable — showing the last successful snapshot. Check official sources for current conditions.',
      },
      200,
      jsonHeaders(ttl, 'HIT', cors),
    );
  }
  return deps.jsonResp(
    envelope(layer, source, {
      stale_after_seconds: ttl,
      freshness: 'STALE_DROP',
      status,
      signals: [],
      note: 'Live sources unavailable. Check official sources for current conditions.',
    }),
    200,
    jsonHeaders(ttl, 'MISS', cors),
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   1) /api/ocean/surf
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Buoy roster. Positions are from NDBC's own station table (verified
 * 2026-09-12), not from memory.
 *
 * 51001 and 51101 sit 188 and 186 NM NW of Kauaʻi. They are OPEN-OCEAN
 * SENTINELS, not shore buoys — a NW swell reaches them roughly 12-24 h
 * before it reaches the north shores. They are labelled island
 * "offshore_nw" rather than being attributed to a populated shore, because
 * calling an open-ocean reading "Kauaʻi north shore surf" would misstate
 * where the measurement was taken (Invariant 11 — source transparency).
 */
interface BuoySpec {
  id: string;
  name: string;
  island: string;
  shore: 'north' | 'south' | 'east' | 'west';
  sentinel?: boolean;
}
const BUOYS: BuoySpec[] = [
  { id: '51001', name: 'Northwestern Hawaii One (188 NM NW of Kauaʻi)', island: 'offshore_nw', shore: 'north', sentinel: true },
  { id: '51101', name: 'Northwestern Hawaii Two (186 NM NW of Kauaʻi)', island: 'offshore_nw', shore: 'north', sentinel: true },
  { id: '51205', name: 'Pauwela, Maui', island: 'maui', shore: 'north' },
  { id: '51201', name: 'Waimea Bay, Oʻahu', island: 'oahu', shore: 'north' },
];

/**
 * PacIOOS SWAN nearshore forecast points.
 *
 * Dataset IDs verified against the ERDDAP catalogue 2026-09-12. The plain
 * ids (swan_oahu) use 0-360 longitude; the _lon180 variants take negative
 * longitudes, which is why those are used here.
 *
 * Each point was probed for a real value: the first Waikīkī and Kona
 * candidates returned null (land or outside the model domain) and were moved
 * seaward until the grid answered. SWAN complements the buoys rather than
 * duplicating them — these are shores with no waverider.
 */
interface SwanSpec {
  dataset: string;
  island: string;
  shore: 'north' | 'south' | 'east' | 'west';
  lat: number;
  lon: number;
  place: string;
}
const SWAN_POINTS: SwanSpec[] = [
  { dataset: 'swan_oahu_lon180',  island: 'oahu',   shore: 'south', lat: 21.25, lon: -157.82, place: 'Waikīkī' },
  { dataset: 'swan_maui_lon180',  island: 'maui',   shore: 'west',  lat: 20.87, lon: -156.70, place: 'Lahaina' },
  { dataset: 'swan_kauai_lon180', island: 'kauai',  shore: 'north', lat: 22.22, lon: -159.50, place: 'Hanalei' },
  { dataset: 'swan_bigi_lon180',  island: 'hawaii', shore: 'west',  lat: 19.64, lon: -156.02, place: 'Kona' },
];

const NDBC_BASE = 'https://www.ndbc.noaa.gov/data/realtime2';
const ERDDAP_BASE = 'https://pae-paha.pacioos.hawaii.edu/erddap/griddap';

/** Buoy observations older than this are dropped rather than shown. */
const BUOY_STALE_OK = 2 * 3600;
const BUOY_STALE_DROP = 6 * 3600;

interface BuoyRow {
  observed_at: string;
  wave_height_m: number | null;
  dominant_period_s: number | null;
  direction_deg: number | null;
}

/**
 * Parse an NDBC realtime2 table. Rows are newest-first beneath two `#`
 * header lines. Columns:
 *   0 YY  1 MM  2 DD  3 hh  4 mm  5 WDIR 6 WSPD 7 GST
 *   8 WVHT  9 DPD  10 APD  11 MWD  ...
 *
 * "MM" is NDBC's missing marker. Invariant III / Invariant 5: a missing
 * field is dropped to null, never defaulted and never interpolated. Buoy
 * 51101 currently reports MM for every wave field, which is exactly the
 * case this must not paper over.
 */
function parseNdbc(text: string, limit = 80): BuoyRow[] {
  const out: BuoyRow[] = [];
  const lines = String(text || '').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const c = line.split(/\s+/);
    if (c.length < 12) continue;

    const [yy, mo, dd, hh, mi] = c.slice(0, 5).map((v) => Number(v));
    if (![yy, mo, dd, hh, mi].every((n) => Number.isFinite(n))) continue;
    const ms = Date.UTC(yy, mo - 1, dd, hh, mi);       // NDBC realtime2 is UTC
    if (!Number.isFinite(ms)) continue;

    const num = (v: string): number | null => {
      if (v === undefined || v === 'MM') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    out.push({
      observed_at: new Date(ms).toISOString(),
      wave_height_m: num(c[8]),
      dominant_period_s: num(c[9]),
      direction_deg: num(c[11]),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Trend over roughly the previous three hours. Returns null when there is
 * not enough history to say — "steady" is a claim, and an absent comparison
 * is not evidence for it.
 */
function waveTrend(rows: BuoyRow[]): 'building' | 'steady' | 'dropping' | null {
  const withHeight = rows.filter((r) => r.wave_height_m !== null);
  if (withHeight.length < 2) return null;
  const latest = withHeight[0];
  const latestMs = Date.parse(latest.observed_at);
  const target = latestMs - 3 * 3600 * 1000;

  let past: BuoyRow | null = null;
  for (const r of withHeight) {
    const t = Date.parse(r.observed_at);
    if (t <= target) { past = r; break; }
  }
  if (!past) return null;
  // Guard against a gap so long the comparison is meaningless.
  if (latestMs - Date.parse(past.observed_at) > 9 * 3600 * 1000) return null;

  const delta = (latest.wave_height_m as number) - (past.wave_height_m as number);
  if (delta >= 0.3) return 'building';
  if (delta <= -0.3) return 'dropping';
  return 'steady';
}

/** One SWAN grid point at the current hour. Null on any failure. */
async function fetchSwanPoint(spec: SwanSpec, deps: OceanDeps) {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  const t = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const vars = ['shgt', 'pper', 'mdir']
    .map((v) => `${v}[(${t})][0][(${spec.lat})][(${spec.lon})]`)
    .join(',');
  const url = `${ERDDAP_BASE}/${spec.dataset}.json?${encodeURI(vars)}`;
  try {
    const j = await deps.cachedJsonFetch(url, SURF_TTL, 'application/json');
    const row = j?.table?.rows?.[0];
    if (!Array.isArray(row)) return null;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const h = n(row[4]);
    // A land or out-of-domain cell answers 200 with nulls. That is not a
    // reading, so it produces no signal.
    if (h === null) return null;
    return {
      island: spec.island,
      shore: spec.shore,
      place: spec.place,
      model_time: typeof row[0] === 'string' ? row[0] : null,
      wave_height_m: Math.round(h * 100) / 100,
      dominant_period_s: n(row[5]) === null ? null : Math.round((n(row[5]) as number) * 10) / 10,
      direction_deg: n(row[6]) === null ? null : Math.round(n(row[6]) as number),
      dataset: spec.dataset,
    };
  } catch {
    return null;
  }
}

const HIGH_SURF_EVENTS = ['high surf advisory', 'high surf warning'];

export async function handleOceanSurf(
  _url: URL,
  cors: Record<string, string>,
  deps: OceanDeps,
): Promise<Response> {
  const cached = await readRouteCache('surf', cors);
  if (cached) return cached;

  const fetched_at = new Date().toISOString();

  const buoyResults = await Promise.allSettled(
    BUOYS.map(async (b) => ({ spec: b, rows: parseNdbc(await deps.cachedTextFetch(`${NDBC_BASE}/${b.id}.txt`, SURF_TTL)) })),
  );
  const alertsResult = await Promise.allSettled([deps.fetchNwsAlerts(cors)]);
  const swanResults = await Promise.allSettled(SWAN_POINTS.map((s) => fetchSwanPoint(s, deps)));

  /* ── NWS High Surf products ──────────────────────────────────────────
   * Collected at envelope level as well as attached per signal. P57's
   * lesson applies: a per-signal join that silently matches nothing must
   * not be the only place an active product can appear, or the page ends up
   * implying there are none. `advisories` lists every active High Surf
   * product whether or not it matched a shore. */
  const advisories: Array<{ event: string; areas: string; ends: string | null }> = [];
  let alertsOk = false;
  const a0 = alertsResult[0];
  if (a0.status === 'fulfilled' && a0.value?.ok) {
    alertsOk = true;
    const feats: any[] = Array.isArray(a0.value.data?.features) ? a0.value.data.features : [];
    for (const f of feats) {
      const ev = String(f?.properties?.event || '').trim();
      if (!HIGH_SURF_EVENTS.includes(ev.toLowerCase())) continue;
      advisories.push({
        event: ev,
        areas: String(f?.properties?.areaDesc || ''),
        ends: typeof f?.properties?.ends === 'string' ? f.properties.ends : null,
      });
    }
  } else {
    logEvent('ocean.surf.alerts_unavailable', 'NWS alerts feed unreachable');
  }

  /* Island-level advisory match. NWS Hawaiʻi zone names carry the island
   * word ("Oahu North Shore", "Maui Windward West"), so an island match is
   * sound where a town match would not be. Offshore sentinels match nothing
   * by design — no advisory is issued for open ocean. */
  const advisoryFor = (island: string): string | null => {
    if (!advisories.length) return null;
    const key = island === 'hawaii' ? 'big island' : island;
    const hit = advisories.find((ad) => ad.areas.toLowerCase().includes(key));
    return hit ? hit.event : null;
  };

  const signals: any[] = [];
  let north_shore_outlook: string | null = null;
  const sourceHealth: Record<string, string> = {};

  for (let i = 0; i < buoyResults.length; i++) {
    const r = buoyResults[i];
    const spec = BUOYS[i];
    if (r.status !== 'fulfilled') {
      sourceHealth[`ndbc_${spec.id}`] = 'unreachable';
      logEvent('ocean.surf.buoy_unreachable', spec.id);
      continue;
    }
    const rows = r.value.rows;
    const latest = rows.find((row) => row.wave_height_m !== null);
    if (!latest) {
      // 51101 is in exactly this state today: reporting, but every wave
      // field is MM. Reporting nothing is correct; inventing a height is not.
      sourceHealth[`ndbc_${spec.id}`] = 'no_wave_data';
      continue;
    }

    const age = ageSeconds(latest.observed_at);
    const freshness = classify(age, BUOY_STALE_OK, BUOY_STALE_DROP);
    if (freshness === 'STALE_DROP') {
      sourceHealth[`ndbc_${spec.id}`] = 'stale_dropped';
      continue;   // Invariant 4: STALE_DROP is never displayed
    }
    sourceHealth[`ndbc_${spec.id}`] = 'ok';

    signals.push({
      island: spec.island,
      shore: spec.shore,
      wave_height_m: latest.wave_height_m,
      dominant_period_s: latest.dominant_period_s,
      direction_deg: latest.direction_deg,
      trend: waveTrend(rows),
      advisory: advisoryFor(spec.island),
      observation_type: spec.sentinel ? 'open_ocean_sentinel' : 'nearshore_buoy',
      station_id: spec.id,
      station_name: spec.name,
      observed_at: latest.observed_at,
      freshness,
      source: 'NDBC (NOAA)',
      fetched_at,
    });

    /* Buoy 51001 early-warning rule, per spec. Calm, non-directive copy:
     * it describes what the sentinel is measuring and leaves instructions
     * to the National Weather Service (Invariant 7). */
    if (
      spec.id === '51001' &&
      (latest.wave_height_m as number) >= 4.0 &&
      latest.dominant_period_s !== null &&
      (latest.dominant_period_s as number) >= 14
    ) {
      north_shore_outlook = 'Large NW swell arriving within 12–24 hours';
    }
  }

  for (let i = 0; i < swanResults.length; i++) {
    const r = swanResults[i];
    const spec = SWAN_POINTS[i];
    if (r.status !== 'fulfilled' || !r.value) {
      sourceHealth[`swan_${spec.island}_${spec.shore}`] = 'unavailable';
      continue;
    }
    const p = r.value;
    sourceHealth[`swan_${spec.island}_${spec.shore}`] = 'ok';
    signals.push({
      island: p.island,
      shore: p.shore,
      wave_height_m: p.wave_height_m,
      dominant_period_s: p.dominant_period_s,
      direction_deg: p.direction_deg,
      // A model field has no observed history here, so no trend is claimed.
      trend: null,
      advisory: advisoryFor(p.island),
      observation_type: 'model_forecast',
      model: 'PacIOOS SWAN nearshore',
      model_time: p.model_time,
      place: p.place,
      dataset: p.dataset,
      freshness: classify(ageSeconds(p.model_time), 3 * 3600, 12 * 3600),
      source: 'PacIOOS SWAN (University of Hawaiʻi)',
      fetched_at,
    });
  }

  const usable = signals.filter((s) => s.freshness !== 'STALE_DROP');
  if (!usable.length && !alertsOk) {
    logEvent('ocean.surf.all_sources_failed', 'no buoy, swan or alert data');
    return degradedResponse('surf', 'ocean_surf', 'NDBC / NWS / PacIOOS', SURF_TTL, cors, deps, 'unavailable');
  }

  const body = envelope('ocean_surf', 'NDBC / NWS / PacIOOS SWAN', {
    stale_after_seconds: SURF_TTL,
    freshness: usable.some((s) => s.freshness === 'FRESH') ? 'FRESH' : 'STALE_OK',
    status: usable.length ? 'ok' : 'no_observations',
    signals: usable,
    advisories,
    north_shore_outlook,
    source_health: sourceHealth,
    note: 'Situational awareness only. Follow the National Weather Service for official surf advisories.',
  });

  await writeSnapshot('surf', body);
  await writeRouteCache('surf', body, SURF_TTL);
  return deps.jsonResp(body, 200, jsonHeaders(SURF_TTL, 'MISS', cors));
}

/* ═══════════════════════════════════════════════════════════════════════
   2) /api/ocean/rip-current
   ═══════════════════════════════════════════════════════════════════════ */

const SRF_LIST = 'https://api.weather.gov/products/types/SRF/locations/HFO';
const NWS_PRODUCT = 'https://api.weather.gov/products';

const SHORE_KEYS: Array<{ label: string; shore: 'north' | 'south' | 'east' | 'west' }> = [
  { label: 'North Facing', shore: 'north' },
  { label: 'South Facing', shore: 'south' },
  { label: 'East Facing', shore: 'east' },
  { label: 'West Facing', shore: 'west' },
];

/**
 * Some other NWS offices publish an explicit "RIP CURRENT RISK...MODERATE"
 * line inside the surf product. HFO does not, but the check costs nothing
 * and means the route starts reporting a real risk level the day HFO adds
 * one — without anybody having to notice.
 */
const RIP_RISK_RE = /rip\s+current\s+risk[.\s]*\.{2,}\s*(low|moderate|high)/i;

export async function handleOceanRipCurrent(
  _url: URL,
  cors: Record<string, string>,
  deps: OceanDeps,
): Promise<Response> {
  const cached = await readRouteCache('rip-current', cors);
  if (cached) return cached;

  const fetched_at = new Date().toISOString();

  let text = '';
  let product_time: string | null = null;
  try {
    const list = await deps.cachedJsonFetch(SRF_LIST, RIP_TTL, 'application/ld+json');
    const newest = Array.isArray(list?.['@graph']) ? list['@graph'][0] : null;
    if (!newest?.id) throw new Error('no product listed');
    const prod = await deps.cachedJsonFetch(`${NWS_PRODUCT}/${newest.id}`, RIP_TTL, 'application/ld+json');
    text = String(prod?.productText || '');
    product_time = typeof prod?.issuanceTime === 'string' ? prod.issuanceTime : null;
    if (!text.trim()) throw new Error('empty product text');
  } catch {
    logEvent('ocean.rip.product_unavailable', 'SRF fetch or parse failed');
    return degradedResponse('rip-current', 'ocean_rip_current', 'NWS Honolulu', RIP_TTL, cors, deps, 'unavailable');
  }

  /* Sections are separated by the NWS `$$` terminator. Each begins with a
   * UGC line then an island label. The UGC codes are captured because they
   * are the real join key to NWS geography — far sounder than matching an
   * island name, which is the join that P57 found fails for 29 of 31 zones. */
  const signals: any[] = [];
  let sectionsSeen = 0;
  let sectionsParsed = 0;

  for (const section of text.split('$$')) {
    const head = section.match(/^\s*(HIZ[\dA-Z>\-]+)-\d{6}-\s*$\n^(.+?)-\s*$/m);
    if (!head) continue;
    sectionsSeen++;
    const ugc = head[1];
    const island = head[2].trim();
    let parsedAnyShore = false;

    for (const { label, shore } of SHORE_KEYS) {
      // "North Facing         1-3    1-3    ..." — the first pair is today
      // AM/PM. A row that does not match is skipped, never guessed at.
      const row = section.match(
        new RegExp(`^${label}\\s+(\\d+(?:-\\d+)?)\\s+(\\d+(?:-\\d+)?)`, 'm'),
      );
      if (!row) continue;
      parsedAnyShore = true;

      const riskHit = section.match(RIP_RISK_RE);
      signals.push({
        island,
        shore,
        ugc_codes: ugc,
        /* Invariant III and Invariant 5: NWS Honolulu does not issue a rip
         * current risk level, so none is reported. Deriving LOW/MODERATE/
         * HIGH from surf height would be Kahu Ola inventing a classification
         * no authority published. `risk_basis` says why the field is null. */
        risk: riskHit ? riskHit[1].toUpperCase() : null,
        risk_basis: riskHit ? 'nws_product' : 'not_issued_by_nws_hfo',
        surf_height_ft_today_am: row[1],
        surf_height_ft_today_pm: row[2],
        source: 'NWS Honolulu',
        product_time,
        fetched_at,
      });
    }
    if (parsedAnyShore) sectionsParsed++;
  }

  if (!signals.length) {
    logEvent('ocean.rip.no_sections_parsed', `sections seen: ${sectionsSeen}`);
    return deps.jsonResp(
      envelope('ocean_rip_current', 'NWS Honolulu', {
        stale_after_seconds: RIP_TTL,
        freshness: 'STALE_DROP',
        status: 'unavailable',
        signals: [],
        product_time,
        note: 'Surf Zone Forecast could not be parsed. Check the National Weather Service Honolulu surf forecast directly.',
      }),
      200,
      jsonHeaders(RIP_TTL, 'MISS', cors),
    );
  }

  /* The one rip-current sentence HFO does publish, quoted rather than
   * paraphrased so the wording stays the agency's (Invariant 7 / 11). */
  const safety = text.match(/[^.]*rip currents[^.]*\.(?:[^.]*\.)?/i);
  const age = ageSeconds(product_time);

  const body = envelope('ocean_rip_current', 'NWS Honolulu', {
    stale_after_seconds: RIP_TTL,
    freshness: classify(age, 12 * 3600, 36 * 3600),
    /* "partial" is the honest status: the shore breakdown parsed, the risk
     * level does not exist upstream. It is not "ok" and it is not a failure. */
    status: signals.some((s) => s.risk !== null) ? 'ok' : 'partial',
    signals,
    product_time,
    sections_seen: sectionsSeen,
    sections_parsed: sectionsParsed,
    risk_levels_available: signals.some((s) => s.risk !== null),
    safety_text: safety ? safety[0].replace(/\s+/g, ' ').trim() : null,
    official_source_url: 'https://www.weather.gov/hfo/',
    note: 'NWS Honolulu does not publish a numeric rip current risk level. Surf heights are from the official Surf Zone Forecast; follow NWS Honolulu for surf advisories.',
  });

  await writeSnapshot('rip-current', body);
  await writeRouteCache('rip-current', body, RIP_TTL);
  return deps.jsonResp(body, 200, jsonHeaders(RIP_TTL, 'MISS', cors));
}

/* ═══════════════════════════════════════════════════════════════════════
   3) /api/ocean/tropical-outlook
   ═══════════════════════════════════════════════════════════════════════ */

const TWO_LIST = 'https://api.weather.gov/products/types/TWO';

/**
 * Basin selection by WMO collective id, verified 2026-09-12:
 *   ACPN50 (PHFO)  Central Pacific, English
 *   ABPZ20 (KNHC)  Eastern Pacific, English
 *   ACPN51 / ABPZ21 are the Spanish editions and are deliberately excluded —
 *   they carry the same content and would double every area.
 */
const BASINS: Array<{ wmo: string; basin: 'central_pacific' | 'eastern_pacific' }> = [
  { wmo: 'ACPN50', basin: 'central_pacific' },
  { wmo: 'ABPZ20', basin: 'eastern_pacific' },
];

const CHANCE_48_RE = /Formation chance through 48 hours\.{3}\s*([a-z]+)\.{3}\s*(?:near\s+)?(\d+)\s*percent/i;
const CHANCE_7D_RE = /Formation chance through 7 days\.{3}\s*([a-z]+)\.{3}\s*(?:near\s+)?(\d+)\s*percent/i;

/**
 * Split a Tropical Weather Outlook into its named areas.
 *
 * Structure is a header line ending in ':' followed by prose and, for an
 * area under watch, two "Formation chance through ..." bullets. A block with
 * no formation chance is not an area (it is the "Active Systems" preamble or
 * the forecaster signature) and is dropped rather than guessed at.
 */
function parseOutlookAreas(text: string) {
  const areas: Array<{ title: string; discussion: string; c48: number | null; c7: number | null; c48_label: string | null; c7_label: string | null }> = [];
  const blocks = String(text || '').split(/\n\s*\n/);
  for (const block of blocks) {
    const m48 = block.match(CHANCE_48_RE);
    const m7 = block.match(CHANCE_7D_RE);
    if (!m48 && !m7) continue;

    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const titleLine = lines.find((l) => /:\s*$/.test(l));
    const title = titleLine ? titleLine.replace(/:\s*$/, '').trim() : 'Unnamed area';
    const discussion = lines
      .filter((l) => l !== titleLine && !/^\*/.test(l))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    const pct = (m: RegExpMatchArray | null) => {
      if (!m) return null;
      const n = Number(m[2]);
      return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
    };
    areas.push({
      title,
      discussion,
      c48: pct(m48),
      c7: pct(m7),
      c48_label: m48 ? m48[1].toLowerCase() : null,
      c7_label: m7 ? m7[1].toLowerCase() : null,
    });
  }
  return areas;
}

export async function handleOceanTropicalOutlook(
  _url: URL,
  cors: Record<string, string>,
  deps: OceanDeps,
): Promise<Response> {
  const cached = await readRouteCache('tropical-outlook', cors);
  if (cached) return cached;

  const fetched_at = new Date().toISOString();

  let graph: any[] = [];
  try {
    const list = await deps.cachedJsonFetch(TWO_LIST, TWO_TTL, 'application/ld+json');
    graph = Array.isArray(list?.['@graph']) ? list['@graph'] : [];
    if (!graph.length) throw new Error('empty product list');
  } catch {
    logEvent('ocean.two.list_unavailable', 'TWO product list unreachable');
    return degradedResponse('tropical-outlook', 'ocean_tropical_outlook', 'NHC/CPHC', TWO_TTL, cors, deps, 'unavailable');
  }

  const signals: any[] = [];
  const sourceHealth: Record<string, string> = {};
  const seenAreas = new Set<string>();
  let duplicatesSuppressed = 0;

  const perBasin = await Promise.allSettled(
    BASINS.map(async ({ wmo, basin }) => {
      const newest = graph.find((p: any) => p?.wmoCollectiveId === wmo);
      if (!newest?.id) throw new Error(`no ${wmo} product`);
      const prod = await deps.cachedJsonFetch(`${NWS_PRODUCT}/${newest.id}`, TWO_TTL, 'application/ld+json');
      return {
        basin,
        wmo,
        issued_at: typeof prod?.issuanceTime === 'string' ? prod.issuanceTime : null,
        text: String(prod?.productText || ''),
      };
    }),
  );

  for (let i = 0; i < perBasin.length; i++) {
    const r = perBasin[i];
    const { wmo, basin } = BASINS[i];
    if (r.status !== 'fulfilled' || !r.value.text.trim()) {
      sourceHealth[basin] = 'unavailable';
      logEvent('ocean.two.basin_unavailable', `${basin} (${wmo})`);
      continue;
    }
    sourceHealth[basin] = 'ok';
    for (const a of parseOutlookAreas(r.value.text)) {
      /* Cross-basin de-duplication.
       *
       * CPHC's outlook covers 140W-180W and NHC's eastern Pacific outlook
       * covers everything "east of 180", so the two products OVERLAP and
       * describe the same systems in the same words. Emitting both gave four
       * signals for two real disturbances — a client rendering the list would
       * show the same storm twice, which reads as twice the threat.
       *
       * The Central Pacific product is processed first and wins, because it
       * is the CPHC edition written for this region. An eastern Pacific area
       * is kept only when Central Pacific does not already carry it — those
       * are genuinely outside CPHC's window and may track in later. */
      const dupKey = a.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seenAreas.has(dupKey)) {
        duplicatesSuppressed++;
        continue;
      }
      seenAreas.add(dupKey);

      signals.push({
        basin,
        area: a.title,
        formation_chance_48h: a.c48,
        formation_chance_48h_label: a.c48_label,
        formation_chance_7d: a.c7,
        formation_chance_7d_label: a.c7_label,
        /* NHC publishes the Graphical Tropical Weather Outlook as KMZ and
         * shapefile only — there is no GeoJSON endpoint (verified against
         * nhc.noaa.gov/gis 2026-09-12). Per spec, polygons are skipped and
         * the text areas are served. Nothing is approximated into a shape. */
        geometry: null,
        geometry_status: 'unavailable_upstream_kmz_and_shapefile_only',
        discussion_short: a.discussion.length > 400 ? `${a.discussion.slice(0, 397)}...` : a.discussion,
        source: 'NHC/CPHC',
        issued_at: r.value.issued_at,
        fetched_at,
      });
    }
  }

  const anyBasinOk = Object.values(sourceHealth).includes('ok');
  if (!anyBasinOk) {
    return degradedResponse('tropical-outlook', 'ocean_tropical_outlook', 'NHC/CPHC', TWO_TTL, cors, deps, 'unavailable');
  }

  const issued = signals.map((s) => s.issued_at).filter(Boolean).sort().pop() || null;

  const body = envelope('ocean_tropical_outlook', 'NHC/CPHC', {
    stale_after_seconds: TWO_TTL,
    freshness: classify(ageSeconds(issued), 8 * 3600, 24 * 3600),
    /* A quiet basin is NORMAL, not a failure. Both are HTTP 200 and both are
     * renderable; the client must be able to tell them apart. */
    status: signals.length ? 'ok' : 'no_activity',
    signals,
    issued_at: issued,
    source_health: sourceHealth,
    // Published rather than hidden: a consumer comparing this to the raw NHC
    // text should be able to see that areas were merged, and how many.
    cross_basin_duplicates_suppressed: duplicatesSuppressed,
    note: 'Formation outlook only — not a forecast track. Follow the Central Pacific Hurricane Center for official advisories.',
    official_source_url: 'https://www.nhc.noaa.gov/?cpac',
  });

  await writeSnapshot('tropical-outlook', body);
  await writeRouteCache('tropical-outlook', body, TWO_TTL);
  return deps.jsonResp(body, 200, jsonHeaders(TWO_TTL, 'MISS', cors));
}

/* ── Exported for tests / diagnostics only. Not part of the route contract.
 *    Mirrors the `_debugBuildPrompt` convention already used in gemma.ts. ── */
export const _internals = {
  parseNdbc,
  parseOutlookAreas,
  waveTrend,
  classify,
  ageSeconds,
  // P27
  mapDohEvents,
  mapRunoffIslands,
  dohDateToIso,
  // P27c
  parseWkt,
  dohCentroid,
};

/* ═══════════════════════════════════════════════════════════════════════
   4) /api/ocean/water-quality — P27 Brown Water Advisory
   ═══════════════════════════════════════════════════════════════════════
   TWO SOURCES, NEVER BLENDED.

   (a) OFFICIAL — Hawaiʻi DOH Clean Water Branch. A machine-readable JSON API
       exists and IS used: the endpoint the agency's own public viewer calls,
       found by watching that viewer's network traffic rather than guessing:

         https://eha-cloud.doh.hawaii.gov/cwb/api/events?expand=locations&status=Open

       Returns {page, totalResultsCount, list:[...]} — no key, no auth. Verified
       2026-09-15: 8 open events, 6 of them Brown Water Advisories across Oʻahu,
       Maui, Kauaʻi and Hawaiʻi. This is a JSON API, not HTML scraping; the host
       serves no robots.txt (404).

       ⚠ PARSING TRAP, verified against the live feed: the `hasBwa` boolean does
       NOT mean "this is a Brown Water Advisory". It was true on a Sewage Spill
       and a Beach Advisory and FALSE on all six actual Brown Water Advisories —
       it flags brown-water conditions accompanying some OTHER event type. The
       advisory kind is `type`. Keying on hasBwa would have inverted the feature.

   (b) DERIVED — our own hazard layer. NWS Flash Flood Warnings in the past 72 h,
       which is the window DOH's own guidance covers. Shipped as
       kind "runoff_caution", NEVER as a DOH advisory, with a source string that
       says out loud that Kahu Ola derived it.

       /api/hazards/flash-flood is a CURRENT snapshot with no history, so a 72 h
       lookback cannot come from it. It comes from the same NWS origin queried
       over a time range (api.weather.gov/alerts?start=…), which is the only way
       to see a warning that has already expired — and expired is exactly the
       case this feature exists for. Verified the range parameter is honoured:
       14 days returns 15 alerts including 2 Flash Flood Warnings; 72 h returns 0
       today, which is the quiet state.

       Islands come from the alert's UGC COUNTY code (HIC001 etc.), not from
       matching island names in areaDesc. P57 measured that name join failing for
       29 of 31 zones; the county code is unambiguous.

   PRECEDENCE: an island carrying a DOH advisory does not also get a
   runoff_caution. The official advisory supersedes our derived hint, and
   printing both would double-count one event.
   ═══════════════════════════════════════════════════════════════════════ */

const DOH_EVENTS_URL =
  'https://eha-cloud.doh.hawaii.gov/cwb/api/events?expand=locations&status=Open&statuses=Open';
const DOH_PUBLIC_URL = 'https://eha-cloud.doh.hawaii.gov/cwb/#!/viewer';
const NWS_ALERTS_HISTORY = 'https://api.weather.gov/alerts';
const RUNOFF_LOOKBACK_HOURS = 72;

/** NWS UGC county code → the islands that county covers. */
const UGC_COUNTY_TO_ISLANDS: Record<string, string[]> = {
  HIC001: ['hawaii'],                                  // Hawaiʻi County
  HIC003: ['oahu'],                                    // Honolulu County
  HIC005: ['molokai'],                                 // Kalawao (Kalaupapa, Molokaʻi)
  HIC007: ['kauai', 'niihau'],                         // Kauaʻi County
  HIC009: ['maui', 'molokai', 'lanai', 'kahoolawe'],   // Maui County
};

/** DOH island.cleanName → our island key. Absent name → signal still ships
 *  with island null; an advisory is never dropped for want of a key. */
const DOH_ISLAND_TO_KEY: Record<string, string> = {
  Oahu: 'oahu', Maui: 'maui', Kauai: 'kauai', Hawaii: 'hawaii',
  Molokai: 'molokai', Lanai: 'lanai', Niihau: 'niihau', Kahoolawe: 'kahoolawe',
};

const ISLAND_DISPLAY: Record<string, string> = {
  oahu: 'Oʻahu', maui: 'Maui', kauai: 'Kauaʻi', hawaii: 'Hawaiʻi Island',
  molokai: 'Molokaʻi', lanai: 'Lānaʻi', niihau: 'Niʻihau', kahoolawe: 'Kahoʻolawe',
};

/* Fixed copy, per spec. Calm and non-directive: it says what conditions are
   likely and what a person might consider, and routes the decision to DOH
   (Invariant 7). No exclamation mark, no imperative. */
const RUNOFF_CAUTION_DETAIL =
  'Recent flash flooding — coastal runoff possible. Consider avoiding ocean swimming ' +
  'for 48–72 hours near affected shores.';

type GeoJsonGeometry =
  | { type: 'Point'; coordinates: number[] }
  | { type: 'LineString'; coordinates: number[][] }
  | { type: 'MultiLineString'; coordinates: number[][][] }
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

type WaterQualitySignal = {
  island: string | null;
  island_label: string | null;
  kind: 'doh_advisory' | 'runoff_caution';
  detail: string;
  advisory_type: string | null;   // DOH's own `type`, verbatim. Null when derived.
  started_at: string | null;
  source: string;
  official_source_url: string;
  fetched_at: string;
  // ── P27c ADDITIVE ────────────────────────────────────────────────────
  // DOH ships shoreline extents as WKT in locations[].geometry, parsed here
  // rather than in the browser so every client gets the same geometry and no
  // WKT parser has to exist twice. Null on a malformed or out-of-range shape —
  // and the advisory still ships as text, because losing a real DOH advisory
  // over a bad polygon would be the worse failure.
  geometry: GeoJsonGeometry | null;
  centroid: [number, number] | null;
};

/** DOH posts local timestamps with no zone marker ("2026-09-08T20:34:03.337").
 *  Treated as Hawaiʻi time (UTC-10) rather than silently read as UTC, which
 *  would shift every advisory ten hours. Unparseable → null, never guessed. */
function dohDateToIso(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 10, +m[5], +m[6]);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/* ══════════════════════════════════════════════════════════════════════
   P27c · WKT → GeoJSON
   ══════════════════════════════════════════════════════════════════════
   DOH publishes advisory extents as Well-Known Text on locations[].geometry.
   Observed live: POLYGON (686-3,855 chars of shoreline) and POINT (Beach
   Advisories). LINESTRING, MULTIPOLYGON and MULTILINESTRING are handled too —
   not because they have been seen, but because a geometry type we do not
   recognise must produce null rather than a wrong shape.

   Strict throughout. A coordinate that is not two finite numbers in range, a
   ring with fewer than four positions, an unbalanced parenthesis — any of these
   returns null for the whole geometry. Nothing is repaired, closed or guessed:
   a half-parsed shoreline drawn on a hazard map is worse than no shoreline.
   ══════════════════════════════════════════════════════════════════════ */

/** One "lon lat" pair. Rejects NaN, Infinity, and out-of-range coordinates. */
function wktPosition(token: string): number[] | null {
  const parts = token.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const lon = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return [lon, lat];
}

/** "a b, c d, …" → positions. Null if ANY position is bad (fail closed). */
function wktPositionList(body: string): number[][] | null {
  const out: number[][] = [];
  for (const tok of body.split(',')) {
    const pos = wktPosition(tok);
    if (!pos) return null;
    out.push(pos);
  }
  return out.length ? out : null;
}

/**
 * Split "(…),(…),(…)" into its top-level groups, respecting nesting.
 * A plain split(',') would tear rings apart at their own coordinate commas.
 */
function wktSplitGroups(body: string): string[] | null {
  const groups: string[] = [];
  let depth = 0, start = -1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '(') { if (depth === 0) start = i + 1; depth++; }
    else if (c === ')') {
      depth--;
      if (depth === 0) { groups.push(body.slice(start, i)); start = -1; }
      if (depth < 0) return null;            // unbalanced
    }
  }
  return depth === 0 && groups.length ? groups : null;
}

/** A polygon ring: >= 4 positions and explicitly closed by the source. */
function wktRing(body: string): number[][] | null {
  const ring = wktPositionList(body);
  if (!ring || ring.length < 4) return null;
  const a = ring[0], b = ring[ring.length - 1];
  // Not auto-closed: an unclosed ring means the source is not what we think it
  // is, and silently closing it would invent an edge.
  if (a[0] !== b[0] || a[1] !== b[1]) return null;
  return ring;
}

function parseWkt(raw: unknown): GeoJsonGeometry | null {
  if (typeof raw !== 'string') return null;
  const wkt = raw.trim();
  if (!wkt) return null;
  const m = /^([A-Za-z]+)\s*\((.*)\)$/s.exec(wkt);
  if (!m) return null;
  const kind = m[1].toUpperCase();
  const body = m[2];

  try {
    if (kind === 'POINT') {
      const p = wktPosition(body);
      return p ? { type: 'Point', coordinates: p } : null;
    }
    if (kind === 'LINESTRING') {
      const line = wktPositionList(body);
      return line && line.length >= 2 ? { type: 'LineString', coordinates: line } : null;
    }
    if (kind === 'POLYGON') {
      const groups = wktSplitGroups(body);
      if (!groups) return null;
      const rings: number[][][] = [];
      for (const g of groups) {
        const r = wktRing(g);
        if (!r) return null;
        rings.push(r);
      }
      return { type: 'Polygon', coordinates: rings };
    }
    if (kind === 'MULTILINESTRING') {
      const groups = wktSplitGroups(body);
      if (!groups) return null;
      const lines: number[][][] = [];
      for (const g of groups) {
        const l = wktPositionList(g);
        if (!l || l.length < 2) return null;
        lines.push(l);
      }
      return { type: 'MultiLineString', coordinates: lines };
    }
    if (kind === 'MULTIPOLYGON') {
      const polys = wktSplitGroups(body);
      if (!polys) return null;
      const out: number[][][][] = [];
      for (const poly of polys) {
        const groups = wktSplitGroups(poly);
        if (!groups) return null;
        const rings: number[][][] = [];
        for (const g of groups) {
          const r = wktRing(g);
          if (!r) return null;
          rings.push(r);
        }
        out.push(rings);
      }
      return { type: 'MultiPolygon', coordinates: out };
    }
  } catch {
    return null;   // a parser must never throw into the handler
  }
  return null;     // unrecognised geometry type — null, never a guess
}

/**
 * Centroid. DOH publishes its own on locations[].centroid, and that is
 * preferred: it is their placement of the marker, not our arithmetic. Falling
 * back to a POINT geometry's own coordinate is the same value by definition.
 * Anything else yields null — a computed "middle" of a concave shoreline can
 * land in open ocean or on the wrong island, which is worse than no marker.
 */
function dohCentroid(loc: Record<string, any>, geom: GeoJsonGeometry | null): [number, number] | null {
  const fromField = parseWkt(loc?.centroid);
  if (fromField && fromField.type === 'Point') {
    const c = fromField.coordinates;
    return [c[0], c[1]];
  }
  if (geom && geom.type === 'Point') return [geom.coordinates[0], geom.coordinates[1]];
  return null;
}

function mapDohEvents(data: unknown, fetchedAt: string): WaterQualitySignal[] | null {
  if (!data || typeof data !== 'object') return null;
  const list = (data as Record<string, unknown>)['list'];
  if (!Array.isArray(list)) return null;

  const out: WaterQualitySignal[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;   // fail closed, per record
    const e = raw as Record<string, any>;
    const type = typeof e.type === 'string' ? e.type.trim() : '';
    if (!type) continue;
    const title = typeof e.title === 'string' ? e.title.trim() : '';
    if (!title) continue;

    const cleanName = e.island && typeof e.island.cleanName === 'string' ? e.island.cleanName : '';
    const key = DOH_ISLAND_TO_KEY[cleanName] ?? null;

    // P27c. First location with a usable geometry wins. DOH has published one
    // per event so far; if that ever changes, taking the first is honest
    // (the popup still names the advisory) where merging would invent a shape.
    let geometry: GeoJsonGeometry | null = null;
    let centroid: [number, number] | null = null;
    const locs = Array.isArray(e.locations) ? e.locations : [];
    for (const loc of locs) {
      if (!loc || typeof loc !== 'object') continue;
      const g = parseWkt((loc as any).geometry);
      const c = dohCentroid(loc as any, g);
      if (g || c) { geometry = g; centroid = c; break; }
    }

    out.push({
      island: key,
      island_label: key ? ISLAND_DISPLAY[key] : (cleanName || null),
      kind: 'doh_advisory',
      // DOH's own title, verbatim. Their words on their advisory (Invariant 11).
      detail: title,
      advisory_type: type,
      started_at: dohDateToIso(e.postedDate),
      source: 'Hawaiʻi DOH',
      official_source_url: DOH_PUBLIC_URL,
      fetched_at: fetchedAt,
      geometry,
      centroid,
    });
  }
  return out;
}

/** Islands with an NWS Flash Flood Warning inside the lookback window. */
function mapRunoffIslands(data: unknown): Map<string, string> {
  const hits = new Map<string, string>();   // island → earliest onset seen
  if (!data || typeof data !== 'object') return hits;
  const feats = (data as Record<string, unknown>)['features'];
  if (!Array.isArray(feats)) return hits;

  for (const f of feats) {
    const p = (f as any)?.properties;
    if (!p || String(p.event || '').trim() !== 'Flash Flood Warning') continue;
    const ugc: unknown = p.geocode?.UGC;
    if (!Array.isArray(ugc)) continue;
    const onset = typeof p.onset === 'string' ? p.onset : (typeof p.sent === 'string' ? p.sent : null);
    const iso = onset && Number.isFinite(Date.parse(onset)) ? new Date(onset).toISOString() : null;
    for (const code of ugc) {
      const islands = UGC_COUNTY_TO_ISLANDS[String(code).toUpperCase()];
      if (!islands) continue;   // a zone code (HIZxxx) is not keyed — never guessed
      for (const isl of islands) {
        const prev = hits.get(isl);
        if (iso && (!prev || iso < prev)) hits.set(isl, iso);
        else if (!hits.has(isl)) hits.set(isl, iso ?? '');
      }
    }
  }
  return hits;
}

export async function handleOceanWaterQuality(
  _url: URL,
  cors: Record<string, string>,
  deps: OceanDeps,
): Promise<Response> {
  const cached = await readRouteCache('water-quality', cors);
  if (cached) return cached;

  const fetched_at = new Date().toISOString();
  const sourceHealth: Record<string, string> = {};

  // Rounded to the hour so the URL — and therefore the cache key — is stable.
  // An unrounded `start` would change every second and defeat caching entirely,
  // turning a 30-minute route into an NWS hammer.
  const since = new Date(Date.now() - RUNOFF_LOOKBACK_HOURS * 3600_000);
  since.setUTCMinutes(0, 0, 0);
  const historyUrl =
    `${NWS_ALERTS_HISTORY}?area=HI&start=${encodeURIComponent(since.toISOString().replace(/\.\d{3}Z$/, 'Z'))}&limit=500`;

  const [dohRes, nwsRes] = await Promise.allSettled([
    deps.cachedJsonFetch(DOH_EVENTS_URL, WQ_TTL, 'application/json'),
    deps.cachedJsonFetch(historyUrl, WQ_TTL, 'application/geo+json'),
  ]);

  const doh = dohRes.status === 'fulfilled' ? mapDohEvents(dohRes.value, fetched_at) : null;
  sourceHealth.doh = doh === null ? 'unavailable' : 'ok';
  if (doh === null) logEvent('ocean.wq.doh_unavailable', 'DOH events feed unusable');

  const nwsOk = nwsRes.status === 'fulfilled' && !!nwsRes.value;
  const runoff = nwsOk ? mapRunoffIslands(nwsRes.value) : new Map<string, string>();
  sourceHealth.nws_flash_flood_history = nwsOk ? 'ok' : 'unavailable';
  if (!nwsOk) logEvent('ocean.wq.nws_history_unavailable', 'alert history unusable');

  // Both sources down is an outage, not a clean ocean.
  if (doh === null && !nwsOk) {
    return degradedResponse('water-quality', 'ocean_water_quality',
      'Hawaiʻi DOH / NWS', WQ_TTL, cors, deps, 'unavailable');
  }

  const signals: WaterQualitySignal[] = doh ? [...doh] : [];
  const dohIslands = new Set(signals.map((x) => x.island).filter(Boolean) as string[]);

  for (const [island, onset] of runoff) {
    if (dohIslands.has(island)) continue;   // official advisory supersedes
    signals.push({
      island,
      island_label: ISLAND_DISPLAY[island] ?? island,
      kind: 'runoff_caution',
      detail: RUNOFF_CAUTION_DETAIL,
      advisory_type: null,
      started_at: onset || null,
      // Says plainly that this is ours, not DOH's.
      source: 'Derived from NWS flash flood warnings · Kahu Ola',
      official_source_url: DOH_PUBLIC_URL,
      fetched_at,
      // P27c. No geometry by design: a runoff caution is an island-level
      // inference from a county-wide warning, not a mapped extent. Drawing a
      // shape for it would give our own derivation the look of a DOH advisory.
      geometry: null,
      centroid: null,
    });
  }

  // DOH advisories first, then derived cautions; newest first within each.
  signals.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'doh_advisory' ? -1 : 1;
    return String(b.started_at || '').localeCompare(String(a.started_at || ''));
  });

  const body = envelope('ocean_water_quality', 'Hawaiʻi DOH Clean Water Branch / NWS', {
    stale_after_seconds: WQ_TTL,
    freshness: 'FRESH',
    // A clean ocean is NORMAL and reports 200 with an empty list — never an
    // error, never a blank (Invariant 3).
    status: signals.length ? 'active' : 'clear',
    signals,
    doh_advisory_count: signals.filter((x) => x.kind === 'doh_advisory').length,
    runoff_caution_count: signals.filter((x) => x.kind === 'runoff_caution').length,
    runoff_lookback_hours: RUNOFF_LOOKBACK_HOURS,
    source_health: sourceHealth,
    official_source_url: DOH_PUBLIC_URL,
    note: 'Brown water and beach advisories are issued by the Hawaiʻi Department of Health. ' +
      'Runoff cautions are derived by Kahu Ola from NWS flash flood warnings and are not DOH advisories.',
  });

  await writeSnapshot('water-quality', body);
  await writeRouteCache('water-quality', body, WQ_TTL);
  return deps.jsonResp(body, 200, jsonHeaders(WQ_TTL, 'MISS', cors));
}
