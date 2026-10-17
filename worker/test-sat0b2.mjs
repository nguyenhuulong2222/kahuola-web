// test-sat0b2.mjs — SAT-0b-2 acceptance: cross-satellite fire locations
// (seen_by / location_id / location_primary) and the summary fire block
// (health, location counts, newest acquisition, null + "unavailable" instead
// of 0). No network, no deploy. Same build approach as test-firms-merge.mjs.
//
// Run: node worker/test-sat0b2.mjs
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const FIXED_NOW = Date.parse('2026-10-16T20:00:00Z');   // 10:00 HST
Date.now = () => FIXED_NOW;

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('PASS — ' + name)) : (fail++, console.log('FAIL — ' + name)); };

// ── build ────────────────────────────────────────────────────────────────────
const work = mkdtempSync(join(tmpdir(), 'kahuola-sat0b2-'));
cpSync(join(here, 'src'), join(work, 'src'), { recursive: true });
writeFileSync(
  join(work, 'src', 'index.ts'),
  readFileSync(join(work, 'src', 'index.ts'), 'utf8') +
    '\nexport { handleFirmsHotspots, assignFireLocations, handleHazardsSummary, SUMMARY_FIRMS_KEY };\n',
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
    async delete(req) { return cacheStore.delete(typeof req === 'string' ? req : req.url); },
  },
};
console.warn = () => {};
console.log = ((orig) => (...a) => { if (typeof a[0] === 'string' && (a[0].startsWith('PASS') || a[0].startsWith('FAIL') || a[0].startsWith('\n'))) orig(...a); })(console.log);

const HEADER = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';
const row = ({ lat, lon, date = '2026-10-16', time, sat, scan = '0.38', track = '0.36', conf = 'n', dn = 'D' }) =>
  `${lat},${lon},330.1,${scan},${track},${date},${time},${sat},VIIRS,${conf},2.0NRT,290.0,3.1,${dn}`;
const csv = (rows) => [HEADER, ...rows.map(row)].join('\n') + '\n';

let upstreams = {};
globalThis.fetch = async (url) => {
  const u = String(url);
  if (!u.includes('/api/area/csv/')) return new Response('not stubbed', { status: 503 });   // every non-FIRMS upstream is down
  const ds = u.split('/api/area/csv/')[1].split('/')[1];
  const cfg = upstreams[ds];
  if (!cfg) return new Response('not found', { status: 404 });
  if (cfg === 'throw') throw new Error('network down');
  return new Response(cfg.body ?? '', { status: cfg.status ?? 200 });
};

const mod = await import(pathToFileURL(join(work, 'bundle.mjs')).href);
const ENV = { NASA_FIRMS_MAP_KEY: 'TEST_MAP_KEY' };
const HI = 'https://kahuola.org/api/firms/hotspots?scope=hawaii&days=1';
const hotspots = async () => JSON.parse(await (await mod.handleFirmsHotspots(new URL(HI), ENV, {})).text());
const summary = async () => JSON.parse(await (await mod.handleHazardsSummary(new URL('https://kahuola.org/api/hazards/summary'), ENV, {})).text());
const reset = () => { cacheStore.clear(); upstreams = {}; };
const locs = (fc) => new Set(fc.features.map(f => f.properties.location_id));

// ── 1. Same fire, both satellites, 45 min apart → one location ──────────────
reset();
upstreams = {
  VIIRS_NOAA20_NRT: { body: csv([{ lat: 21.4550, lon: -158.1800, time: '1845', sat: 'N20' }]) },
  VIIRS_NOAA21_NRT: { body: csv([{ lat: 21.4570, lon: -158.1790, time: '1930', sat: 'N21' }]) },   // ~0.25 km
  MODIS_NRT: { body: '' },
};
let r = await hotspots();
ok('1. both detections stay on the map (returnedRecords 2)', r.features.length === 2 && r.properties.returnedRecords === 2);
ok('1. one location (location_count 1, one location_id)', r.properties.location_count === 1 && locs(r).size === 1);
ok('1. seen_by = [N20, N21] on both', r.features.every(f => JSON.stringify(f.properties.seen_by) === '["N20","N21"]'));
ok('1. exactly one primary, and it is the newer (N21) detection',
   r.features.filter(f => f.properties.location_primary).length === 1 &&
   r.features.find(f => f.properties.location_primary).properties.satellite === 'N21');

