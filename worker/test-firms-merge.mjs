// test-firms-merge.mjs — acceptance for the multi-dataset FIRMS hotspots path.
// Proves the merge/dedupe/partial-failure/total-failure behaviour of
// handleFirmsHotspots against a stubbed upstream. No network, no deploy.
//
// Run: node worker/test-firms-merge.mjs
//
// The Worker source is TypeScript with module-private helpers, so this bundles
// src/index.ts with esbuild into a temp dir, appending a test-only export line.
// Nothing under worker/src is modified.
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('PASS — ' + name)) : (fail++, console.log('FAIL — ' + name)); };

// ── build ────────────────────────────────────────────────────────────────────
const work = mkdtempSync(join(tmpdir(), 'kahuola-firms-'));
cpSync(join(here, 'src'), join(work, 'src'), { recursive: true });
writeFileSync(
  join(work, 'src', 'index.ts'),
  readFileSync(join(work, 'src', 'index.ts'), 'utf8') +
    '\nexport { handleFirmsHotspots, dedupeFirmsFeatures, firmsCacheKey,' +
    ' FIRMS_PRIMARY_DATASETS, FIRMS_PRIMARY_TOKEN, REGION_BBOXES, SUMMARY_FIRMS_KEY };\n',
);
const { build } = require(join(here, 'node_modules', 'esbuild', 'lib', 'main.js'));
await build({
  entryPoints: [join(work, 'src', 'index.ts')],
  bundle: true, format: 'esm', platform: 'neutral',
  outfile: join(work, 'bundle.mjs'), logLevel: 'error',
});

// ── Workers runtime stubs ────────────────────────────────────────────────────
const cacheStore = new Map();
let putCount = 0;
globalThis.caches = {
  default: {
    async match(req) {
      const hit = cacheStore.get(typeof req === 'string' ? req : req.url);
      return hit ? hit.clone() : undefined;
    },
    async put(req, res) {
      putCount++;
      cacheStore.set(typeof req === 'string' ? req : req.url, res);
    },
  },
};

// CSV rows are (lat, lon, acq_date, acq_time) tuples; the header is the real
// VIIRS NRT schema so the parser exercises its real column lookups.
const HEADER = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';
const row = (lat, lon, date, time, sat) =>
  `${lat},${lon},330.1,0.4,0.36,${date},${time},${sat},VIIRS,n,2.0NRT,290.0,1.5,D`;
const csv = (rows) => [HEADER, ...rows].join('\n') + '\n';

// upstreams: dataset id -> { status, body } | 'throw'
let upstreams = {};
const requested = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  requested.push(u);
  const ds = u.split('/api/area/csv/')[1].split('/')[1];
  const cfg = upstreams[ds];
  if (!cfg) return new Response('not found', { status: 404 });
  if (cfg === 'throw') throw new Error('network down');
  return new Response(cfg.body ?? '', { status: cfg.status ?? 200 });
};

const mod = await import(pathToFileURL(join(work, 'bundle.mjs')).href);
const ENV = { NASA_FIRMS_MAP_KEY: 'TEST_MAP_KEY' };
const HI = 'https://kahuola.org/api/firms/hotspots?scope=hawaii&days=1';

const call = async (href = HI) => {
  const res = await mod.handleFirmsHotspots(new URL(href), ENV, {});
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
  return { res, json };
};
const reset = () => { cacheStore.clear(); putCount = 0; requested.length = 0; upstreams = {}; };

// ── 0. The primaries are two live NOAA satellites, no SNPP ──────────────────
ok('FIRMS_PRIMARY_DATASETS = [NOAA-20, NOAA-21]',
   JSON.stringify([...mod.FIRMS_PRIMARY_DATASETS]) === JSON.stringify(['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT']));
ok('SUMMARY_FIRMS_KEY carries the merged token',
   mod.SUMMARY_FIRMS_KEY.includes(mod.FIRMS_PRIMARY_TOKEN));

// ── 1. Both datasets reachable → merged, deduped, healthy ───────────────────
reset();
upstreams = {
  VIIRS_NOAA20_NRT: { body: csv([
    row(20.8783, -156.6825, '2026-08-28', '1012', 'N20'),   // shared with N21
    row(19.4210, -155.2870, '2026-08-28', '1012', 'N20'),   // Kīlauea, N20 only
  ]) },
  VIIRS_NOAA21_NRT: { body: csv([
    row(20.8783, -156.6825, '2026-08-28', '1012', 'N21'),   // exact duplicate
    row(21.3100, -157.8600, '2026-08-28', '1105', 'N21'),   // Oʻahu, N21 only
  ]) },
  MODIS_NRT: { body: csv([row(20.8783, -156.6825, '2026-08-28', '1015', 'Aqua')]) },
};
let r = await call();
ok('both reachable → HTTP 200', r.res.status === 200);
ok('both reachable → health ok', r.json.properties.health === 'ok');
ok('both reachable → datasets_used lists both',
   JSON.stringify(r.json.properties.datasets_used) === JSON.stringify(['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT']));
