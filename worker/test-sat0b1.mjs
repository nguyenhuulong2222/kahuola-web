// test-sat0b1.mjs — SAT-0b-1 acceptance: fire field truth + summit-only
// volcanic zones, end to end through handleFirmsHotspots against a stubbed
// upstream. No network, no deploy. Same build approach as test-firms-merge.mjs.
//
// Run: node worker/test-sat0b1.mjs
//
// Fixtures (a)–(f) from the SAT-0b plan, plus a Puna point:
//   (a) wildland detected   (b) volcanic only        (c) industrial/static site
//   (d) stale > 12 h        (e) one satellite down   (f) all down
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Fixed clock: 2026-10-16 20:00 UTC = 10:00 HST.
const FIXED_NOW = Date.parse('2026-10-16T20:00:00Z');
Date.now = () => FIXED_NOW;

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('PASS — ' + name)) : (fail++, console.log('FAIL — ' + name)); };

// ── build ────────────────────────────────────────────────────────────────────
const work = mkdtempSync(join(tmpdir(), 'kahuola-sat0b1-'));
cpSync(join(here, 'src'), join(work, 'src'), { recursive: true });
writeFileSync(
  join(work, 'src', 'index.ts'),
  readFileSync(join(work, 'src', 'index.ts'), 'utf8') +
    '\nexport { handleFirmsHotspots, configureVolcanicExtraZones, parseVolcanicExtraZones,' +
    ' inVolcanicZone, normalizeViirsConfidence };\n',
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
    async match(req) { const hit = cacheStore.get(typeof req === 'string' ? req : req.url); return hit ? hit.clone() : undefined; },
    async put(req, res) { putCount++; cacheStore.set(typeof req === 'string' ? req : req.url, res); },
  },
};
const warns = [];
console.warn = (m) => warns.push(String(m));

const HEADER = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';
const row = ({ lat, lon, date, time, sat, conf = 'n', dn = 'D', frp = '3.1' }) =>
  `${lat},${lon},330.1,0.4,0.36,${date},${time},${sat},VIIRS,${conf},2.0NRT,290.0,${frp},${dn}`;
const csv = (rows) => [HEADER, ...rows.map(row)].join('\n') + '\n';
const MODIS_HEADER = 'latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight';
const modisCsv = (pts) => [MODIS_HEADER, ...pts.map(p => `${p.lat},${p.lon},320,1,1,${p.date},${p.time},Aqua,MODIS,70,6.1NRT,295,10,D`)].join('\n') + '\n';

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
  return { res, json: JSON.parse(await res.text()) };
};
const reset = () => { cacheStore.clear(); putCount = 0; requested.length = 0; upstreams = {}; mod.configureVolcanicExtraZones(undefined); };
const near = (f, lon, lat) => Math.abs(f.geometry.coordinates[0] - lon) < 1e-6 && Math.abs(f.geometry.coordinates[1] - lat) < 1e-6;
const pick = (r, lon, lat) => r.json.features.find(f => near(f, lon, lat));

// Fixture points.
const P = {
  wildland:   { lat: 21.455,  lon: -158.180, date: '2026-10-16', time: '1930', sat: 'N20', conf: 'h', dn: 'D' }, // (a) Waiʻanae ridge, 30 min old
  volcanic:   { lat: 19.4058, lon: -155.2899, date: '2026-10-16', time: '1217', sat: 'N21', conf: 'n', dn: 'N' }, // (b) Halemaʻumaʻu, live pixel
  industrial: { lat: 21.355,  lon: -158.128, date: '2026-10-16', time: '1930', sat: 'N21', conf: 'n', dn: 'D' }, // (c) Kahe Point power plant
  stale:      { lat: 20.800,  lon: -156.330, date: '2026-10-16', time: '0500', sat: 'N20', conf: 'l', dn: 'N' }, // (d) 15 h old
  expired:    { lat: 20.810,  lon: -156.340, date: '2026-10-15', time: '1500', sat: 'N20', conf: 'n', dn: 'D' }, // (d) 29 h → out of window
  leilani:    { lat: 19.465,  lon: -154.914, date: '2026-10-16', time: '1217', sat: 'N21', conf: 'n', dn: 'N' }, // Puna
  pahoa:      { lat: 19.494,  lon: -154.945, date: '2026-10-16', time: '1217', sat: 'N21', conf: 'n', dn: 'N' }, // Puna
  volcanoVil: { lat: 19.442,  lon: -155.234, date: '2026-10-16', time: '1217', sat: 'N21', conf: 'n', dn: 'N' }, // Volcano village
};