// ── 2. Same-pass neighbours are never merged, not even through a third ───────
reset();
upstreams = {
  VIIRS_NOAA20_NRT: { body: csv([
    { lat: 21.4550, lon: -158.1800, time: '1845', sat: 'N20' },
    { lat: 21.4550, lon: -158.1764, time: '1845', sat: 'N20' },   // adjacent pixel, ~0.37 km east, same pass
  ]) },
  VIIRS_NOAA21_NRT: { body: csv([{ lat: 21.4552, lon: -158.1783, time: '1930', sat: 'N21' }]) },   // between them
  MODIS_NRT: { body: '' },
};
r = await hotspots();
const groups = new Map();
for (const f of r.features) { const g = groups.get(f.properties.location_id) || []; g.push(f.properties.satellite); groups.set(f.properties.location_id, g); }
ok('2. three detections → two locations', r.features.length === 3 && r.properties.location_count === 2);
ok('2. no location holds two detections from the same satellite',
   [...groups.values()].every(g => new Set(g).size === g.length));

// ── 3. Thresholds ───────────────────────────────────────────────────────────
reset();
upstreams = {
  VIIRS_NOAA20_NRT: { body: csv([
    { lat: 20.8000, lon: -156.3300, time: '1845', sat: 'N20' },   // A: partner 2 km away → separate
    { lat: 20.9000, lon: -156.3300, time: '1700', sat: 'N20' },   // B: partner 0.5 km but 90 min → separate
    { lat: 21.0000, lon: -156.3300, time: '1845', sat: 'N20', scan: '0.80', track: '0.70' },   // C: edge pixel
    { lat: 19.7000, lon: -155.1000, time: '1845', sat: 'N20' },   // D: N20 at another pass of the same spot (E)
    { lat: 19.7000, lon: -155.1000, time: '1300', sat: 'N20' },   // E
  ]) },
  VIIRS_NOAA21_NRT: { body: csv([
    { lat: 20.8180, lon: -156.3300, time: '1930', sat: 'N21' },   // 2.0 km from A
    { lat: 20.9045, lon: -156.3300, time: '1830', sat: 'N21' },   // 0.5 km from B, 90 min later
    { lat: 21.0100, lon: -156.3300, time: '1930', sat: 'N21', scan: '0.80', track: '0.70' },   // 1.1 km from C, edge → 1.2 km limit
  ]) },
  MODIS_NRT: { body: '' },
};
r = await hotspots();
const loc = (lat, lon) => r.features.find(f => Math.abs(f.geometry.coordinates[1] - lat) < 1e-6 && Math.abs(f.geometry.coordinates[0] - lon) < 1e-6).properties.location_id;
ok('3. 2 km apart → separate locations', loc(20.8, -156.33) !== loc(20.818, -156.33));
ok('3. 0.5 km but 90 min apart → separate locations', loc(20.9, -156.33) !== loc(20.9045, -156.33));
ok('3. edge pixels (0.8 km) 1.1 km apart → same location', loc(21.0, -156.33) === loc(21.01, -156.33));
ok('3. same satellite, two passes of one spot → separate locations', loc(19.7, -155.1) !== undefined &&
   r.features.filter(f => f.geometry.coordinates[1] === 19.7).map(f => f.properties.location_id).length === 2 &&
   new Set(r.features.filter(f => f.geometry.coordinates[1] === 19.7).map(f => f.properties.location_id)).size === 2);
ok('3. 8 detections → 7 locations', r.features.length === 8 && r.properties.location_count === 7);

// ── 4. A detection that cannot be placed stays its own location ─────────────
const lone = mod.assignFireLocations([
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-158.18, 21.455] }, properties: { acq_datetime_utc: '2026-10-16T18:45:00Z', satellite: 'N20' } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-158.18, 21.455] }, properties: { acq_datetime_utc: '2026-10-16T19:00:00Z' } },   // no satellite
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-158.18, 21.455] }, properties: { satellite: 'N21' } },                               // no time
]);
ok('4. missing satellite or time → never merged (3 locations)', new Set(lone.map(f => f.properties.location_id)).size === 3);
ok('4. every unplaceable detection is its own primary', lone.every(f => f.properties.location_primary === true));

