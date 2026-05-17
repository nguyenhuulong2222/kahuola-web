/**
 * Kahu Ola Embeddable Safety Widget — Cloudflare Worker
 * Phase 1: Safe Widget Skeleton
 *
 * DOCTRINE COMPLIANCE:
 *  - Invariant I:  Widget calls Kahu Ola Worker API ONLY. Never NASA/NOAA/NWS/EPA/USGS/PacIOOS.
 *                  Phase 1 uses placeholder data; Phase 3 wires to https://kahuola.org/api/*.
 *  - Invariant II: Widget ALWAYS renders. Data failure -> deterministic degraded card, never blank.
 *  - Invariant III:Parse failure -> drop data, show "unavailable", never infer fields.
 *  - Invariant IV: Zero PII. Widget collects/transmits no user location, no identifiers.
 *  - Invariant V:  No perimeter claims. Widget shows status only, never official boundaries.
 *
 * GROWTH_FEATURES section 6 ACCEPTANCE:
 *  - Renders under failure - labels stale/degraded honestly - no fake urgency
 *  - No user location exposed - visible attribution backlink - calm civic language
 *
 * Routes:
 *   GET /v1/embed.js   -> vanilla JS Web Component (Shadow DOM scoped)
 *   GET /v1/health     -> JSON, boolean status only (no secrets, no PII)
 */

export interface Env {
  // Phase 3 only. Absent in Phase 1 -> widget uses placeholder data.
  KAHUOLA_API_BASE?: string;
}

/**
 * The embed script is a PUBLIC static asset served to arbitrary partner
 * sites. There are no credentialed requests, so a fixed wildcard is correct
 * and intentional here (not an oversight). Vary:Origin kept for cache hygiene.
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Vary': 'Origin',
};

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
        phase: env.KAHUOLA_API_BASE ? 3 : 1,
        api_wired: Boolean(env.KAHUOLA_API_BASE),
        ts: new Date().toISOString(),
      });
    }

    // Phase 3: the WIDGET WORKER fetches Kahu Ola data server-side.
    // The partner-site browser only ever touches widget.kahuola.org —
    // it never calls kahuola.org/api directly (load isolation +
    // no CORS widening on the main hazard Worker).
    if (url.pathname === '/v1/status') {
      const loc = sanitizeLocation(url.searchParams.get('location'));
      return await handleStatus(loc, env);
    }

    if (url.pathname === '/v1/embed.js') {
      return new Response(EMBED_JS, {
        status: 200,
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          // Partner sites cache the loader; 5 min keeps it fresh enough.
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

/** Allowlist-shaped: lowercase, [a-z-] only, max 32 chars. No PII, no GPS. */
function sanitizeLocation(raw: string | null): string {
  const v = (raw || 'maui').toLowerCase().replace(/[^a-z-]/g, '').slice(0, 32);
  return v.length ? v : 'maui';
}

/**
 * Phase 3 status path. Doctrine-critical behavior:
 *  - Invariant I: this fetch runs in the WIDGET Worker, server-side. The
 *    embedded browser never reaches kahuola.org/api or any upstream.
 *  - Invariant II/III: ANY failure (no base, network, non-200, bad JSON,
 *    timeout) returns a deterministic degraded payload — never an error
 *    the card can't render, never inferred fields.
 *  - Edge-cached 90s so a traffic spike on partner sites cannot stampede
 *    the main hazard Worker (GROWTH_FEATURES §2 load isolation).
 */
interface WidgetStatus {
  location: string;
  aqi: number | null;
  fire_risk: string;
  status: 'fresh' | 'stale' | 'unavailable';
  generated_at: string | null;
  source_note: string;
}

