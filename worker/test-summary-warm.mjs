// test-summary-warm.mjs — Phase A acceptance: summary self-warming key match.
// Source-level proof that each warm handler writes the EXACT cache key the
// summary reader reads (cross-colo consistency). Run: node worker/test-summary-warm.mjs
// (run from repo root or worker/). No network, no deploy.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'src', 'index.ts'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond) => { (cond ? (pass++, console.log('PASS — ' + name)) : (fail++, console.log('FAIL — ' + name))); };
const rx = (re) => { const m = src.match(re); return m ? m[1] : null; };

// --- 1. Extract the real hawaii bbox + firmsCacheKey template from source ---
const hawaii = rx(/hawaii:\s*\[(-?\d[^\]]*)\]/);              // "-161.2, 18.5, -154.5, 22.5"
const bbox = hawaii ? hawaii.split(',').map(s => s.trim()) : [];
ok('REGION_BBOXES.hawaii has 4 numbers', bbox.length === 4);

const tmpl = rx(/function firmsCacheKey\([^)]*\):\s*string\s*\{\s*return `([^`]+)`/);
ok('firmsCacheKey builder exists', !!tmpl);
// Rebuild the key the SAME way firmsCacheKey does, for the hawaii/VIIRS/1 defaults.
const builtKey = tmpl
  ? tmpl.replace('${dataset}', 'VIIRS_SNPP_NRT')
        .replace('${bbox[0]}', bbox[0]).replace('${bbox[1]}', bbox[1])
        .replace('${bbox[2]}', bbox[2]).replace('${bbox[3]}', bbox[3])
        .replace('${days}', '1')
  : '';
// The canonical key value every consumer/upstream cache already uses.
const CANON = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv/_/VIIRS_SNPP_NRT/-161.2,18.5,-154.5,22.5/1';
ok('firmsCacheKey(hawaii,VIIRS,1) === canonical key value', builtKey === CANON);

// --- 2. Reader + writer both build the FIRMS key via the shared helper ---
ok('SUMMARY_FIRMS_KEY built via firmsCacheKey(hawaii defaults)',
   /const SUMMARY_FIRMS_KEY\s*=\s*firmsCacheKey\('VIIRS_SNPP_NRT',\s*REGION_BBOXES\.hawaii,\s*1\)/.test(src));
ok('handleFirmsHotspots cache key built via firmsCacheKey(dataset, bbox, days)',
   /const cacheUrl\s*=\s*firmsCacheKey\(dataset,\s*bbox,\s*days\)/.test(src));
ok('summary reads SUMMARY_FIRMS_KEY', /readSummaryFirms\(SUMMARY_FIRMS_KEY,/.test(src));

// --- 3. Warm FIRMS call uses scope=hawaii with NO dataset/days override -----
const firmsWarm = rx(/handleFirmsHotspots\(new URL\(`\$\{origin\}([^`]+)`\)/);
ok('warm FIRMS url = /api/hazards/firms?scope=hawaii', firmsWarm === '/api/hazards/firms?scope=hawaii');
ok('warm FIRMS url has no dataset/days override', firmsWarm != null && !/dataset=|days=/.test(firmsWarm));

// --- 4. Smoke/perim: literal cache keys match the SUMMARY_* constants --------
const smokeConst = rx(/const SUMMARY_SMOKE_KEY\s*=\s*'([^']+)'/);
const perimConst = rx(/const SUMMARY_PERIM_KEY\s*=\s*'([^']+)'/);
const smokeWriter = rx(/async function handleSmoke\([\s\S]*?const cacheKey\s*=\s*'([^']+)'/);
const perimWriter = rx(/async function handlePerimeters\([\s\S]*?const cacheKey\s*=\s*'([^']+)'/);
ok('handleSmoke cacheKey === SUMMARY_SMOKE_KEY', !!smokeConst && smokeConst === smokeWriter);
ok('handlePerimeters cacheKey === SUMMARY_PERIM_KEY', !!perimConst && perimConst === perimWriter);
ok('SUMMARY_SMOKE_KEY is the hawaii primary key', smokeConst === 'https://kahuola.org/cache/smoke-hawaii-v1');
ok('SUMMARY_PERIM_KEY is the hawaii primary key', perimConst === 'https://kahuola.org/cache/perimeters-hawaii-v1');

// warm smoke/perim urls carry region=hawaii (resolveRegion default is hawaii too)
ok('warm smoke url = /api/hazards/smoke?region=hawaii',
   /handleSmoke\(new URL\(`\$\{origin\}\/api\/hazards\/smoke\?region=hawaii`\)/.test(src));
ok('warm perimeters url = /api/hazards/perimeters?region=hawaii',
   /handlePerimeters\(new URL\(`\$\{origin\}\/api\/hazards\/perimeters\?region=hawaii`\)/.test(src));

// --- 5. Warm ONLY on miss + isolation + no recursion ------------------------
ok("warm gated on status === 'miss' (3 sources)",
   (src.match(/\.status === 'miss'\) \{/g) || []).length === 3);
ok('warm tasks run under Promise.allSettled', /await Promise\.allSettled\(warmTasks\)/.test(src));
// handlers never call back into the summary (no recursion)
const smokeBody = (src.match(/async function handleSmoke\([\s\S]*?\n\}/) || [''])[0];
const perimBody = (src.match(/async function handlePerimeters\([\s\S]*?\n\}/) || [''])[0];
const firmsBody = (src.match(/async function handleFirmsHotspots\([\s\S]*?\n\}/) || [''])[0];
ok('no handler calls handleHazardsSummary (no recursion)',
   !/handleHazardsSummary/.test(smokeBody + perimBody + firmsBody));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
