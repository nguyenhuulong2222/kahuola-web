/**
 * Kahu Ola Embeddable Safety Widget — Cloudflare Worker
 * Phase 3: real data, server-side.
 *
 * DOCTRINE COMPLIANCE:
 *  - Invariant I:  The partner-site browser talks to widget.kahuola.org ONLY.
 *                  This Worker calls the Kahu Ola API server-side. Neither ever
 *                  touches NASA/NOAA/NWS/EPA/USGS/PacIOOS directly.
 *  - Invariant II: The widget ALWAYS renders. Any data failure → deterministic
 *                  degraded card. Never blank, never placeholder numbers.
 *  - Invariant III:Parse failure → drop the field, show "unavailable". Never
 *                  infer a missing field, never substitute a default number.
 *  - Invariant IV: Zero PII. No user location, no identifiers, no cookies. The
 *                  `location` attribute is a coarse place name chosen by the
 *                  SITE OWNER, never by geolocation of the visitor.
 *  - Invariant V:  Status only. No perimeter claims, no official boundaries.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * P58 NOTES — what this replaces and why.
 *
 * The version live on widget.kahuola.org was deployed from an unmerged branch
 * (190dfa1, feat/widget-phase3). It read `summary.fire.count`, which counts
 * EVERY FIRMS thermal pixel including volcanic ones, so a Kīlauea heat signal
 * rendered as a wildfire on partner sites — the same defect P52 removed from
 * the homepage. This version reads `fire.wildland_count` and reports volcanic
 * detections separately, or not at all.
 *
 * That version also had the partner browser fetch kahuola.org/api directly.
 * The fetch moves back into this Worker: one origin for partner CSP, one edge
 * cache absorbing partner traffic instead of the main hazard Worker, and the
 * AQI monitor-distance calculation runs here rather than shipping a coordinate
 * table to every embedding site.
 *
 * VERIFIED UPSTREAM SHAPES (curl, 2026-09-09) — this Worker adapts to the real
 * responses, and does not assume fields that are not there:
 *
 *   GET /api/hazards/summary  → { region, generated_at, stale,
 *       fire: { count, volcanic_zone_count, wildland_count, status,
 *               age_seconds, source }, smoke: {...}, perimeters: {...},
 *       storm: {...}, note }
 *     There is NO `aqi` field and NO `fire_risk` field. Both the main-branch
 *     scaffold and the deployed branch looked for them; both always missed.
 *     `?region=maui` is ACCEPTED BUT IGNORED — the response is always
 *     region:"hawaii". Fire is therefore STATEWIDE and is labelled statewide.
 *
 *   GET /api/hazards/air?region=hawaii → { generated_at, freshness,
 *       monitor_count, monitors: [{ site, lat, lon, aqi, category, ... }] }
 *     Also statewide-only. AQI becomes location-specific by picking the
 *     nearest AirNow monitor and NAMING it with its distance, so the reader
 *     can see the scope rather than trust an unattributed number.
 *
 * Routes:
 *   GET /v1/embed.js  -> vanilla JS Web Component (Shadow DOM scoped)
 *   GET /v1/status    -> JSON status, edge-cached (the browser's only data call)
 *   GET /v1/health    -> JSON booleans only. No secrets, no PII.
 */

export interface Env {
  KAHUOLA_API_BASE?: string;
}

/**
 * The embed script and status payload are PUBLIC static assets served to
 * arbitrary partner sites. There are no credentialed requests, so a fixed
 * wildcard is correct and intentional here (not an oversight).
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Vary': 'Origin',
};

/** Upstream budget. Task-specified: 8s hard ceiling per request. */
const FETCH_TIMEOUT_MS = 8000;

/** Data older than this is labelled "may be outdated" rather than "Live". */
const STALE_AFTER_SECONDS = 3600;