ok('4 upstream rows → 3 features (exact duplicate collapsed)', r.json.features.length === 3);
ok('returnedRecords agrees with features.length',
   r.json.properties.returnedRecords === r.json.features.length);
ok('dedupe kept the FIRST dataset’s copy of the shared detection',
   r.json.features.find(f => f.properties.satellite === 'N20' && f.geometry.coordinates[0] === -156.6825) !== undefined &&
   r.json.features.filter(f => f.geometry.coordinates[0] === -156.6825).length === 1);
ok('every feature is attributed to the dataset that served it',
   r.json.features.every(f => mod.FIRMS_PRIMARY_DATASETS.includes(f.properties.dataset)));
ok('MODIS xref still fires on the merged default (detection_confidence high)',
   r.json.features.some(f => f.properties.detection_confidence === 'high'));
ok('no SNPP dataset was requested upstream', !requested.some(u => u.includes('SNPP')));
ok('successful merge is written to cache', putCount === 1);
ok('cache key is the merged-token key', [...cacheStore.keys()][0].includes(mod.FIRMS_PRIMARY_TOKEN));

// ── 2. Merged count >= what a single dataset returns for the same window ────
reset();
const singleBody = csv([
  row(19.4210, -155.2870, '2026-08-28', '1012', 'SNPP'),
  row(19.4300, -155.2900, '2026-08-28', '1012', 'SNPP'),
  row(19.4400, -155.3000, '2026-08-28', '1012', 'SNPP'),
]);
upstreams = { VIIRS_SNPP_NRT: { body: singleBody }, MODIS_NRT: { body: '' } };
const single = await call(HI + '&dataset=VIIRS_SNPP_NRT');
reset();
upstreams = {
  // NOAA-20 sees everything the single dataset saw...
  VIIRS_NOAA20_NRT: { body: singleBody },
  // ...and NOAA-21 adds one the other missed.
  VIIRS_NOAA21_NRT: { body: csv([
    row(19.4210, -155.2870, '2026-08-28', '1012', 'N21'),
    row(20.7000, -156.4000, '2026-08-28', '1058', 'N21'),
  ]) },
  MODIS_NRT: { body: '' },
};
const merged = await call();
ok('merged count >= single-dataset count for the same bbox/window',
   merged.json.features.length >= single.json.features.length);
ok('merged count is strictly higher when a satellite sees a fire the other missed',
   merged.json.features.length === single.json.features.length + 1);

// ── 3. Dedupe is strict: a different overpass minute is a different detection ─
reset();
upstreams = {
  VIIRS_NOAA20_NRT: { body: csv([row(20.8783, -156.6825, '2026-08-28', '1012', 'N20')]) },
  VIIRS_NOAA21_NRT: { body: csv([row(20.8783, -156.6825, '2026-08-28', '1105', 'N21')]) },
  MODIS_NRT: { body: '' },
};
r = await call();
ok('same pixel, different acq_time → kept as two observations', r.json.features.length === 2);

// FIRMS publishes coordinates at 5 dp. The key rounds to 4 dp (~11 m), so two
// datasets reporting the same pixel with sub-11 m jitter collapse; the 5th
// decimal alone is not a new fire.
reset();
upstreams = {
  VIIRS_NOAA20_NRT: { body: csv([row(20.87831, -156.68252, '2026-08-28', '1012', 'N20')]) },
  VIIRS_NOAA21_NRT: { body: csv([row(20.87834, -156.68254, '2026-08-28', '1012', 'N21')]) },
  MODIS_NRT: { body: '' },
};
r = await call();
ok('coordinates agreeing to 4 dp at the same minute → collapsed', r.json.features.length === 1);

