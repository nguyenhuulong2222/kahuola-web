/**
 * Kahu Ola — Maui Aggregated Summary Endpoint (handler module)
 * Phase 3 wiring. Lives in the MAIN Worker (worker/), NOT the widget Worker.
 *
 * Consumed by:
 *   - kahuola-widget  (server-side, via widget Worker /v1/status)
 *   - generate_insights.js (server-side, via KAHUOLA_INSIGHTS_URL)
 *
 * Both consumers expect this exact small contract so neither has to know
 * anything about upstream sources (Invariant I — single source of truth).
 *
 * RESPONSE CONTRACT (stable):
 * {
 *   "region": "maui",
 *   "generated_at": "ISO8601",
 *   "freshness": "FRESH" | "STALE_OK" | "STALE_DROP",
 *   "source_fetched_at": "ISO8601" | null,
 *   "aqi": number | null,                 // representative Maui AQI
 *   "fire_risk": "Low" | "Moderate" | "High" | "—",
 *   "air_quality": { "wailuku": number|null, "lahaina": number|null },
 *   "fires": [ { "location": string, "confidence": string } ],
 *   "weather": { ...optional context... }
 * }
 *
 * DOCTRINE:
 *  - Layer A owns truth: every number here comes from already-validated
 *    cached signals in the main Worker. This handler does NOT call upstream
 *    APIs itself — it reads the Worker's existing validated snapshot.
 *  - Invariant III: if the snapshot is missing/invalid, return a well-formed
 *    response with nulls + freshness STALE_DROP. Never infer, never 500 the
 *    consumers (they must still render / fall back deterministically).
 *  - No PII. No location from caller is used beyond a fixed region literal.
 *
 * INTEGRATION (in worker/ router, e.g. routes/hazards.ts or index.ts):
 *
 *   import { handleMauiSummary } from './handlers/maui-summary';
 *   if (url.pathname === '/api/hazards/summary') {
 *     return handleMauiSummary(request, env, ctx);
 *   }
 *
 * Replace readValidatedSnapshot() with your real cache/KV/snapshot read.
 * The signature is intentionally the only thing you need to wire.
 */

export interface SummaryEnv {
  // Your existing snapshot store. Adjust to match the main Worker.
  // e.g. KV namespace, Cache API, or an internal aggregator function.
  KAHUOLA_SNAPSHOT?: KVNamespace;
}

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

/**
 * Read the main Worker's already-validated hazard snapshot for Maui.
 * STUB — replace with the real read used elsewhere in worker/.
 * Must return parsed object or null. Must NOT throw.
 */
async function readValidatedSnapshot(
  env: SummaryEnv,
): Promise<Record<string, unknown> | null> {
  try {
    if (!env.KAHUOLA_SNAPSHOT) return null;
    const raw = await env.KAHUOLA_SNAPSHOT.get('snapshot:maui');
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null; // Invariant III: drop, never infer.
  }
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Map an already-validated snapshot into the stable summary contract. */
function mapSnapshot(snap: Record<string, unknown>): MauiSummary {
  const out = emptySummary('FRESH');

  const aq = (snap['air_quality'] as Record<string, unknown>) || {};
  out.air_quality.wailuku = num(aq['wailuku']);
  out.air_quality.lahaina = num(aq['lahaina']);
  // Representative AQI = worst of the two known towns, else null.
  const vals = [out.air_quality.wailuku, out.air_quality.lahaina].filter(
    (x): x is number => x != null,
  );
  out.aqi = vals.length ? Math.max(...vals) : null;

  const fires = Array.isArray(snap['fires']) ? (snap['fires'] as unknown[]) : [];
  out.fires = fires
    .map((f) => {
      const o = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
      const loc = o['location'] ?? o['name'];
      return {
        location: typeof loc === 'string' && loc.trim() ? loc.trim() : 'unknown',
        confidence:
          typeof o['confidence'] === 'string' ? (o['confidence'] as string) : 'n/a',
      };
    })
    .slice(0, 20);

  // Fire risk: derive a calm label from snapshot signals only.
  // Never escalate beyond what the validated data supports.
  const rf = snap['red_flag_warning'] === true;
  out.fire_risk = rf ? 'High' : out.fires.length > 0 ? 'Moderate' : 'Low';

  if (snap['weather'] && typeof snap['weather'] === 'object') {
    out.weather = snap['weather'] as Record<string, unknown>;
  }

  const sf = snap['source_fetched_at'] ?? snap['fetched_at'];
  out.source_fetched_at = typeof sf === 'string' ? sf : null;

  const fr = snap['freshness'];
  if (fr === 'STALE_OK' || fr === 'STALE_DROP' || fr === 'FRESH') {
    out.freshness = fr;
  }
  return out;
}

export async function handleMauiSummary(
  request: Request,
  env: SummaryEnv,
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

  const snap = await readValidatedSnapshot(env);

  // Invariant III + II: no/invalid snapshot → well-formed STALE_DROP body,
  // HTTP 200 so consumers degrade deterministically rather than erroring.
  const body = snap ? mapSnapshot(snap) : emptySummary('STALE_DROP');

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=120',
      ...CORS,
    },
  });
}