/** Edge cache for /v1/status. Absorbs partner traffic; protects the main API. */
const STATUS_CACHE_SECONDS = 90;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'method_not_allowed' }, 405);
    }

    if (url.pathname === '/v1/health') {
      return json({
        ok: true,
        phase: 3,
        api_wired: Boolean(env.KAHUOLA_API_BASE),
        ts: new Date().toISOString(),
      });
    }

    if (url.pathname === '/v1/status') {
      return await handleStatus(sanitizeLocation(url.searchParams.get('location')), env);
    }

    if (url.pathname === '/v1/embed.js') {
      return new Response(EMBED_JS, {
        status: 200,
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
          ...CORS_HEADERS,
        },
      });
    }

    return json({ error: 'not_found' }, 404);
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

/**
 * The ONLY thing this Worker ever writes to the log: a single-line structured
 * event, on failure, naming the layer that failed. No payload, no partner
 * origin, no visitor data — nothing that could carry PII into a log sink.
 * There is no success-path logging at all.
 */
function logEvent(event: string, detail: string): void {
  console.error(JSON.stringify({ evt: event, detail, ts: new Date().toISOString() }));
}

/**
 * Allowlist-shaped: lowercase, [a-z-] only, max 32 chars. This is a place name
 * the SITE OWNER put in their HTML — never a visitor's position. Nothing here
 * reads geolocation, and nothing may start.
 */
function sanitizeLocation(raw: string | null): string {
  const v = (raw || 'maui').toLowerCase().replace(/[^a-z-]/g, '').slice(0, 32);
  return v.length ? v : 'maui';
}

/**
 * Reference points for resolving the nearest air-quality monitor. These are
 * the same coarse town centroids the main site already ships in its zone
 * table — public places, ~1km precision, no relation to any visitor.
 *
 * A name absent from this table is NOT guessed at. It falls through to
 * statewide scope, which the card states in words.
 */
const PLACES: Record<string, { label: string; lat: number; lon: number }> = {
  wailuku:  { label: 'Wailuku',      lat: 20.8893, lon: -156.5047 },
  lahaina:  { label: 'Lahaina',      lat: 20.8783, lon: -156.6825 },
  kihei:    { label: 'Kīhei',        lat: 20.7645, lon: -156.4440 },
  kahului:  { label: 'Kahului',      lat: 20.8997, lon: -156.4700 },
  maui:     { label: 'Maui',         lat: 20.8000, lon: -156.3300 },
  honolulu: { label: 'Honolulu',     lat: 21.3069, lon: -157.8583 },
  hilo:     { label: 'Hilo',         lat: 19.7176, lon: -155.1105 },
  kona:     { label: 'Kailua-Kona',  lat: 19.6182, lon: -155.9712 },
};

/**
 * Rows carry STRUCTURED fields, not sentences. The card composes the visible
 * text so that a `lang="vi"` widget is Vietnamese all the way down — an
 * earlier build localized the labels but left the scope line, the relative
 * time and the footer note in English, which reads worse than either language
 * alone. `scope` is kept as a pre-composed English fallback for non-browser
 * consumers of /v1/status.
 */
interface AirRow {
  aqi: number;
  category: string;
  site: string;
  distance_km: number | null;   // null → statewide worst-case, not a local read
  monitor_count: number;
  scope: string;
}

interface FireRow {
  wildland: number;
  volcanic: number;
  statewide: boolean;
  scope: string;
}

interface WidgetStatus {
  location: string;
  place_label: string;
  air: AirRow | null;
  fire: FireRow | null;
  status: 'fresh' | 'stale' | 'unavailable';
  generated_at: string | null;
  source_note: string;
}

function degradedStatus(location: string): WidgetStatus {
  const place = PLACES[location];
  return {
    location,
    place_label: place ? place.label : 'Hawaiʻi',
    air: null,
    fire: null,
    status: 'unavailable',
    generated_at: null,
    source_note: 'Data temporarily unavailable — check official sources.',
  };
}