// The flip side, stated so the tolerance is not mistaken for a spatial cluster:
// this is a ROUNDING key, so a pair straddling a 4 dp boundary stays two rows.
// Safe by design — over-collapsing would erase a real detection, this cannot.
reset();
upstreams = {
  VIIRS_NOAA20_NRT: { body: csv([row(20.87831, -156.68252, '2026-08-28', '1012', 'N20')]) },
  VIIRS_NOAA21_NRT: { body: csv([row(20.87839, -156.68252, '2026-08-28', '1012', 'N21')]) },
  MODIS_NRT: { body: '' },
};
r = await call();
ok('a 4 dp rounding boundary keeps both rows (never over-collapses)', r.json.features.length === 2);

// ── 4. One dataset failing must not drop the other ─────────────────────────
for (const [label, broken] of [['HTTP 500', { status: 500, body: 'boom' }], ['network throw', 'throw']]) {
  reset();
  upstreams = {
    VIIRS_NOAA20_NRT: broken,
    VIIRS_NOAA21_NRT: { body: csv([
      row(21.3100, -157.8600, '2026-08-28', '1105', 'N21'),
      row(20.7000, -156.4000, '2026-08-28', '1105', 'N21'),
    ]) },
    MODIS_NRT: { body: '' },
  };
  r = await call();
  ok(`one dataset down (${label}) → still HTTP 200`, r.res.status === 200);
  ok(`one dataset down (${label}) → survivor's detections still returned`, r.json.features.length === 2);
  ok(`one dataset down (${label}) → health "partial"`, r.json.properties.health === 'partial');
  ok(`one dataset down (${label}) → datasets_used names only the survivor`,
     JSON.stringify(r.json.properties.datasets_used) === JSON.stringify(['VIIRS_NOAA21_NRT']));
  ok(`one dataset down (${label}) → partial result is still cached`, putCount === 1);
}

// ── 5. Both failing → empty layer, honest envelope, NOT cached ─────────────
reset();
upstreams = { VIIRS_NOAA20_NRT: 'throw', VIIRS_NOAA21_NRT: { status: 503, body: '' }, MODIS_NRT: { body: '' } };
r = await call();
ok('both down → HTTP 200 (UI renders its normal empty state)', r.res.status === 200);
ok('both down → features []', Array.isArray(r.json.features) && r.json.features.length === 0);
ok('both down → valid FeatureCollection', r.json.type === 'FeatureCollection');
ok('both down → health "degraded", not a silent zero', r.json.properties.health === 'degraded');
ok('both down → datasets_used empty', r.json.properties.datasets_used.length === 0);
ok('both down → NOTHING cached (summary stays on miss, never reports "none")', putCount === 0);
ok('both down → next request retries upstream instead of serving the hole',
   (await mod.caches?.default?.match?.(new Request(mod.SUMMARY_FIRMS_KEY)).catch(() => undefined)) === undefined);

// ── 6. Cache-key isolation + input validation ──────────────────────────────
reset();
upstreams = { VIIRS_NOAA20_NRT: { body: csv([]) }, VIIRS_NOAA21_NRT: { body: csv([]) },
              VIIRS_NOAA21_NRT_PROBE: { body: csv([]) }, MODIS_NRT: { body: '' } };
await call();
const mergedKey = [...cacheStore.keys()][0];
reset();
upstreams = { VIIRS_NOAA21_NRT: { body: csv([row(21.31, -157.86, '2026-08-28', '1105', 'N21')]) } };
await call(HI + '&dataset=VIIRS_NOAA21_NRT');
const probeKey = [...cacheStore.keys()][0];
ok('an explicit ?dataset= probe cannot overwrite the merged snapshot', mergedKey !== probeKey);
ok('a single-dataset probe does not fire the MODIS xref', !requested.some(u => u.includes('MODIS')));

reset();
const bad = await call(HI + '&dataset=../../etc/passwd');
ok('malformed ?dataset= is rejected, never forwarded upstream',
   bad.res.status === 400 && requested.length === 0);

// ── 7. Parse failures drop rows, never invent them (Invariant III) ─────────
reset();
upstreams = {
  VIIRS_NOAA20_NRT: { body: csv([
    row('not-a-number', -156.68, '2026-08-28', '1012', 'N20'),
    row(20.8783, -156.6825, '2026-08-28', '1012', 'N20'),
  ]) },
  VIIRS_NOAA21_NRT: { body: '<html>upstream error page</html>' },
  MODIS_NRT: { body: '' },
};
r = await call();
ok('unparseable row is dropped, valid sibling kept', r.json.features.length === 1);
ok('an HTML body parses to zero features, not to garbage',
   r.json.properties.datasets_used.includes('VIIRS_NOAA21_NRT') && r.json.features.length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