// ── (a)(b)(c)(d) + Puna, both satellites up ─────────────────────────────────
reset();
upstreams = {
  VIIRS_NOAA20_NRT: { body: csv([P.wildland, P.stale, P.expired]) },
  VIIRS_NOAA21_NRT: { body: csv([P.volcanic, P.industrial, P.leilani, P.pahoa, P.volcanoVil]) },
  MODIS_NRT: { body: modisCsv([
    { lat: 21.460, lon: -158.175, date: '2026-10-16', time: '1945' },  // 0.7 km, 15 min from (a) → corroborates
    { lat: 21.356, lon: -158.129, date: '2026-10-16', time: '1630' },  // at (c) but 3 h earlier → does not
  ]) },
};
let r = await call();
const a = pick(r, P.wildland.lon, P.wildland.lat);
const b = pick(r, P.volcanic.lon, P.volcanic.lat);
const c = pick(r, P.industrial.lon, P.industrial.lat);
const d = pick(r, P.stale.lon, P.stale.lat);
ok('both up → health ok', r.json.properties.health === 'ok');
ok('(a) wildland: present, not volcanic, FRESH', a && a.properties.volcanic_zone === false && a.properties.freshness_status === 'FRESH');
ok('(a) confidence h → high', a.properties.detection_confidence === 'high' && a.properties.confidence === 'h');
ok('(a) day pass (D, 09:30 HST) → is_night_detection false', a.properties.is_night_detection === false);
ok('(a) MODIS 0.7 km / 15 min → corroborated_by [MODIS]', JSON.stringify(a.properties.corroborated_by) === '["MODIS"]');
ok('(b) volcanic: Halemaʻumaʻu pixel → volcanic_zone true', b && b.properties.volcanic_zone === true);
ok('(b) night pass N at 12:17Z (02:17 HST) → is_night_detection true', b.properties.is_night_detection === true);
ok('(b) confidence n → nominal (MODIS no longer raises it)', b.properties.detection_confidence === 'nominal');
ok('(b) no MODIS nearby → corroborated_by []', JSON.stringify(b.properties.corroborated_by) === '[]');
ok('(c) industrial site is shown as a wildland detection (no static list, ruling 2)', c && c.properties.volcanic_zone === false && c.properties.freshness_status === 'FRESH');
ok('(c) MODIS at the same spot 3 h earlier → NOT corroborated', JSON.stringify(c.properties.corroborated_by) === '[]');
ok('(d) 15 h old → kept, STALE_DROP, signal_state historical', d && d.properties.freshness_status === 'STALE_DROP' && d.properties.signal_state === 'historical');
ok('(d) confidence l → low', d.properties.detection_confidence === 'low');
ok('(d) 29 h old → dropped_outside_window, not returned',
   !pick(r, P.expired.lon, P.expired.lat) && r.json.properties.dropped_outside_window === 1);
ok('Puna: Leilani → wildland', pick(r, P.leilani.lon, P.leilani.lat).properties.volcanic_zone === false);
ok('Puna: Pāhoa → wildland', pick(r, P.pahoa.lon, P.pahoa.lat).properties.volcanic_zone === false);
ok('Volcano village → wildland', pick(r, P.volcanoVil.lon, P.volcanoVil.lat).properties.volcanic_zone === false);
ok('volcanic_zones reports the two summits only',
   JSON.stringify(r.json.properties.volcanic_zones) === '["kilauea-summit","mauna-loa-summit"]');
ok('modis_xref ok', r.json.properties.modis_xref === 'ok');
const vol = r.json.features.filter(f => f.properties.volcanic_zone === true).length;
ok('count invariant: 7 returned = 1 volcanic + 6 wildland',
   r.json.features.length === 7 && vol === 1 && r.json.features.length - vol === 6);

// ── VOLCANIC_EXTRA_ZONES: an active Puna eruption ───────────────────────────
reset();
mod.configureVolcanicExtraZones(JSON.stringify([{ id: 'puna-test', west: -155.0, south: 19.40, east: -154.80, north: 19.55 }]));
upstreams = {
  VIIRS_NOAA20_NRT: { body: csv([]) },
  VIIRS_NOAA21_NRT: { body: csv([P.leilani, P.volcanoVil]) },
  MODIS_NRT: { body: modisCsv([]) },
};
r = await call();
ok('extra zone in force → Leilani volcanic', pick(r, P.leilani.lon, P.leilani.lat).properties.volcanic_zone === true);
ok('extra zone does not reach Volcano village → still wildland', pick(r, P.volcanoVil.lon, P.volcanoVil.lat).properties.volcanic_zone === false);
ok('volcanic_zones names the extra zone',
   JSON.stringify(r.json.properties.volcanic_zones) === '["kilauea-summit","mauna-loa-summit","extra:puna-test"]');
ok('extra zones empty by default', mod.parseVolcanicExtraZones(undefined).length === 0 && mod.parseVolcanicExtraZones('').length === 0);
ok('invalid JSON → no extra zones (fail toward wildland)', mod.parseVolcanicExtraZones('{oops').length === 0);
ok('zone outside the Hawaiʻi envelope is dropped',
   mod.parseVolcanicExtraZones(JSON.stringify([{ id: 'ca', west: -120, south: 35, east: -119, north: 36 }])).length === 0);