// ── 5. Summary: both up — legacy keys keep detection meaning ────────────────
reset();
upstreams = {
  VIIRS_NOAA20_NRT: { body: csv([
    { lat: 21.4550, lon: -158.1800, time: '1845', sat: 'N20' },                      // wildland, current (paired)
    { lat: 20.8000, lon: -156.3300, time: '0500', sat: 'N20', dn: 'N' },             // wildland, 15 h old
  ]) },
  VIIRS_NOAA21_NRT: { body: csv([
    { lat: 21.4570, lon: -158.1790, time: '1930', sat: 'N21' },                      // pair of the first
    { lat: 19.4058, lon: -155.2899, time: '1217', sat: 'N21', dn: 'N' },             // volcanic
  ]) },
  MODIS_NRT: { body: '' },
};
await hotspots();
let s = await summary();
ok('5. fire.count keeps DETECTION meaning (4)', s.fire.count === 4);
ok('5. legacy volcanic_zone_count / wildland_count unchanged (1 / 3)', s.fire.volcanic_zone_count === 1 && s.fire.wildland_count === 3);
ok('5. fire.status detected, health ok', s.fire.status === 'detected' && s.fire.health === 'ok');
ok('5. location_count 3 (the paired fire counts once)', s.fire.location_count === 3);
ok('5. locations split: volcanic 1 · current 1 · older 1 · unknown 0',
   JSON.stringify(s.fire.locations) === JSON.stringify({ volcanic: 1, wildland_current: 1, wildland_older: 1, wildland_unknown_age: 0 }));
ok('5. newest_acq_utc = 19:30Z, newest_acq_age_s = 1800',
   s.fire.newest_acq_utc === '2026-10-16T19:30:00.000Z' && s.fire.newest_acq_age_s === 1800);
ok('5. datasets_used lists both', JSON.stringify(s.fire.datasets_used) === '["VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT"]');
ok('5. old keys all still present', ['count', 'volcanic_zone_count', 'wildland_count', 'status', 'age_seconds', 'source'].every(k => k in s.fire));

// ── 6. Summary: one satellite down → partial, degraded ──────────────────────
reset();
upstreams = {
  VIIRS_NOAA20_NRT: { body: csv([{ lat: 21.4550, lon: -158.1800, time: '1845', sat: 'N20' }]) },
  VIIRS_NOAA21_NRT: { status: 500 },
  MODIS_NRT: { body: '' },
};
await hotspots();
s = await summary();
ok('6. one satellite down → fire.health partial, status still detected', s.fire.health === 'partial' && s.fire.status === 'detected' && s.fire.count === 1);
ok('6. one satellite down → summary degraded (delay line shows)', s.degraded === true && s.stale === true);
ok('6. datasets_used names the survivor only', JSON.stringify(s.fire.datasets_used) === '["VIIRS_NOAA20_NRT"]');

// ── 7. Summary: all down → null + "unavailable", never 0 ────────────────────
reset();
upstreams = { VIIRS_NOAA20_NRT: { status: 500 }, VIIRS_NOAA21_NRT: 'throw', MODIS_NRT: { status: 500 } };
s = await summary();   // self-warm runs the hotspots handler, which caches nothing
ok('7. all down → fire.count null (was 0)', s.fire.count === null);
ok('7. all down → status "unavailable", health "unavailable"', s.fire.status === 'unavailable' && s.fire.health === 'unavailable');
ok('7. all down → volcanic/wildland/location counts null', s.fire.volcanic_zone_count === null && s.fire.wildland_count === null && s.fire.location_count === null && s.fire.locations === null);
ok('7. all down → summary degraded', s.degraded === true);

// ── 8. Summary: a genuinely quiet day is still 0 / none ─────────────────────
reset();
upstreams = { VIIRS_NOAA20_NRT: { body: csv([]) }, VIIRS_NOAA21_NRT: { body: csv([]) }, MODIS_NRT: { body: '' } };
await hotspots();
s = await summary();
ok('8. quiet day → count 0, status none, health ok, location_count 0',
   s.fire.count === 0 && s.fire.status === 'none' && s.fire.health === 'ok' && s.fire.location_count === 0);

// ── 9. Summary: a cache written before SAT-0b-2 (no location fields) ────────
reset();
cacheStore.set(mod.SUMMARY_FIRMS_KEY, new Response(JSON.stringify({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-158.18, 21.455] }, properties: { volcanic_zone: false, freshness_status: 'FRESH', acq_datetime_utc: '2026-10-16T19:30:00Z' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-158.18, 21.457] }, properties: { volcanic_zone: false, freshness_status: 'FRESH', acq_datetime_utc: '2026-10-16T18:45:00Z' } },
  ],
  properties: { returnedRecords: 2, health: 'ok', generated_at: '2026-10-16T19:58:00Z' },
}), { headers: { 'Content-Type': 'application/geo+json' } }));
s = await summary();
ok('9. pre-0b-2 cache → each detection is its own location (2), no crash', s.fire.count === 2 && s.fire.location_count === 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
