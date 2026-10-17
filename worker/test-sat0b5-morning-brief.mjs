// test-sat0b5-morning-brief.mjs — /api/media/morning-brief (published by the
// 05:30 HST cron to the Apps Script webhook) must never read missing or partial
// FIRMS data as "no fire". Same rules as scripts/insights/generate-brief.mjs.
// No network: FIRMS answered from fixtures, every other upstream is down.
//
// Run: node worker/test-sat0b5-morning-brief.mjs
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const FIXED_NOW = Date.parse('2026-10-16T20:00:00Z');
Date.now = () => FIXED_NOW;

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('PASS — ' + name)) : (fail++, console.log('FAIL — ' + name)); };

const work = mkdtempSync(join(tmpdir(), 'kahuola-sat0b5-'));
cpSync(join(here, 'src'), join(work, 'src'), { recursive: true });
writeFileSync(join(work, 'src', 'index.ts'),
  readFileSync(join(work, 'src', 'index.ts'), 'utf8') + '\nexport { buildMorningBrief };\n');
const { build } = require(join(here, 'node_modules', 'esbuild', 'lib', 'main.js'));
await build({ entryPoints: [join(work, 'src', 'index.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: join(work, 'bundle.mjs'), logLevel: 'error' });

const cacheStore = new Map();
globalThis.caches = { default: {
  async match(req) { const h = cacheStore.get(typeof req === 'string' ? req : req.url); return h ? h.clone() : undefined; },
  async put(req, res) { cacheStore.set(typeof req === 'string' ? req : req.url, res); },
} };
console.warn = () => {};
console.log = ((orig) => (...a) => { if (typeof a[0] === 'string' && /^(PASS|FAIL|\n)/.test(a[0])) orig(...a); })(console.log);

const HEADER = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';
const row = (lat, lon, time, sat) => `${lat},${lon},330,0.38,0.36,2026-10-16,${time},${sat},VIIRS,n,2.0NRT,290,3.1,D`;
const csv = (rows) => [HEADER, ...rows].join('\n') + '\n';
let up = {};
globalThis.fetch = async (url) => {
  const u = String(url);
  if (!u.includes('/api/area/csv/')) return new Response('down', { status: 503 });
  const ds = u.split('/api/area/csv/')[1].split('/')[1];
  const c = up[ds]; if (!c) return new Response('x', { status: 404 });
  return new Response(c.body ?? '', { status: c.status ?? 200 });
};

const mod = await import(pathToFileURL(join(work, 'bundle.mjs')).href);
const ENV = { NASA_FIRMS_MAP_KEY: 'K' };
const brief = async () => { cacheStore.clear(); return mod.buildMorningBrief(new URL('https://kahuola.org/api/media/morning-brief'), ENV, {}); };
const NO_FIRE = /No satellite heat detected/;

// FIRMS: both satellites down
up = { VIIRS_NOAA20_NRT: { status: 500 }, VIIRS_NOAA21_NRT: { status: 500 } };
let b = await brief();
ok('all FIRMS down: wildfire note says could not be verified', /could not be verified/.test(b.wildfire.note));
ok('all FIRMS down: never "No satellite heat detected"', !NO_FIRE.test(b.wildfire.note) && !NO_FIRE.test(b.summary.headline));
ok('all FIRMS down: wildfire listed in sources_unverified', b.summary.sources_unverified.includes('wildfire'));
ok('all FIRMS down: headline is the could-not-verify line, not "no escalation"',
   /could not be verified/.test(b.summary.headline) && !/No statewide primary hazard escalation/.test(b.summary.headline));
ok('all FIRMS down: wildfire status is not MONITORING/ACTIVE', !/MONITORING|ACTIVE/.test(b.wildfire.status));

// FIRMS: HTTP 200 HTML page from both (SAT-0b-1: a non-CSV body is a failed feed)
up = { VIIRS_NOAA20_NRT: { body: '<html>error</html>' }, VIIRS_NOAA21_NRT: { body: 'Invalid MAP_KEY.' } };
b = await brief();
ok('FIRMS 200 non-CSV from both: unverified, never "no heat"', b.summary.sources_unverified.includes('wildfire') && !NO_FIRE.test(b.wildfire.note));

// FIRMS: one satellite down, zero detections
up = { VIIRS_NOAA20_NRT: { body: csv([]) }, VIIRS_NOAA21_NRT: { status: 500 } };
b = await brief();
ok('partial, zero detections: reduced-coverage sentence present', /coverage is reduced/.test(b.wildfire.note));
ok('partial: wildfire listed in sources_partial, not unverified', b.summary.sources_partial.includes('wildfire') && !b.summary.sources_unverified.includes('wildfire'));

// FIRMS: one satellite down, a wildland detection
up = { VIIRS_NOAA20_NRT: { body: csv([row(21.455, -158.18, '1930', 'N20')]) }, VIIRS_NOAA21_NRT: { status: 500 } };
b = await brief();
ok('partial, wildland detection: count + reduced coverage', /1 detection outside volcanic zones/.test(b.wildfire.note) && /coverage is reduced/.test(b.wildfire.note));

// FIRMS: both up, quiet day → the zero wording is earned
up = { VIIRS_NOAA20_NRT: { body: csv([]) }, VIIRS_NOAA21_NRT: { body: csv([]) } };
b = await brief();
ok('both up, quiet: "No satellite heat detected … Clouds or gaps … can hide fires"', NO_FIRE.test(b.wildfire.note) && /can hide fires/.test(b.wildfire.note));
ok('both up, quiet: no reduced-coverage sentence', !/coverage is reduced/.test(b.wildfire.note));

// FIRMS: volcanic only (summit caldera, SAT-0b-1 boxes)
up = { VIIRS_NOAA20_NRT: { body: csv([]) }, VIIRS_NOAA21_NRT: { body: csv([row(19.4058, -155.2899, '1217', 'N21')]) } };
b = await brief();
ok('volcanic only: "volcanic activity, not wildfire", never ACTIVE', /volcanic activity, not wildfire/.test(b.wildfire.note) && b.wildfire.status !== 'ACTIVE' && b.wildfire.detections === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