ok('inverted box is dropped',
   mod.parseVolcanicExtraZones(JSON.stringify([{ id: 'inv', west: -154.8, south: 19.4, east: -155.0, north: 19.5 }])).length === 0);
ok('at most 10 extra zones',
   mod.parseVolcanicExtraZones(JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ id: `z${i}`, west: -155, south: 19.4, east: -154.9, north: 19.5 })))).length === 10);
ok('fetch and scheduled entry points both load VOLCANIC_EXTRA_ZONES',
   (readFileSync(join(here, 'src', 'index.ts'), 'utf8').match(/configureVolcanicExtraZones\(env\.VOLCANIC_EXTRA_ZONES\)/g) || []).length === 2);

// ── night / confidence edge cases ───────────────────────────────────────────
reset();
upstreams = {
  VIIRS_NOAA20_NRT: { body: [HEADER,
    row({ ...P.wildland, dn: '' }),
    row({ ...P.industrial, sat: 'N20', conf: '?' }),
  ].join('\n') + '\n' },
  VIIRS_NOAA21_NRT: { body: csv([]) },
  MODIS_NRT: { status: 500, body: 'x' },
};
r = await call();
ok('missing daynight → is_night_detection null (never guessed)', pick(r, P.wildland.lon, P.wildland.lat).properties.is_night_detection === null);
ok('unknown confidence letter → detection_confidence null', pick(r, P.industrial.lon, P.industrial.lat).properties.detection_confidence === null);
ok('MODIS down → corroborated_by null on every feature, modis_xref failed',
   r.json.features.every(f => f.properties.corroborated_by === null) && r.json.properties.modis_xref === 'failed');
ok('MODIS down does not affect health (VIIRS both up)', r.json.properties.health === 'ok');
ok('normalizeViirsConfidence maps words too', mod.normalizeViirsConfidence('Nominal') === 'nominal' && mod.normalizeViirsConfidence('HIGH') === 'high');

// ── (e) one satellite down ──────────────────────────────────────────────────
reset();
upstreams = {
  VIIRS_NOAA20_NRT: { body: csv([P.wildland]) },
  VIIRS_NOAA21_NRT: { status: 500, body: 'oops' },
  MODIS_NRT: { body: modisCsv([]) },
};
r = await call();
ok('(e) N21 HTTP 500 → health partial', r.json.properties.health === 'partial');
ok('(e) datasets_used = [N20] only', JSON.stringify(r.json.properties.datasets_used) === '["VIIRS_NOAA20_NRT"]');
ok('(e) survivor detections still returned', r.json.features.length === 1);
ok('(e) partial snapshot is cached', putCount === 1);
reset();
upstreams = {
  VIIRS_NOAA20_NRT: { body: csv([P.wildland]) },
  VIIRS_NOAA21_NRT: { body: '<!DOCTYPE html><html>Service Unavailable</html>' },
  MODIS_NRT: { body: modisCsv([]) },
};
r = await call();
ok('(e) N21 HTTP 200 with an HTML page → counted as down, health partial',
   r.json.properties.health === 'partial' && !r.json.properties.datasets_used.includes('VIIRS_NOAA21_NRT'));
reset();
upstreams = {
  VIIRS_NOAA20_NRT: { body: csv([P.wildland]) },
  VIIRS_NOAA21_NRT: { body: '' },
  MODIS_NRT: { body: modisCsv([]) },
};
r = await call();
ok('(e) N21 empty 200 body → counted as down', r.json.properties.health === 'partial');

// ── (f) all down ────────────────────────────────────────────────────────────
reset();
upstreams = { VIIRS_NOAA20_NRT: { status: 500 }, VIIRS_NOAA21_NRT: 'throw', MODIS_NRT: { status: 500 } };
r = await call();
ok('(f) all down → HTTP 200 (map still renders)', r.res.status === 200);
ok('(f) all down → health degraded, datasets_used []',
   r.json.properties.health === 'degraded' && r.json.properties.datasets_used.length === 0);
ok('(f) all down → features [] and NOT cached (summary stays miss, never "none")',
   r.json.features.length === 0 && putCount === 0);
reset();
upstreams = {
  VIIRS_NOAA20_NRT: { body: 'Invalid MAP_KEY.' },
  VIIRS_NOAA21_NRT: { body: 'Invalid MAP_KEY.' },
  MODIS_NRT: { body: 'Invalid MAP_KEY.' },
};
r = await call();
ok('(f) both answer 200 "Invalid MAP_KEY." → degraded, not cached (was: health ok, 0 fires)',
   r.json.properties.health === 'degraded' && putCount === 0);

// A genuinely quiet day is still a quiet day: header-only CSVs from both.
reset();
upstreams = { VIIRS_NOAA20_NRT: { body: csv([]) }, VIIRS_NOAA21_NRT: { body: csv([]) }, MODIS_NRT: { body: modisCsv([]) } };
r = await call();
ok('quiet day (header-only from both) → health ok, 0 features, cached',
   r.json.properties.health === 'ok' && r.json.features.length === 0 && putCount === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