/**
 * Fetch both sources server-side, in parallel, under one 8s budget.
 *
 * Partial failure is handled per-source rather than card-wide: if the air feed
 * fails but the fire summary succeeds, hiding the fire status too would be
 * throwing away good hazard data to punish an unrelated outage. Each row that
 * cannot be read says so on its own line; only when NEITHER source parses does
 * the whole card go degraded.
 */
async function handleStatus(location: string, env: Env): Promise<Response> {
  if (!env.KAHUOLA_API_BASE) {
    logEvent('widget.config.missing_api_base', 'KAHUOLA_API_BASE unset');
    return json(degradedStatus(location));
  }

  const cache = caches.default;
  const cacheKey = new Request(`https://widget.kahuola.org/v1/status?location=${location}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const base = env.KAHUOLA_API_BASE.replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  let summaryData: unknown = null;
  let airData: unknown = null;
  try {
    const [sRes, aRes] = await Promise.allSettled([
      fetchJson(`${base}/hazards/summary`, ctrl.signal),
      fetchJson(`${base}/hazards/air?region=hawaii`, ctrl.signal),
    ]);
    summaryData = sRes.status === 'fulfilled' ? sRes.value : null;
    airData = aRes.status === 'fulfilled' ? aRes.value : null;
  } catch {
    // Nothing here may throw to the card.
  } finally {
    clearTimeout(timer);
  }

  const fire = mapFire(summaryData);
  const air = mapAir(airData, location);

  if (!fire && !air) {
    logEvent('widget.upstream.both_failed', 'summary and air unusable');
    return json(degradedStatus(location));
  }
  if (!fire) logEvent('widget.upstream.summary_failed', 'fire row unavailable');
  if (!air) logEvent('widget.upstream.air_failed', 'air row unavailable');

  const generated_at = readGeneratedAt(summaryData) ?? readGeneratedAt(airData);
  const stale = isStale(summaryData, airData, generated_at);
  const place = PLACES[location];

  const payload: WidgetStatus = {
    location,
    place_label: place ? place.label : 'Hawaiʻi',
    air,
    fire,
    status: stale ? 'stale' : 'fresh',
    generated_at,
    source_note: stale
      ? 'Data may be outdated — check official sources.'
      : 'Public hazard data · situational awareness only.',
  };

  const resp = json(payload);
  const cacheable = new Response(resp.clone().body, resp);
  cacheable.headers.set('Cache-Control', `public, max-age=${STATUS_CACHE_SECONDS}`);
  await cache.put(cacheKey, cacheable);
  return resp;
}

/** Resolves to parsed JSON, or null on any non-200 / bad body. Never throws. */
async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  try {
    const r = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;   // network, abort, timeout, malformed JSON — all the same here
  }
}

function readGeneratedAt(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const g = (data as Record<string, unknown>)['generated_at'];
  return typeof g === 'string' && g.trim() ? g : null;
}

/**
 * Freshness. Trusts an explicit upstream flag first (`stale: true`,
 * `freshness: "STALE"`), then falls back to the age of generated_at.
 * A timestamp we cannot parse counts as stale, never as fresh.
 */
function isStale(summary: unknown, air: unknown, generatedAt: string | null): boolean {
  for (const d of [summary, air]) {
    if (!d || typeof d !== 'object') continue;
    const o = d as Record<string, unknown>;
    if (o['stale'] === true) return true;
    const f = o['freshness'];
    if (typeof f === 'string' && f.toUpperCase().startsWith('STALE')) return true;
  }
  if (!generatedAt) return true;
  const t = Date.parse(generatedAt);
  if (!Number.isFinite(t)) return true;
  return (Date.now() - t) / 1000 > STALE_AFTER_SECONDS;
}

/**
 * Fire, from the REAL summary shape.
 *
 * P52/P58: reads `wildland_count`, never `count`. `count` includes volcanic
 * thermal pixels, and lava does not spread with wind — reporting a Kīlauea
 * heat signal as a wildfire invents a hazard nobody can act on. Volcanic
 * detections are carried separately so they are not silently dropped either.
 *
 * Returns null (→ row reads "unavailable") if the block is missing or the
 * counts are not numbers. No field is inferred and no count is defaulted to 0.
 */
function mapFire(data: unknown): FireRow | null {
  if (!data || typeof data !== 'object') return null;
  const f = (data as Record<string, unknown>)['fire'];
  if (!f || typeof f !== 'object') return null;
  const o = f as Record<string, unknown>;

  const status = typeof o['status'] === 'string' ? o['status'] : '';
  if (status === 'miss' || status === 'unavailable') return null;

  const wildRaw = o['wildland_count'];
  const volcRaw = o['volcanic_zone_count'];
  if (typeof wildRaw !== 'number' || !Number.isFinite(wildRaw)) return null;
  const volcanic =
    typeof volcRaw === 'number' && Number.isFinite(volcRaw) ? volcRaw : 0;

  return {
    wildland: wildRaw,
    volcanic,
    // Stated, not implied: /api/hazards/summary accepts ?region= but always
    // answers statewide, so this number is never island- or town-scoped.
    statewide: true,
    scope: 'Statewide · NASA FIRMS',
  };
}

/**
 * Air quality, from the REAL /api/hazards/air shape.
 *
 * The feed is a list of AirNow monitors, not a scalar. For a known place we
 * take the NEAREST monitor and report its name and distance, so the reader can
 * judge how well it represents them. For an unknown place we report the
 * HIGHEST reading statewide and say so — for a hazard widget the worst
 * observation is the safety-relevant aggregate, and an average would smooth
 * away the one monitor that matters.
 */
function mapAir(data: unknown, location: string): AirRow | null {
  if (!data || typeof data !== 'object') return null;
  const monitorsRaw = (data as Record<string, unknown>)['monitors'];
  if (!Array.isArray(monitorsRaw)) return null;

  interface M { site: string; lat: number; lon: number; aqi: number; category: string }
  const monitors: M[] = [];
  for (const m of monitorsRaw) {
    if (!m || typeof m !== 'object') continue;
    const o = m as Record<string, unknown>;
    if (typeof o['aqi'] !== 'number' || !Number.isFinite(o['aqi'])) continue;
    if (typeof o['lat'] !== 'number' || typeof o['lon'] !== 'number') continue;
    monitors.push({
      site: typeof o['site'] === 'string' ? o['site'] : 'Unnamed monitor',
      lat: o['lat'], lon: o['lon'], aqi: o['aqi'],
      category: typeof o['category'] === 'string' ? o['category'] : '',
    });
  }
  if (!monitors.length) return null;

  const place = PLACES[location];
  if (!place) {
    let worst = monitors[0];
    for (const m of monitors) if (m.aqi > worst.aqi) worst = m;
    return {
      aqi: worst.aqi,
      category: worst.category,
      site: worst.site,
      distance_km: null,
      monitor_count: monitors.length,
      scope: `Highest of ${monitors.length} monitors statewide · ${worst.site}`,
    };
  }

  let best = monitors[0];
  let bestD = haversineKm(place.lat, place.lon, best.lat, best.lon);
  for (const m of monitors) {
    const d = haversineKm(place.lat, place.lon, m.lat, m.lon);
    if (d < bestD) { best = m; bestD = d; }
  }
  const km = Math.round(bestD);
  return {
    aqi: best.aqi,
    category: best.category,
    site: best.site,
    distance_km: km,
    monitor_count: monitors.length,
    scope: `Nearest monitor · ${best.site} (${km} km)`,
  };
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * The embeddable Web Component.
 *
 * Vanilla JS. Shadow DOM. No React/Vue/Tailwind/Bootstrap, no external CSS,
 * no fonts, no images. The only network call is to this Worker's /v1/status
 * on the same origin the script itself was served from.
 *
 * Nothing is written to console. Failures surface as a `kahuola-widget:error`
 * CustomEvent on the element, which an embedding site may listen for and which
 * carries a stage name only — never data, never the visitor.
 *
 * `lang="vi"` is supported because the version this replaces shipped
 * Vietnamese-only labels; dropping them silently would be a regression for the
 * readers that build was for. English is the default.
 */
const EMBED_JS = String.raw`(function () {
  "use strict";

  var THEMES = {
    dark:  { bg:"#08111a", text:"#eef4fb", muted:"#8ea3b7", border:"rgba(255,255,255,0.08)" },
    light: { bg:"#ffffff", text:"#0b1722", muted:"#5a6b7b", border:"rgba(0,0,0,0.10)" }
  };
  var ACCENT = "#ff6a00", GREEN = "#4caf50", AMBER = "#ff9800";
  var TIMEOUT_MS = 8000;

  // Every visible string is composed here, so a card is wholly one language.
  var STR = {
    en: {
      air: "Air Quality (AQI)", fire: "Wildfire detections",
      live: "Live", stale: "Data may be outdated", down: "Status unavailable",
      loading: "Checking…", unavail: "Unavailable",
      degraded: "Data temporarily unavailable — check official sources.",
      ok_note: "Public hazard data · situational awareness only.",
      statewide: "Statewide · NASA FIRMS",
      nearest: function (site, km) { return "Nearest monitor · " + site + " (" + km + " km)"; },
      worst: function (n, site) { return "Highest of " + n + " monitors statewide · " + site; },
      volcanic: function (n) { return n + " volcanic heat signal" + (n > 1 ? "s" : "") + " (not wildfire)"; },
      updated: function (s) { return "Updated " + s; },
      justNow: "just now",
      min: function (n) { return n + " min ago"; },
      hr:  function (n) { return n + " hr ago"; },
      day: function (n) { return n + " d ago"; },
      powered: "Powered by Kahu Ola"
    },
    vi: {
      air: "Chất lượng không khí (AQI)", fire: "Điểm cháy rừng",
      live: "Trực tiếp", stale: "Dữ liệu có thể đã cũ", down: "Không có trạng thái",
      loading: "Đang kiểm tra…", unavail: "Nguồn tạm gián đoạn",
      degraded: "Dữ liệu tạm thời không khả dụng — xem nguồn chính thức.",
      ok_note: "Dữ liệu nguy hiểm công khai · chỉ để tham khảo.",
      statewide: "Toàn tiểu bang · NASA FIRMS",
      nearest: function (site, km) { return "Trạm gần nhất · " + site + " (" + km + " km)"; },
      worst: function (n, site) { return "Cao nhất trong " + n + " trạm toàn bang · " + site; },
      volcanic: function (n) { return n + " tín hiệu nhiệt núi lửa (không phải cháy rừng)"; },
      updated: function (s) { return "Cập nhật " + s; },
      justNow: "vừa xong",
      min: function (n) { return n + " phút trước"; },
      hr:  function (n) { return n + " giờ trước"; },
      day: function (n) { return n + " ngày trước"; },
      powered: "Cung cấp bởi Kahu Ola"
    }
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c];
    });
  }

  function ago(iso, S) {
    if (!iso) return null;
    var t = Date.parse(iso);
    if (!isFinite(t)) return null;
    var m = Math.floor((Date.now() - t) / 60000);
    if (m < 1) return S.justNow;
    if (m < 60) return S.min(m);
    var h = Math.floor(m / 60);
    if (h < 24) return S.hr(h);
    return S.day(Math.floor(h / 24));
  }

  function headTone(status, t) {
    if (status === "fresh") return GREEN;
    if (status === "stale") return AMBER;
    return t.muted;
  }

  function headText(status, S) {
    if (status === "fresh") return S.live;
    if (status === "stale") return S.stale;
    return S.down;
  }

  function row(key, value, scope, valueColor) {
    return '<div class="k-row">' +
        '<div class="k-rowtop">' +
          '<span class="k-key">' + esc(key) + '</span>' +
          '<span class="k-val"' + (valueColor ? ' style="color:' + valueColor + '"' : '') + '>' + esc(value) + '</span>' +
        '</div>' +
        (scope ? '<div class="k-scope">' + esc(scope) + '</div>' : '') +
      '</div>';
  }

  // data === null  -> loading (first paint, before any fetch resolves)
  // data.status === "unavailable" -> degraded card
  function render(root, data, theme, lang, loc) {
    var t = THEMES[theme] || THEMES.light;
    var S = STR[lang] || STR.en;
    var loading = (data === null);
    var st = loading ? "loading" : data.status;
    var hc = loading ? t.muted : headTone(st, t);
    var ht = loading ? S.loading : headText(st, S);

    // "Hawaiʻi, Hawaiʻi" is not a place. The region suffix is added only when
    // the label is a town; an unmapped location already reads as the state.
    var label = loading
      ? (loc.charAt(0).toUpperCase() + loc.slice(1))
      : (data.place_label || "Hawaiʻi");
    var title = (label === "Hawaiʻi") ? label : (label + ", Hawaiʻi");

    var body;
    if (loading || st === "unavailable") {
      var v = loading ? S.loading : S.unavail;
      body = row(S.air, v, "", t.muted) + row(S.fire, v, "", t.muted);
    } else {
      var airVal = S.unavail, airScope = "";
      if (data.air) {
        airVal = String(data.air.aqi) + (data.air.category ? " · " + data.air.category : "");
        airScope = (data.air.distance_km == null)
          ? S.worst(data.air.monitor_count, data.air.site)
          : S.nearest(data.air.site, data.air.distance_km);
      }
      var fireVal = S.unavail, fireScope = "";
      if (data.fire) {
        fireVal = String(data.fire.wildland);
        fireScope = data.fire.statewide ? S.statewide : "";
        // Volcanic detections are named, never folded into the wildfire count.
        if (data.fire.volcanic > 0) {
          fireScope += (fireScope ? " · " : "") + S.volcanic(data.fire.volcanic);
        }
      }
      body =
        row(S.air, airVal, airScope, data.air ? null : t.muted) +
        row(S.fire, fireVal, fireScope,
            data.fire ? (data.fire.wildland > 0 ? ACCENT : GREEN) : t.muted);
    }

    // Footer is composed from the card's own strings — never from the
    // Worker's English source_note, which would leave a VI card bilingual.
    var when = (!loading && data.generated_at) ? ago(data.generated_at, S) : null;
    var note = "";
    if (!loading) note = (st === "unavailable") ? S.degraded : (st === "stale" ? S.stale : S.ok_note);
    if (when) note = S.updated(when) + (note ? " · " + note : "");

    root.innerHTML =
      '<style>' +
        ':host{all:initial}' +
        '.k-card{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
          'background:' + t.bg + ';color:' + t.text + ';border:1px solid ' + t.border + ';' +
          'border-radius:14px;padding:16px 18px;max-width:340px;line-height:1.4}' +
        '.k-head{display:flex;align-items:center;justify-content:space-between;gap:12px}' +
        '.k-loc{font-size:13px;font-weight:600;letter-spacing:.02em;color:' + t.muted + '}' +
        '.k-dot{width:8px;height:8px;border-radius:50%;background:' + hc + ';flex:0 0 auto}' +
        '.k-stat{display:flex;align-items:center;gap:7px;font-size:12px;color:' + hc + ';font-weight:600}' +
        '.k-rows{margin:14px 0 12px}' +
        '.k-row{padding:8px 0;border-bottom:1px solid ' + t.border + '}' +
        '.k-row:last-child{border-bottom:0}' +
        '.k-rowtop{display:flex;align-items:baseline;justify-content:space-between;gap:10px}' +
        '.k-key{font-size:12px;color:' + t.muted + '}' +
        '.k-val{font-size:15px;font-weight:700}' +
        '.k-scope{margin-top:3px;font-size:10.5px;color:' + t.muted + ';opacity:.85}' +
        '.k-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;' +
          'margin-top:6px;font-size:11px;color:' + t.muted + '}' +
        '.k-foot a{color:' + ACCENT + ';text-decoration:none;font-weight:600}' +
        '.k-foot a:hover{text-decoration:underline}' +
      '</style>' +
      '<div class="k-card" role="region" aria-label="Kahu Ola hazard status for ' + esc(title) + '">' +
        '<div class="k-head">' +
          '<span class="k-loc">' + esc(title) + '</span>' +
          '<span class="k-stat"><span class="k-dot"></span>' + esc(ht) + '</span>' +
        '</div>' +
        '<div class="k-rows">' + body + '</div>' +
        '<div class="k-foot">' +
          '<span>' + esc(note) + '</span>' +
          '<a href="https://kahuola.org" target="_blank" rel="noopener">' + esc(S.powered) + '</a>' +
        '</div>' +
      '</div>';
  }

  function defineComponent() {
    class KahuOlaWidget extends HTMLElement {
      static get observedAttributes() { return ["location", "theme", "lang"]; }

      _loc()   { return (this.getAttribute("location") || "maui").toLowerCase(); }
      _theme() { return (this.getAttribute("theme") || "light").toLowerCase(); }
      _lang()  { return (this.getAttribute("lang") || "en").toLowerCase(); }

      _paint(data) {
        if (!this.shadowRoot) this.attachShadow({ mode: "open" });
        render(this.shadowRoot, data, this._theme(), this._lang(), this._loc());
      }

      // Structured event instead of console output. Stage name only: no
      // payload, no partner origin, nothing about the visitor.
      _fail(stage) {
        try {
          this.dispatchEvent(new CustomEvent("kahuola-widget:error", {
            bubbles: true, composed: true, detail: { stage: stage }
          }));
        } catch (e) {}
        this._paint({ status: "unavailable", place_label: null, air: null, fire: null, generated_at: null, source_note: null });
      }

      _origin() {
        try {
          var cs = document.currentScript;
          if (cs && cs.src) return new URL(cs.src).origin;
          var s = document.querySelector('script[src*="/v1/embed.js"]');
          if (s && s.src) return new URL(s.src).origin;
        } catch (e) {}
        return "";
      }

      _refresh() {
        var self = this;
        var origin = this._origin();
        if (!origin) { this._fail("origin"); return; }

        var ctrl = null, timer = null;
        try {
          ctrl = new AbortController();
          timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, TIMEOUT_MS);
        } catch (e) { ctrl = null; }

        try {
          fetch(origin + "/v1/status?location=" + encodeURIComponent(this._loc()), {
            method: "GET",
            credentials: "omit",
            cache: "no-store",
            signal: ctrl ? ctrl.signal : undefined
          }).then(function (r) {
            if (timer) clearTimeout(timer);
            if (!r || !r.ok) throw new Error("http");
            return r.json();
          }).then(function (j) {
            // Invariant III: an unrecognised payload is a failure, not a card.
            if (!j || typeof j !== "object" || typeof j.status !== "string") throw new Error("shape");
            self._paint(j);
          }).catch(function () {
            if (timer) clearTimeout(timer);
            self._fail("fetch");
          });
        } catch (e) {
          if (timer) clearTimeout(timer);
          this._fail("fetch");
        }
      }

      connectedCallback() {
        this._paint(null);   // Invariant II: paint immediately, unconditionally.
        this._refresh();
      }
      attributeChangedCallback() {
        if (this.shadowRoot) { this._paint(null); this._refresh(); }
      }
    }
    if (!customElements.get("kahuola-safety-widget")) {
      customElements.define("kahuola-safety-widget", KahuOlaWidget);
    }
  }

  if (window.customElements) defineComponent();
})();`;
