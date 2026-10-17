// test-sat0c-hotfix.mjs — /api/ocean/water-quality must never say "clear"
// unless the Hawaiʻi DOH feed actually answered. No network.
//
// Fixture: the real DOH open-events response of 2026-10-17 (13 open
// advisories), gzipped under worker/fixtures/doh/. On that day the DOH host's
// TLS certificate had expired, the Worker's fetch failed, and production said
// "clear" while all 13 were open.
//
// Run: node worker/test-sat0c-hotfix.mjs
import { readFileSync, mkdtempSync, cpSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('PASS — ' + name)) : (fail++, console.log('FAIL — ' + name)); };

const work = mkdtempSync(join(tmpdir(), 'kahuola-sat0c-'));
cpSync(join(here, 'src'), join(work, 'src'), { recursive: true });
const { build } = require(join(here, 'node_modules', 'esbuild', 'lib', 'main.js'));
await build({ entryPoints: [join(work, 'src', 'ocean.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: join(work, 'ocean.mjs'), logLevel: 'error' });

const cacheStore = new Map();
globalThis.caches = {
  default: {
    async match(req) { const hit = cacheStore.get(typeof req === 'string' ? req : req.url); return hit ? hit.clone() : undefined; },
    async put(req, res) { cacheStore.set(typeof req === 'string' ? req : req.url, res); },
  },
};
console.warn = () => {};
console.log = ((orig) => (...a) => { if (typeof a[0] === 'string' && /^(PASS|FAIL|\n)/.test(a[0])) orig(...a); })(console.log);

const mod = await import(pathToFileURL(join(work, 'ocean.mjs')).href);
const DOH_OPEN = JSON.parse(gunzipSync(readFileSync(join(here, 'fixtures', 'doh', 'doh_events_open_20261017.json.gz'))).toString('utf8'));
const NWS_QUIET = { type: 'FeatureCollection', features: [] };
const TLS_ERR = () => Promise.reject(new TypeError('fetch failed: certificate has expired'));

let doh, nws;
const deps = {
  cachedJsonFetch: (url) => (url.includes('eha-cloud.doh.hawaii.gov') ? doh() : nws()),
  cachedTextFetch: async () => '',
  fetchNwsAlerts: async () => NWS_QUIET,
  jsonResp: (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }),
};
const call = async () => {
  const r = await mod.handleOceanWaterQuality(new URL('https://kahuola.org/api/ocean/water-quality'), {}, deps);
  return { r, j: JSON.parse(await r.text()) };
};
const dropRouteCache = () => { for (const k of [...cacheStore.keys()]) if (k.includes('ocean-route')) cacheStore.delete(k); };
const snapshotKeys = () => [...cacheStore.keys()].filter(k => !k.includes('ocean-route'));
const VIEWER = 'https://eha-cloud.doh.hawaii.gov/cwb/#!/viewer';
const FALLBACK = 'https://health.hawaii.gov/cwb/';

ok('fixture has 13 open DOH advisories', DOH_OPEN.list.length === 13 && DOH_OPEN.list.every(e => e.status === 'Open'));

// ── 1. DOH TLS failure, NWS ok → partial, never clear ───────────────────────
cacheStore.clear(); doh = TLS_ERR; nws = async () => NWS_QUIET;
let { r, j } = await call();
ok('1. DOH TLS fail → status "partial" (was "clear")', j.status === 'partial');
ok('1. source_health.doh "unavailable", nws ok', j.source_health.doh === 'unavailable' && j.source_health.nws_flash_flood_history === 'ok');
ok('1. doh_advisory_count null, not 0', j.doh_advisory_count === null);
ok('1. official_source_url is the reachable CWB page, not the expired-cert viewer', j.official_source_url === FALLBACK);
ok('1. note says it is not an all-clear', /not an all-clear/.test(j.note));
ok('1. cached only 5 min, so DOH recovery shows quickly', /max-age=300/.test(r.headers.get('Cache-Control') || ''));
ok('1. no fallback snapshot written from a DOH-down answer', snapshotKeys().length === 0);

// ── 2. DOH ok with 13 open → active ─────────────────────────────────────────
cacheStore.clear(); doh = async () => DOH_OPEN; nws = async () => NWS_QUIET;
({ r, j } = await call());
ok('2. DOH ok, 13 open → status "active", doh_advisory_count 13', j.status === 'active' && j.doh_advisory_count === 13);
ok('2. source_health.doh ok, link is the DOH viewer', j.source_health.doh === 'ok' && j.official_source_url === VIEWER);
ok('2. snapshot written', snapshotKeys().length === 1);

// ── 3. DOH ok with 0 open → genuine clear ───────────────────────────────────
cacheStore.clear(); doh = async () => ({ page: 0, totalResultsCount: 0, list: [] }); nws = async () => NWS_QUIET;
({ j } = await call());
ok('3. DOH ok, 0 open → status "clear", doh_advisory_count 0, doh ok',
   j.status === 'clear' && j.doh_advisory_count === 0 && j.source_health.doh === 'ok');

// ── 4. NWS fails too ────────────────────────────────────────────────────────
cacheStore.clear(); doh = TLS_ERR; nws = TLS_ERR;
({ j } = await call());
ok('4a. both down, no snapshot → status "unavailable", STALE_DROP, no signals',
   j.status === 'unavailable' && j.freshness === 'STALE_DROP' && j.signals.length === 0);

// Good run → DOH fails → both fail: the fallback must still be the good list.
cacheStore.clear();
doh = async () => DOH_OPEN; nws = async () => NWS_QUIET; await call(); dropRouteCache();
doh = TLS_ERR; await call(); dropRouteCache();
nws = TLS_ERR;
({ j } = await call());
ok('4b. good → DOH-down → both-down serves the last GOOD snapshot (13), not the partial one',
   j.status === 'stale_snapshot' && j.signals.length === 13 && j.source_health.doh === 'ok');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