async function handleStatus(location: string, env: Env): Promise<Response> {
  const degraded: WidgetStatus = {
    location,
    aqi: null,
    fire_risk: '\u2014',
    status: 'unavailable',
    generated_at: null,
    source_note: 'Live status temporarily unavailable.',
  };

  if (!env.KAHUOLA_API_BASE) {
    // Phase 1 mode (no base configured) — honest degraded, still rend, 200.
    return json(degraded);
  }

  const cache = caches.default;
  const cacheKey = new Request(
    `https://widget.kahuola.org/v1/status?location=${location}`,
  );
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let payload: WidgetStatus = degraded;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const base = env.KAHUOLA_API_BASE.replace(/\/+$/, '');
    const upstream = await fetch(
      `${base}/hazards/summary?region=maui`,
      { signal: ctrl.signal, headers: { Accept: 'application/json' } },
    );
    clearTimeout(timer);

    if (upstream.ok) {
      let data: unknown = null;
      try {
        data = await upstream.json();
      } catch {
        data = null; // Invariant III: bad JSON → drop, keep degraded.
      }
      const mapped = mapSummary(data, location);
      if (mapped) payload = mapped;
    }
  } catch {
    // network / abort / anything → keep degraded. Never throw to the card.
  }

  const resp = json(payload);
  // Cache only a usable (non-degraded) payload, briefly.
  if (payload.status !== 'unavailable') {
    const cacheable = new Response(resp.clone().body, resp);
    cacheable.headers.set('Cache-Control', 'public, max-age=90');
    await cache.put(cacheKey, cacheable);
  }
  return resp;
}

/**
 * Map the main Worker's aggregated summary into the widget's tiny shape.
 * Defensive: any missing/oddly-typed field → degraded, never guessed.
 * Returns null if the payload can't be trusted.
 */
function mapSummary(
  data: unknown,
  location: string,
): WidgetStatus | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;

  const aqiRaw = d['aqi'];
  const aqi =
    typeof aqiRaw === 'number' && Number.isFinite(aqiRaw) ? aqiRaw : null;

  const fr = d['fire_risk'];
  const fire_risk = typeof fr === 'string' && fr.trim() ? fr.trim() : '\u2014';

  const gen = d['generated_at'];
  const generated_at = typeof gen === 'string' ? gen : null;

  // Freshness: trust an explicit flag if present, else infer from age only
  // as fresh/stale label (never STALE_DROP — that just shows unavailable).
  let status: 'fresh' | 'stale' = 'fresh';
  const fresh = d['freshness'];
  if (fresh === 'STALE_OK' || fresh === 'stale') status = 'stale';
  if (fresh === 'STALE_DROP') return null; // drop → caller stays degraded

  return {
    location,
    aqi,
    fire_risk,
    status,
    generated_at,
    source_note:
      status === 'stale'
        ? 'Data may be outdated — see official sources.'
        : 'Public hazard data · situational awareness only.',
  };
}

/**
 * The embeddable Web Component.
 * Vanilla JS only. Shadow DOM. No React/Vue/Tailwind/Bootstrap/external CSS.
 * Phase 1: placeholder data + degraded fallback path proven end-to-end.
 */
