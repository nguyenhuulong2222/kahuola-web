// test-sat0a6.mjs — SAT-0a-6 acceptance: HMS smoke polygons must TRULY
// intersect the Hawaiʻi box, not merely overlap it by bounding box.
// Fixtures: the real NOAA HMS smoke KMLs for 2023-08-07 … 2023-08-11 (Maui
// fires on 08-08/09), gzipped under worker/fixtures/hms/. No network.
//
// Run: node worker/test-sat0a6.mjs
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

// ── build ────────────────────────────────────────────────────────────────────
const work = mkdtempSync(join(tmpdir(), 'kahuola-sat0a6-'));
cpSync(join(here, 'src'), join(work, 'src'), { recursive: true });
writeFileSync(
  join(work, 'src', 'index.ts'),
  readFileSync(join(work, 'src', 'index.ts'), 'utf8') +
    '\nexport { handleSmoke, parseHmsKml, ringIntersectsBox, REGION_BBOXES };\n',
);
const { build } = require(join(here, 'node_modules', 'esbuild', 'lib', 'main.js'));
await build({
  entryPoints: [join(work, 'src', 'index.ts')],
  bundle: true, format: 'esm', platform: 'neutral',
  outfile: join(work, 'bundle.mjs'), logLevel: 'error',
});

// ── Workers runtime stubs ────────────────────────────────────────────────────
const cacheStore = new Map();
globalThis.caches = {
  default: {
    async match(req) { const hit = cacheStore.get(typeof req === 'string' ? req : req.url); return hit ? hit.clone() : undefined; },
    async put(req, res) { cacheStore.set(typeof req === 'string' ? req : req.url, res); },
  },
};
console.warn = () => {};

const DAYS = ['20230807', '20230808', '20230809', '20230810', '20230811'];
const kml = Object.fromEntries(DAYS.map(d => [d, gunzipSync(readFileSync(join(here, 'fixtures', 'hms', `hms_smoke${d}.kml.gz`))).toString('utf8')]));
globalThis.fetch = async (url) => {
  const m = String(url).match(/hms_smoke(\d{8})\.kml/);
  if (m && kml[m[1]]) return new Response(kml[m[1]], { status: 200 });
  return new Response('Not Found', { status: 404 });
};

const mod = await import(pathToFileURL(join(work, 'bundle.mjs')).href);
const [W, S, E, N] = mod.REGION_BBOXES.hawaii;
const bboxOnly = (ring) => {   // the pre-SAT-0a-6 rule, for the before/after table
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (const p of ring) { a = Math.min(a, p[0]); b = Math.max(b, p[0]); c = Math.min(c, p[1]); d = Math.max(d, p[1]); }
  return b >= W && a <= E && d >= S && c <= N;
};

// ── 1. Geometry unit cases ──────────────────────────────────────────────────
const box = [W, S, E, N];
const sq = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
ok('vertex inside the box → intersects', mod.ringIntersectsBox(sq(-157.9, 21.3, -157.8, 21.4), ...box));
ok('box wholly inside a huge polygon → intersects', mod.ringIntersectsBox(sq(-170, 10, -140, 30), ...box));
ok('edge crosses the box with no vertex inside → intersects',
   mod.ringIntersectsBox([[-163, 20.0], [-150, 20.0], [-150, 20.2], [-163, 20.2], [-163, 20.0]], ...box));
ok('far away (CONUS) → does not intersect', mod.ringIntersectsBox(sq(-120, 35, -115, 40), ...box) === false);
// An L-shaped continental polygon whose bounding box covers Hawaiʻi but whose
// arms pass north and east of it — the 2023-08-07 failure shape.
const L = [[-164, 25], [-30, 25], [-30, 75], [-150, 75], [-150, 17], [-140, 17], [-140, 24], [-164, 24], [-164, 25]];
ok('L-shape: bbox covers Hawaiʻi, polygon does not → no intersection (old rule said yes)',
   bboxOnly(L) === true && mod.ringIntersectsBox(L, ...box) === false);

// ── 2. Real HMS files, end to end through handleSmoke ───────────────────────
const table = [];
for (const d of DAYS) {
  cacheStore.clear();
  const noon = Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T20:00:00Z`);
  Date.now = () => noon;
  const RealDate = globalThis.Date;
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [noon])); } static now() { return noon; } };
  const res = await mod.handleSmoke(new URL('https://kahuola.org/api/hazards/smoke?region=hawaii'), {});
  globalThis.Date = RealDate;
  const j = JSON.parse(await res.text());
  const parsed = mod.parseHmsKml(kml[d]);
  const before = parsed.features.filter(p => bboxOnly(p.ring)).length;
  const after = parsed.features.filter(p => mod.ringIntersectsBox(p.ring, ...box)).length;
  table.push({ d, placemarks: parsed.total_placemarks, before, after, status: j?.summary?.status, signals: Array.isArray(j?.signals) ? j.signals.length : null, hms_date: j?.summary?.hms_date ?? j?.hms_date });
}
console.log('\n  date      placemarks  bbox-only  true-intersect  status    signals  hms_date');
for (const t of table) console.log(`  ${t.d}  ${String(t.placemarks).padStart(10)}  ${String(t.before).padStart(9)}  ${String(t.after).padStart(14)}  ${String(t.status).padEnd(8)}  ${String(t.signals).padStart(7)}  ${t.hms_date}`);
console.log('');
const by = Object.fromEntries(table.map(t => [t.d, t]));
for (const d of ['20230807', '20230810', '20230811']) {
  ok(`${d}: status "none" (bbox-only rule had ${by[d].before} false hit(s))`, by[d].status === 'none' && by[d].signals === 0);
}
for (const d of ['20230808', '20230809']) {
  ok(`${d} (Maui fires): status "detected" with ${by[d].after} polygon(s)`, by[d].status === 'detected' && by[d].signals === by[d].after && by[d].after > 0);
}
ok('every file served from "today" (hms_date = file date)', table.every(t => t.hms_date === `${t.d.slice(0, 4)}-${t.d.slice(4, 6)}-${t.d.slice(6, 8)}`));
ok('the true test never keeps a polygon the bbox test rejected', table.every(t => t.after <= t.before));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
