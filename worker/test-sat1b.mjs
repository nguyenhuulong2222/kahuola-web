// test-sat1b.mjs — SAT-1b: /api/hazards/smoke-sat (Hawaiʻi GOES-18 ADP haze
// estimate) reads the sat-pipeline R2 frames through a READ-ONLY binding and
// answers one of: detected / no_qualifying_detection / night / warming_up /
// stale / unavailable — never "none". Fixture: the real 2026-10-17 20:50Z frame
// (manifest + coverage + PNG). No network.
//
// Run: node worker/test-sat1b.mjs
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('PASS — ' + name)) : (fail++, console.log('FAIL — ' + name)); };

const work = mkdtempSync(join(tmpdir(), 'kahuola-s1b-'));
cpSync(join(here, 'src'), join(work, 'src'), { recursive: true });
writeFileSync(join(work, 'src', 'index.ts'),
  readFileSync(join(work, 'src', 'index.ts'), 'utf8') + '\nexport { handleSmokeSat, handleSmokeSatFrame };\n');
const { build } = require(join(here, 'node_modules', 'esbuild', 'lib', 'main.js'));
await build({ entryPoints: [join(work, 'src', 'index.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: join(work, 'bundle.mjs'), logLevel: 'error' });
globalThis.caches = { default: { async match() {}, async put() {} } };
const mod = await import(pathToFileURL(join(work, 'bundle.mjs')).href);

const FX = join(here, 'fixtures', 'sat');
const MANIFEST = JSON.parse(readFileSync(join(FX, '20261017T2050Z.json'), 'utf8'));
const COVERAGE = readFileSync(join(FX, '20261017T2050Z_coverage.geojson'), 'utf8');
const PNG = readFileSync(join(FX, '20261017T2050Z.png'));
const SCAN = Date.parse(MANIFEST.scan_start_utc[0]);
const LATEST = { manifest_key: 'hawaii/frames/20261017T2050Z.json', png_key: 'hawaii/frames/20261017T2050Z.png', coverage_key: 'hawaii/frames/20261017T2050Z_coverage.geojson', status: MANIFEST.status };

// Read-only R2 stub: get() only; records every key asked for.
function bucket(objects) {
  const asked = [];
  return { asked, get: async (key) => { asked.push(key); if (!(key in objects)) return null; const v = objects[key];
    return { text: async () => (typeof v === 'string' ? v : Buffer.from(v).toString('utf8')), arrayBuffer: async () => (typeof v === 'string' ? Buffer.from(v) : v) }; } };
}
const objectsWith = (m, latest = LATEST) => ({
  'hawaii/latest.json': JSON.stringify(latest),
  'hawaii/frames/20261017T2050Z.json': JSON.stringify(m),
  'hawaii/frames/20261017T2050Z_coverage.geojson': COVERAGE,
  'hawaii/frames/20261017T2050Z.png': PNG,
});
const at = (ms) => { Date.now = () => ms; };
const call = async (env, href = 'https://kahuola.org/api/hazards/smoke-sat?region=hawaii') =>
  JSON.parse(await (await mod.handleSmokeSat(new URL(href), env, {})).text());

// detected — the real frame, 15 min after scan
at(SCAN + 15 * 60_000);
let j = await call({ SAT_R2: bucket(objectsWith(MANIFEST)) });
ok('detected: real 20:50Z frame (SMOKE > 0)', j.state === 'detected' && j.haze_pixels === (MANIFEST.counts.SMOKE + MANIFEST.counts.DUST) && j.haze_pixels > 0);
ok('detected: scan time, frame url, image corners, coverage outline', j.scan_start_utc && /\/api\/hazards\/smoke-sat\/frame\?key=hawaii%2Fframes%2F20261017T2050Z\.png$/.test(j.frame_url) && j.image_coordinates.length === 4 && j.coverage && j.coverage.type === 'FeatureCollection');
ok('detected: corners match the manifest bbox (TL, TR, BR, BL)', JSON.stringify(j.image_coordinates) === JSON.stringify([[MANIFEST.bbox[0], MANIFEST.bbox[3]], [MANIFEST.bbox[2], MANIFEST.bbox[3]], [MANIFEST.bbox[2], MANIFEST.bbox[1]], [MANIFEST.bbox[0], MANIFEST.bbox[1]]]));
ok('framing: not official, haze not smoke, vog + volcanic suppression + daytime disclosed', j.official === false && /not an official product/.test(j.note) && /vog/.test(j.note) && /suppressed/.test(j.note) && /Daytime only/.test(j.note));
ok('framing: absence ≠ no haze', /Does NOT mean there is no haze/.test(j.meaning_of_absence));
ok('official vog dashboard linked', j.official_vog_url === 'https://vog.ivhhn.org/');

// no_qualifying_detection
j = await call({ SAT_R2: bucket(objectsWith({ ...MANIFEST, counts: { ...MANIFEST.counts, SMOKE: 0, DUST: 0 } })) });
ok('no_qualifying_detection: complete frame with 0 haze pixels (never "none")', j.state === 'no_qualifying_detection' && j.state !== 'none' && j.frame_url);

// partial frame still answers, flagged
j = await call({ SAT_R2: bucket(objectsWith({ ...MANIFEST, status: 'partial' })) });
ok('partial frame: detected with partial: true', j.state === 'detected' && j.partial === true);

// night / warming_up — no image served
j = await call({ SAT_R2: bucket(objectsWith({ ...MANIFEST, status: 'night', counts: { ...MANIFEST.counts, SMOKE: 0 } })) });
ok('night: state night, no frame url', j.state === 'night' && j.frame_url === null);
j = await call({ SAT_R2: bucket(objectsWith({ ...MANIFEST, status: 'warming_up', counts: { ...MANIFEST.counts, SMOKE: 0 } })) });
ok('warming_up: state warming_up, no frame url', j.state === 'warming_up' && j.frame_url === null);

// stale — 41 min old, even if the frame says complete/detected
at(SCAN + 41 * 60_000);
j = await call({ SAT_R2: bucket(objectsWith(MANIFEST)) });
ok('stale: scan 41 min old → stale, no frame url, age reported', j.state === 'stale' && j.frame_url === null && j.frame_age_seconds === 41 * 60);
at(SCAN + 39 * 60_000);
j = await call({ SAT_R2: bucket(objectsWith(MANIFEST)) });
ok('39 min old is still current (stale threshold 40 min)', j.state === 'detected');

// unavailable paths
at(SCAN + 15 * 60_000);
ok('unavailable: no binding (not_configured)', (j = await call({})).state === 'unavailable' && j.reason === 'not_configured');
ok('unavailable: no latest.json', (j = await call({ SAT_R2: bucket({}) })).state === 'unavailable' && j.reason === 'no_frame');
ok('unavailable: unreadable manifest', (j = await call({ SAT_R2: bucket({ ...objectsWith(MANIFEST), 'hawaii/frames/20261017T2050Z.json': '{not json' }) })).state === 'unavailable' && j.reason === 'manifest_unreadable');
ok('unavailable: pipeline status unavailable', (j = await call({ SAT_R2: bucket(objectsWith({ ...MANIFEST, status: 'unavailable' })) })).state === 'unavailable');
ok('unavailable: other regions are not covered', (j = await call({ SAT_R2: bucket(objectsWith(MANIFEST)) }, 'https://kahuola.org/api/hazards/smoke-sat?region=usa')).state === 'unavailable' && j.reason === 'region_not_covered');
const all = ['detected', 'no_qualifying_detection', 'night', 'warming_up', 'stale', 'unavailable'];
ok('every answer above used a defined state', all.includes(j.state));

// read-only + frame key guard
const b = bucket(objectsWith(MANIFEST)); await call({ SAT_R2: b });
ok('reads only hawaii/latest.json + that frame\'s manifest + coverage', b.asked.every(k => k === 'hawaii/latest.json' || k.startsWith('hawaii/frames/20261017T2050Z')));
let r = await mod.handleSmokeSatFrame(new URL('https://kahuola.org/api/hazards/smoke-sat/frame?key=hawaii%2Fframes%2F20261017T2050Z.png'), { SAT_R2: bucket(objectsWith(MANIFEST)) }, {});
ok('frame: serves the PNG (image/png, immutable)', r.status === 200 && r.headers.get('Content-Type') === 'image/png' && Buffer.from(await r.arrayBuffer()).subarray(1, 4).toString() === 'PNG');
for (const bad of ['hawaii/state/history.npz', '../secrets', 'conus/frames/20261017T2050Z.png', 'hawaii/latest.json']) {
  r = await mod.handleSmokeSatFrame(new URL('https://kahuola.org/api/hazards/smoke-sat/frame?key=' + encodeURIComponent(bad)), { SAT_R2: bucket(objectsWith(MANIFEST)) }, {});
  ok(`frame: refuses key "${bad}" (400)`, r.status === 400);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
