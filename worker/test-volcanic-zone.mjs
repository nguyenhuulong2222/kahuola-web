// test-volcanic-zone.mjs — Phase A acceptance: volcanic-zone classification.
// Extracts the REAL VOLCANIC_ZONES bboxes from src/index.ts and verifies
// point-in-bbox classification + the summary count invariant
// (count === volcanic_zone_count + wildland_count). No network. Run:
//   node worker/test-volcanic-zone.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'src', 'index.ts'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('PASS — ' + name)) : (fail++, console.log('FAIL — ' + name)); };

// --- Extract the real zones from source (tests the shipped coordinates) ------
const zones = [...src.matchAll(/\{ id: '([^']+)',\s*west: (-?[\d.]+), south: (-?[\d.]+), east: (-?[\d.]+), north: (-?[\d.]+) \}/g)]
  .map(m => ({ id: m[1], west: +m[2], south: +m[3], east: +m[4], north: +m[5] }));
ok('parsed 2 volcanic zones from source', zones.length === 2);
ok('zones are the two summit calderas (SAT-0b-1)', zones.map(z => z.id).join(',') === 'kilauea-summit,mauna-loa-summit');

// Mirror of inVolcanicZone() (inclusive bbox on validated [lng,lat]).
function inZone(lng, lat) {
  return zones.some(z => lng >= z.west && lng <= z.east && lat >= z.south && lat <= z.north);
}

// --- Classification fixtures -------------------------------------------------
// SAT-0b-1 ruling: summit calderas only. Lower Puna, Leilani, Pāhoa, Volcano
// village and the rift zones are WILDLAND (over-warn, never hide).
const cases = [
  ['Kīlauea summit (Halemaʻumaʻu)', -155.287, 19.408, true],
  ['Kīlauea caldera, live 2026-10-16 N21 pixel', -155.2858, 19.4012, true],
  ['Mauna Loa summit (Mokuʻāweoweo)', -155.600, 19.475, true],
  ['Kīlauea box west EDGE (inclusive, SAT-0b-1c)', -155.350, 19.40, true],
  ['just WEST of the Kīlauea box', -155.351, 19.40, false],
  ['Kīlauea SW caldera margin (2026-10-17 edge pixel)', -155.28224, 19.38007, true],
  ['Kīlauea W margin (2026-10-17 edge pixel)', -155.33337, 19.41586, true],
  ['Kīlauea Military Camp', -155.2709, 19.4320, false],
  ['Volcano village south edge (Hwy 11)', -155.2380, 19.4320, false],
  ['Kīlauea lower ERZ / Leilani', -154.914, 19.465, false],
  ['Pāhoa town', -154.945, 19.494, false],
  ['Volcano village', -155.234, 19.442, false],
  ['HVNP Visitor Center rim', -155.2578, 19.4308, false],
  ['HVNP Visitor Center', -155.2575, 19.4294, false],
  ['Kīlauea ocean-entry area', -154.85, 19.35, false],
  ['Mauna Loa 2022 NERZ flow', -155.45, 19.55, false],
  ['Lahaina, Maui (real wildfire risk)', -156.68, 20.88, false],
  ['Hilo (pop. area)', -155.09, 19.72, false],
  ['Honolulu, Oʻahu', -157.86, 21.31, false],
];
for (const [name, lng, lat, want] of cases) ok(`${name} → ${want ? 'volcanic' : 'wildland'}`, inZone(lng, lat) === want);

// --- Summary count invariant: count === volcanic + wildland -----------------
const feats = cases.map(([, lng, lat]) => ({ properties: { volcanic_zone: inZone(lng, lat) } }));
const total = feats.length;
let volcanic = 0;
for (const f of feats) if (f.properties.volcanic_zone === true) volcanic++;
const wildland = Math.max(0, total - volcanic);
ok('count === volcanic_zone_count + wildland_count', total === volcanic + wildland);
ok('expected split (6 volcanic / 13 wildland)', volcanic === 6 && wildland === 13);
console.log(`  (total=${total}, volcanic=${volcanic}, wildland=${wildland})`);

// Old-cache fallback: features with no volcanic_zone field → all wildland, invariant holds.
const oldFeats = [{ properties: {} }, { properties: {} }, { properties: {} }];
let v2 = 0; for (const f of oldFeats) if (f.properties.volcanic_zone === true) v2++;
const w2 = Math.max(0, oldFeats.length - v2);
ok('old cache (no field) → 0 volcanic, all wildland, invariant holds', v2 === 0 && w2 === oldFeats.length && oldFeats.length === v2 + w2);

// --- Static source assertions (additive wiring is present) ------------------
ok('firmsCsvToGeojson tags volcanic_zone via inVolcanicZone(lng, lat)',
   /volcanic_zone: inVolcanicZone\(lng, lat\)/.test(src));
ok('readSummaryFirms derives wildland = total - volcanic',
   /const wildland = Math\.max\(0, total - volcanic\)/.test(src));
// SAT-0b-2: the fire block now has an unavailable branch (null counts) and an
// available branch carrying the legacy keys.
ok('summary fire block adds volcanic_zone_count + wildland_count',
   /volcanic_zone_count: fire\.volcanic_zone_count \?\? 0, wildland_count: fire\.wildland_count \?\? 0/.test(src));
ok('summary fire block: unavailable is null counts + status "unavailable", never 0',
   /count: null, volcanic_zone_count: null, wildland_count: null, status: 'unavailable'/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
