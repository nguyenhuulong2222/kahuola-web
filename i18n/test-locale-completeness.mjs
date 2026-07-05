// test-locale-completeness.mjs — audit i18n key coverage across all 6 locales.
// Slices each locale block from the source and diffs its key set against EN.
// Focus: Phase A/B volcanic + card.snapshot keys. Run:
//   node i18n/test-locale-completeness.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'kahuola-i18n.js'), 'utf8');

const LOCALES = ['en', 'vi', 'haw', 'tl', 'ilo', 'ja'];
// Start offset of each `    <loc>: {` block, in file order.
const starts = LOCALES.map(loc => ({ loc, idx: src.indexOf(`\n    ${loc}: {`) }));
starts.forEach((s, i) => { s.end = i + 1 < starts.length ? starts[i + 1].idx : src.length; });

function keysOf(block) {
  const set = new Set();
  const re = /"([a-zA-Z0-9_.]+)":/g;
  let m;
  while ((m = re.exec(block))) set.add(m[1]);
  return set;
}

const keysByLocale = {};
for (const s of starts) keysByLocale[s.loc] = keysOf(src.slice(s.idx, s.end));

const en = keysByLocale.en;
// The keys this task cares about (Phase A/B).
const FOCUS = [...en].filter(k =>
  k.startsWith('card.snapshot.') || k.startsWith('hero.') && k.includes('volcanic') ||
  k.includes('.vog') || k === 'kupuna.link.hvo' || k === 'kupuna.link.aqi' ||
  k === 'map.popup_volcanic_zone').sort();

console.log(`EN total keys: ${en.size}`);
console.log(`Focus (volcanic/VOG/card.snapshot) keys in EN: ${FOCUS.length}\n`);

let fail = 0;
console.log('| locale | total | missing-vs-EN | focus-missing |');
console.log('|--------|-------|---------------|---------------|');
const missingReport = {};
for (const loc of LOCALES) {
  const set = keysByLocale[loc];
  const missing = [...en].filter(k => !set.has(k));
  const focusMissing = FOCUS.filter(k => !set.has(k));
  missingReport[loc] = { missing, focusMissing };
  console.log(`| ${loc.padEnd(6)} | ${String(set.size).padEnd(5)} | ${String(missing.length).padEnd(13)} | ${focusMissing.length} |`);
}

// VI must be 100% complete on focus keys.
const viFocusMissing = missingReport.vi.focusMissing;
console.log(`\nVI focus-missing (must be 0): ${viFocusMissing.length}` + (viFocusMissing.length ? ' → ' + viFocusMissing.join(', ') : ''));
if (viFocusMissing.length) fail = 1;

for (const loc of ['haw', 'tl', 'ilo', 'ja']) {
  const fm = missingReport[loc].focusMissing;
  console.log(`\n${loc} focus-missing (${fm.length}):`);
  fm.forEach(k => console.log('  - ' + k));
}

console.log(`\n${fail ? 'AUDIT FAIL (VI incomplete)' : 'AUDIT OK (VI complete; HAW/TL/ILO/JA gaps listed above)'}`);
process.exit(0);
