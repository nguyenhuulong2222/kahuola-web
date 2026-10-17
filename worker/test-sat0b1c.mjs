// test-sat0b1c.mjs — SAT-0b-1c: the Kīlauea volcanic box derived from 90 days
// of FIRMS data. Today's 44 summit-margin pixels (which the SAT-0b-1 caldera
// box published as "wildfire" on 2026-10-17) must be volcanic WITHOUT any
// VOLCANIC_EXTRA_ZONES override; the places people live must stay wildland.
// End to end through handleFirmsHotspots. No network.
//
// Run: node worker/test-sat0b1c.mjs
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const FIXED_NOW = Date.parse('2026-10-17T20:00:00Z');
Date.now = () => FIXED_NOW;

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('PASS — ' + name)) : (fail++, console.log('FAIL — ' + name)); };

const work = mkdtempSync(join(tmpdir(), 'kahuola-sat0b1c-'));
cpSync(join(here, 'src'), join(work, 'src'), { recursive: true });
writeFileSync(join(work, 'src', 'index.ts'),
  readFileSync(join(work, 'src', 'index.ts'), 'utf8') + '\nexport { handleFirmsHotspots, configureVolcanicExtraZones };\n');
const { build } = require(join(here, 'node_modules', 'esbuild', 'lib', 'main.js'));
await build({ entryPoints: [join(work, 'src', 'index.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: join(work, 'bundle.mjs'), logLevel: 'error' });

globalThis.caches = { default: { async match() {}, async put() {} } };
console.warn = () => {};
const FX = JSON.parse(readFileSync(join(here, 'fixtures', 'firms', 'kilauea_edge_20261017.json'), 'utf8')).pixels;
const HEADER = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';
const row = (p) => `${p.lat},${p.lon},${p.bright_ti4 || 300},${p.scan || 0.4},${p.track || 0.4},${p.acq_date},${p.acq_time},${p.satellite},VIIRS,${p.confidence || 'n'},2.0NRT,${p.bright_ti5 || 290},${p.frp || 1},${p.daynight || 'N'}`;
const REF = {
  'Volcano village (centre)': [-155.2369, 19.4425],
  'Volcano village (south edge, Hwy 11)': [-155.2380, 19.4320],
  'HVNP Visitor Center': [-155.2575, 19.4294],
  'Kīlauea Military Camp': [-155.2709, 19.4320],
  'Leilani Estates': [-154.914, 19.465],
  'Pāhoa': [-154.945, 19.494],
};
const refRows = Object.values(REF).map(([lon, lat]) => row({ lon, lat, acq_date: '2026-10-17', acq_time: '1253', satellite: 'N20' }));
let up = {};
globalThis.fetch = async (u) => {
  const ds = String(u).split('/api/area/csv/')[1].split('/')[1];
  const c = up[ds]; return c ? new Response(c, { status: 200 }) : new Response('x', { status: 404 });
};
const mod = await import(pathToFileURL(join(work, 'bundle.mjs')).href);
mod.configureVolcanicExtraZones(undefined);   // NO operator override
up = {
  VIIRS_NOAA20_NRT: [HEADER, ...FX.filter(p => p.satellite === 'N20').map(row), ...refRows].join('\n') + '\n',
  VIIRS_NOAA21_NRT: [HEADER, ...FX.filter(p => p.satellite === 'N21').map(row)].join('\n') + '\n',
};
const r = JSON.parse(await (await mod.handleFirmsHotspots(new URL('https://kahuola.org/api/firms/hotspots?scope=hawaii&days=1'), { NASA_FIRMS_MAP_KEY: 'K' }, {})).text());
const at = (lon, lat) => r.features.find(f => Math.abs(f.geometry.coordinates[0] - lon) < 1e-6 && Math.abs(f.geometry.coordinates[1] - lat) < 1e-6);

ok('fixture has the 44 edge pixels', FX.length === 44);
ok('no VOLCANIC_EXTRA_ZONES in force', JSON.stringify(r.properties.volcanic_zones) === '["kilauea-summit","mauna-loa-summit"]');
const edgeOut = FX.filter(p => { const f = at(p.lon, p.lat); return !f || f.properties.volcanic_zone !== true; });
ok(`all 44 summit-margin pixels are volcanic (${44 - edgeOut.length}/44)`, edgeOut.length === 0);
for (const [name, [lon, lat]] of Object.entries(REF)) {
  const f = at(lon, lat);
  ok(`${name} stays wildland`, f && f.properties.volcanic_zone === false);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