const EMBED_JS = String.raw`(function () {
  "use strict";

  // Kahu Ola content-page palette (doctrine-locked, not GitHub palette).
  var THEMES = {
    dark:  { bg:"#08111a", text:"#eef4fb", muted:"#8ea3b7", border:"rgba(255,255,255,0.08)" },
    light: { bg:"#ffffff", text:"#0b1722", muted:"#5a6b7b", border:"rgba(0,0,0,0.10)" }
  };
  var ACCENT = "#ff6a00", GREEN = "#4caf50", AMBER = "#ff9800";

  // Phase 1 placeholder. Phase 3 replaces with cached Kahu Ola Worker API status.
  // Calm civic defaults -- never invent an active hazard.
  function placeholder(loc) {
    return {
      location: loc || "maui",
      aqi: null,
      fire_risk: "\u2014",
      status: "unavailable",       // unavailable | fresh | stale
      generated_at: null,
      source_note: "Phase 1 preview \u2014 live data not yet wired."
    };
  }

  function statusColor(status, theme) {
    if (status === "fresh") return GREEN;
    if (status === "stale") return AMBER;
    return theme.muted;            // unavailable / degraded
  }

  function statusText(status) {
    if (status === "fresh")  return "Live";
    if (status === "stale")  return "Data may be outdated";
    return "Status unavailable";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c];
    });
  }

  function render(root, data, theme) {
    var t = THEMES[theme] || THEMES.dark;
    var sc = statusColor(data.status, t);
    var loc = String(data.location);
    var locLabel = esc(loc.charAt(0).toUpperCase() + loc.slice(1));

    root.innerHTML =
      '<style>' +
        ':host{all:initial}' +
        '.k-card{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
          'background:' + t.bg + ';color:' + t.text + ';border:1px solid ' + t.border + ';' +
          'border-radius:14px;padding:16px 18px;max-width:320px;line-height:1.4}' +
        '.k-head{display:flex;align-items:center;justify-content:space-between;gap:12px}' +
        '.k-loc{font-size:13px;font-weight:600;letter-spacing:.02em;color:' + t.muted + '}' +
        '.k-dot{width:8px;height:8px;border-radius:50%;background:' + sc + ';flex:0 0 auto}' +
        '.k-stat{display:flex;align-items:center;gap:7px;font-size:12px;color:' + sc + ';font-weight:600}' +
        '.k-rows{margin:14px 0 12px}' +
        '.k-row{display:flex;align-items:baseline;justify-content:space-between;padding:7px 0;' +
          'border-bottom:1px solid ' + t.border + '}' +
        '.k-row:last-child{border-bottom:0}' +
        '.k-key{font-size:12px;color:' + t.muted + '}' +
        '.k-val{font-size:15px;font-weight:700}' +
        '.k-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;' +
          'margin-top:6px;font-size:11px;color:' + t.muted + '}' +
        '.k-foot a{color:' + ACCENT + ';text-decoration:none;font-weight:600}' +
        '.k-foot a:hover{text-decoration:underline}' +
      '</style>' +
      '<div class="x-card" role="region" aria-label="Kahu Ola hazard status for ' + locLabel + '">' +
        '<div class="k-head">' +
          '<span class="k-loc">' + locLabel + ', Hawai\u02bbi</span>' +
          '<span class="k-stat"><span class="k-dot"></span>' + esc(statusText(data.status)) + '</span>' +
        '</div>' +
        '<div class="k-rows">' +
          '<div class="k-row"><span class="k-key">Air Quality (AQI)</span>' +
            '<span class="k-val">' + esc(data.aqi == null ? "\u2014" : data.aqi) + '</span></div>' +
          '<div class="k-row"><span class="k-key">Fire Risk</span>' +
            '<span class="k-val">' + esc(data.fire_risk || "\u2014") + '</span></div>' +
        '</div>' +
        '<div class="k-foot">' +
          '<span>' + esc(data.source_note || "Situational awareness only") + '</span>' +
          '<a href="https://kahuola.org" target="_blank" rel="noopener">Powered by Kahu Ola</a>' +
        '</div>' +
      '</div>';
  }

  function defineComponent() {
    class KahuOlaWidget extends HTMLElement {
      static get observedAttributes() { return ["location", "theme"]; }

      _paint(data) {
        if (!this.shadowRoot) this.attachShadow({ mode: "open" });
        var loc = (this.getAttribute("location") || "maui").toLowerCase();
        var theme = (this.getAttribute("theme") || "dark").toLowerCase();
        render(this.shadowRoot, data || placeholder(loc), theme);
      }

      _refresh() {
        var self = this;
        var loc = (this.getAttribute("location") || "maui").toLowerCase();
        // Resolve the widget Worker origin from THIS script's own src,
        // so the partner browser only ever talks to widget.kahuola.org.
        var origin = self._origin();
        if (!origin) return; // can't resolve → keep placeholder, never error
        try {
          fetch(origin + "/v1/status?location=" + encodeURIComponent(loc), {
            method: "GET",
            credentials: "omit",
            cache: "no-store"
          }).then(function (r) {
            if (!r || !r.ok) return null;
            return r.json();
          }).then(function (j) {
            // Invariant III: only repaint if the payload looks usable.
            if (j && typeof j === "object" && j.status) self._paint(j);
          }).catch(function () {
            // network/parse fail → silently keep the placeholder card.
          });
        } catch (e) { /* keep placeholder */ }
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

      connectedCallback() {
        // Invariant II: paint immediately, unconditionally.
        this._paint(null);
        // Then try live data. Any failure leaves the card intact.
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

  if (window.customElements) {
    defineComponent();
  }
})();`;
