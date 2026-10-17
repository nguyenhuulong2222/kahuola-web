// test-sat1a.mjs — SAT-1a: /api/hazards/smoke?region=usa (CONUS + Alaska from
// the same NOAA HMS file), with the same status contract as Hawaiʻi
// (detected / none / unavailable, hms_date, hms_day) and its own cache key.
// Fixtures: heavy day (real 2023-08-07 file, 122 placemarks), none, unavailable,
// previous-day. No network.
//
// Run: node worker/test-sat1a.mjs
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('PASS — ' + name)) : (fail++, console.log('FAIL — ' + name)); };

const work = mkdtempSync(join(tmpdir(), 'kahuola-sat1a-'));
cpSync(join(here, 'src'), join(work, 'src'), { recursive: true });
writeFileSync(join(work, 'src', 'index.ts'),
  readFileSync(join(work, 'src', 'index.ts'), 'utf8') + '\nexport { handleSmoke, SUMMARY_SMOKE_KEY, SUMMARY_SMOKE_STATUS_KEY };\n');
const { build } = require(join(here, 'node_modules', 'esbuild', 'lib', 'main.js'));
await build({ entryPoints: [join(work, 'src', 'index.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: join(work, 'bundle.mjs'), logLevel: 'error' });

const store = new Map();
globalThis.caches = { default: {
  async match(req) { const h = store.get(typeof req === 'string' ? req : req.url); return h ? h.clone() : undefined; },
  async put(req, res) { store.set(typeof req === 'string' ? req : req.url, res); },
} };
console.warn = () => {};
const HEAVY = gunzipSync(readFileSync(join(here, 'fixtures', 'hms', 'hms_smoke20230807.kml.gz'))).toString('utf8');
// A valid HMS-shaped KML whose only polygon is over the Atlantic, east of CONUS.
const ATLANTIC_ONLY = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Smoke (Light)</name><description>Density: Light</description><Polygon><outerBoundaryIs><LinearRing><coordinates>-50,35,0 -45,35,0 -45,40,0 -50,40,0 -50,35,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;

let files = {};
globalThis.fetch = async (u) => { const m = String(u).match(/hms_smoke(\d{8})/); return m && files[m[1]] ? new Response(files[m[1]]) : new Response('Not Found', { status: 404 }); };
const mod = await import(pathToFileURL(join(work, 'bundle.mjs')).href);
const RealDate = Date;
const at = (iso) => { const t = RealDate.parse(iso); globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [t])); } static now() { return t; } }; };
const smoke = async (region) => {
  const res = await mod.handleSmoke(new URL(`https://kahuola.org/api/hazards/smoke?region=${region}`), {});
  const text = await res.text();
  return { j: JSON.parse(text), bytes: text.length };
};
const validRing = (r) => r.length >= 4 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] && r.every(p => p.length === 2 && p.every(Number.isFinite));

// ── heavy day: 2023-08-07 ───────────────────────────────────────────────────
store.clear(); files = { '20230807': HEAVY }; at('2023-08-07T20:00:00Z');
let { j, bytes } = await smoke('usa');
ok('heavy: usa status "detected" with 80 polygons', j.summary.status === 'detected' && j.signals.length === 80);
ok('heavy: region echoed as "usa"', j.region === 'usa');
ok('heavy: hms_date 2023-08-07, hms_day today', j.hms_date === '2023-08-07' && j.hms_day === 'today');
ok('heavy: every simplified ring is a valid closed polygon', j.signals.every(f => validRing(f.geometry.coordinates[0])));
ok('heavy: density carried (light/medium/heavy)', j.signals.every(f => ['light', 'medium', 'heavy'].includes(f.properties.density)) && new Set(j.signals.map(f => f.properties.density)).size >= 2);
ok(`heavy: payload ≤ 70 kB after simplification (${bytes} B)`, bytes <= 70000);
ok('heavy: message says "over the U.S."', /over the U\.S\./.test(j.summary.message));
ok('heavy: written to the usa cache key only', store.has('https://kahuola.org/cache/smoke-usa-v1') && !store.has(mod.SUMMARY_SMOKE_KEY));
let h = await smoke('hawaii');
ok('heavy: same file for Hawaiʻi is "none" (SAT-0a-6 true intersection), own key', h.j.summary.status === 'none' && h.j.region === 'hawaii' && store.has(mod.SUMMARY_SMOKE_KEY));
let other = await smoke('maui');
ok('unknown region falls back to Hawaiʻi and says so', other.j.region === 'hawaii');

// ── none: valid file, nothing over CONUS/Alaska ─────────────────────────────
store.clear(); files = { '20260101': ATLANTIC_ONLY }; at('2026-01-01T20:00:00Z');
({ j } = await smoke('usa'));
ok('none: status "none", 0 signals, hms_day today', j.summary.status === 'none' && j.signals.length === 0 && j.hms_day === 'today');
ok('none: message does not rule out smoke', /does not rule out smoke/.test(j.summary.message) && /over the U\.S\./.test(j.summary.message));

// ── unavailable: today and yesterday both missing ───────────────────────────
store.clear(); files = {}; at('2026-01-01T20:00:00Z');
({ j } = await smoke('usa'));
ok('unavailable: status "unavailable", error upstream_unavailable', j.summary.status === 'unavailable' && j.error === 'upstream_unavailable');
ok('unavailable: a USA outage does NOT write the Hawaiʻi summary status key', !store.has(mod.SUMMARY_SMOKE_STATUS_KEY));
({ j } = await smoke('hawaii'));
ok('unavailable: a Hawaiʻi outage still writes it (unchanged)', j.summary.status === 'unavailable' && store.has(mod.SUMMARY_SMOKE_STATUS_KEY));

// ── previous day: today 404, yesterday = heavy file ─────────────────────────
store.clear(); files = { '20230807': HEAVY }; at('2023-08-08T03:00:00Z');
({ j } = await smoke('usa'));
ok('previous day: detected from yesterday, hms_day "previous", hms_date 2023-08-07',
   j.summary.status === 'detected' && j.hms_day === 'previous' && j.hms_date === '2023-08-07');
ok('previous day: note names the previous UTC day', /previous UTC day \(2023-08-07\)/.test(j.note || j.properties?.note || JSON.stringify(j)));

globalThis.Date = RealDate;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
