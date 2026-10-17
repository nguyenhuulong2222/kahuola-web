#!/usr/bin/env node
// generate-brief.mjs — Kahu Ola morning brief (6:00 HST).
//
// Doctrine: "Layer A owns truth, Layer B owns words."
//   Layer A = the summary endpoint + a deterministic TEMPLATE engine. It owns
//             every number and every fact. No AI ever produces a public number.
//   Layer B = an OPTIONAL Gemma polish that may only rephrase the template.
//             It is gated: any new number, any banned word, or a missing
//             disclaimer/freshness line → REJECT and fall back to the template.
//
// Fail-closed: fetch failure / weird JSON → a DEGRADED template brief (never
// silence). The 6:00 HST brief must ship on time — Gemma timeout is a normal,
// designed outcome that yields the template, not an error.
//
// Usage:
//   node generate-brief.mjs            # live: fetch → template → gemma(gated) → JSON
//   node generate-brief.mjs --no-gemma # template only (no Ollama call)
//   node generate-brief.mjs --test     # run fixture gate + branch tests, exit
//
// Output: JSON {brief_en, brief_vi, generated_at, source, degraded} to stdout
// and to scripts/insights/brief-latest.json.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUMMARY_URL = 'https://kahuola.org/api/hazards/summary';
// OLLAMA_URL = base (default localhost); in the n8n container pass
// OLLAMA_URL=http://host.docker.internal:11434. BRIEF_OUTPUT_DIR overrides where
// brief-latest.json is written (default = script dir), for the assets deploy.
// (Ported from the n8n assets fork, SAT-0b-4: the repo copy is the single
// source of truth and scripts/sync-brief.sh copies it to the assets folder.)
const OLLAMA_BASE = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
const OLLAMA_GEN = `${OLLAMA_BASE}/api/generate`;
const OUTPUT_DIR = process.env.BRIEF_OUTPUT_DIR || HERE;
const FB_MAX = 480;                       // Facebook compact-variant hard length gate
const OLLAMA_MODEL = 'gemma4:e4b';
const FETCH_TIMEOUT_MS = 8000;
const GEMMA_TIMEOUT_MS = 30000;          // hard cap; timeout → template (by design)
const LIVE_MAP = 'kahuola.org/live-map';
const SOURCES_LINE = 'NASA FIRMS / NOAA HMS / NIFC WFIGS';

// ── Blocklist (case-insensitive substrings; roots catch inflections) ─────────
// The AI must never invent evacuation / eruption / official-order language.
const BLOCKLIST = [
  'evacuat',        // evacuate / evacuation / evacuating
  'erupt',          // erupting / eruption / erupts
  'sơ tán',
  'di tản',
  'phun trào',
  'official order',
  'lệnh sơ tán',
];

// ── HST helpers (Hawaiʻi = UTC-10, no DST) ───────────────────────────────────
function hstParts(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Pacific/Honolulu', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const hh = f.find((p) => p.type === 'hour').value;
  const mm = f.find((p) => p.type === 'minute').value;
  return { hh, mm, hhmm: `${hh}:${mm}` };
}

// ── Summary fetch (fail-closed) ──────────────────────────────────────────────
async function fetchSummary() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(SUMMARY_URL, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`http ${r.status}`);
    const j = await r.json();
    if (!j || typeof j !== 'object' || !j.fire || !j.smoke || !j.perimeters) throw new Error('shape');
    return { ok: true, data: j };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

// Normalize a source count to a finite integer (redacted/missing → 0 for wording,
// but status is what drives "delayed"). Never fabricate.
function num(x) { return (typeof x === 'number' && Number.isFinite(x)) ? x : 0; }

// Which named sources are delayed/unavailable (for the degraded note).
function delayedSources(d) {
  const out = [];
  const bad = (s) => s === 'unavailable' || s === 'miss';
  if (bad(d.fire?.status)) out.push('NASA FIRMS');
  if (bad(d.smoke?.status)) out.push('NOAA HMS');
  if (bad(d.perimeters?.status)) out.push('NIFC WFIGS');
  return out;
}

// ── Template engine (Layer A → words; NO AI) ─────────────────────────────────
// Returns { brief_en, brief_vi, allowedInts, generated_at }.
// SAT-0b-4. FIRMS unavailable is its own state, never 0: the summary sends
// count null + status "unavailable" (and a pre-0b-2 Worker sent count 0 +
// status "miss"). Either way there is no number to report.
function fireIsUnavailable(d) {
  const st = d.fire?.status;
  return st === 'unavailable' || st === 'miss' || !Number.isFinite(d.fire?.count);
}

function buildTemplate(d) {
  // SAT-0b-4. One satellite down = real but reduced coverage: still reported,
  // with a line saying so. Unavailable = no number at all.
  const fireDown = fireIsUnavailable(d);
  const firePartial = !fireDown && d.fire?.health === 'partial';
  const fire = num(d.fire?.count);
  const volcanic = num(d.fire?.volcanic_zone_count);
  const wildland = Number.isFinite(d.fire?.wildland_count) ? d.fire.wildland_count : Math.max(0, fire - volcanic);
  const smokeN = num(d.smoke?.count);
  const perim = num(d.perimeters?.count);
  const hp = hstParts(d.generated_at) || { hh: '--', mm: '--', hhmm: '--:--' };
  const stale = d.stale === true || d.degraded === true;
  const delayed = delayedSources(d);

  // Numbers the brief is ALLOWED to contain (used by the Gemma gate). Includes
  // the HST hour/minute so a valid brief never trips the number check.
  const allowedInts = new Set([fire, volcanic, wildland, smokeN, perim,
    parseInt(hp.hh, 10), parseInt(hp.mm, 10)].filter((n) => Number.isFinite(n)));

  // Fire/heat bullet — unavailable, then three branches (volcanic / wildfire / clear).
  let heatEn, heatVi;
  if (fireDown) {
    heatEn = '⚠ Satellite heat: NASA FIRMS fire data is unavailable right now — this is not a "no fire" reading. Check the Live Map and official sources.';
    heatVi = '⚠ Nhiệt vệ tinh: hiện không có dữ liệu cháy NASA FIRMS — điều này KHÔNG có nghĩa là không có cháy. Hãy xem Live Map và nguồn chính thức.';
  } else if (fire === 0) {
    heatEn = '✅ Satellite heat: no fire or heat detections in the current statewide snapshot.';
    heatVi = '✅ Nhiệt vệ tinh: không có tín hiệu cháy hay nhiệt nào trong ảnh chụp toàn bang hiện tại.';
  } else if (wildland === 0 && volcanic > 0) {
    heatEn = `🌋 Satellite heat: ${volcanic} detection(s) in the Kīlauea/Mauna Loa volcanic zone — likely volcanic activity, not a wildfire.`;
    heatVi = `🌋 Nhiệt vệ tinh: ${volcanic} tín hiệu trong vùng núi lửa Kīlauea/Mauna Loa — có thể là hoạt động núi lửa, không phải cháy rừng.`;
  } else {
    const extraEn = volcanic > 0 ? ` (${volcanic} more in the Kīlauea/Mauna Loa volcanic zone).` : '.';
    const extraVi = volcanic > 0 ? ` (${volcanic} tín hiệu khác trong vùng núi lửa Kīlauea/Mauna Loa).` : '.';
    heatEn = `🔥 Satellite heat: ${wildland} detection(s) outside volcanic zones — possible wildfire signals${extraEn}`;
    heatVi = `🔥 Nhiệt vệ tinh: ${wildland} tín hiệu ngoài vùng núi lửa — có thể là dấu hiệu cháy rừng${extraVi}`;
  }
  const partialEn = 'One satellite is temporarily unavailable, so coverage is reduced.';
  const partialVi = 'Một vệ tinh tạm thời không khả dụng, nên phạm vi quan sát bị giảm.';
  if (firePartial) { heatEn += ` ${partialEn}`; heatVi += ` ${partialVi}`; }

  // Smoke bullet — adds a vog/air-quality note in the volcanic branch.
  const volcanicBranch = !fireDown && fire > 0 && wildland === 0 && volcanic > 0;
  // SAT-0a-2 D. Wording follows smoke.status, never present/count: count 0 is
  // either "nothing outlined" (which does not rule out smoke) or an outage.
  const smokeSt = d.smoke?.status;
  let smokeEn = smokeSt === 'detected'
    ? `💨 Smoke: NOAA HMS is showing smoke over parts of Hawaiʻi.`
    : smokeSt === 'none'
      ? `💨 Smoke: none outlined by NOAA analysts near Hawaiʻi (this does not rule out smoke).`
      : `💨 Smoke: NOAA HMS data unavailable.`;
  let smokeVi = smokeSt === 'detected'
    ? `💨 Khói: NOAA HMS đang ghi nhận khói trên một số khu vực Hawaiʻi.`
    : smokeSt === 'none'
      ? `💨 Khói: chuyên viên NOAA chưa khoanh vùng khói gần Hawaiʻi (không loại trừ khả năng có khói).`
      : `💨 Khói: chưa có dữ liệu NOAA HMS.`;
  if (volcanicBranch) {
    smokeEn += ' Volcanic smog (vog) can still affect air quality — check the Air Quality layer.';
    smokeVi += ' Khói núi lửa (vog) vẫn có thể ảnh hưởng chất lượng không khí — hãy xem lớp Air Quality.';
  }

  const perimEn = `🗺️ Official fire perimeters: ${perim} active (NIFC WFIGS).`;
  const perimVi = `🗺️ Ranh giới cháy chính thức: ${perim} đang hoạt động (NIFC WFIGS).`;

  // Freshness + optional delayed note.
  let freshEn = `Data as of ${hp.hhmm} HST · sources: ${SOURCES_LINE}.`;
  let freshVi = `Dữ liệu tính đến ${hp.hhmm} HST · nguồn: ${SOURCES_LINE}.`;
  if (stale) {
    const which = delayed.length ? delayed.join(', ') : SOURCES_LINE;
    freshEn += ` ⚠ Some data may be delayed (${which}).`;
    freshVi += ` ⚠ Một số dữ liệu có thể bị trễ (${which}).`;
  }

  const discEn = 'Situational awareness only — this does not replace official emergency directives. Follow NWS, county, and HI-EMA guidance.';
  const discVi = 'Chỉ để nhận thức tình huống — không thay thế chỉ đạo khẩn cấp chính thức. Hãy theo hướng dẫn của NWS, quận, và HI-EMA.';
  const linkEn = `Live map: ${LIVE_MAP}`;
  const linkVi = `Bản đồ trực tiếp: ${LIVE_MAP}`;

  const brief_en = [`Kahu Ola — Hawaiʻi morning hazard brief`, heatEn, smokeEn, perimEn, freshEn, discEn, linkEn].join('\n');
  const brief_vi = [`Kahu Ola — Bản tin hiểm họa buổi sáng Hawaiʻi`, heatVi, smokeVi, perimVi, freshVi, discVi, linkVi].join('\n');

  // ── Facebook compact variant (public channel) — TEMPLATE ONLY, no AI. ──
  // ≤480 chars; carries exact numbers + volcanic wording + short disclaimer +
  // link. Ported from the n8n assets fork (SAT-0b-4) with the SAT-0a-2 smoke
  // rule (status, never present) and the SAT-0b-4 fire states.
  const icon = fireDown ? '⚠' : fire === 0 ? '✅' : (wildland === 0 && volcanic > 0) ? '🌋' : '🔥';
  const sigWord = (n) => (n === 1 ? 'signal' : 'signals');   // real EN plural
  let fbHeatEn, fbHeatVi;
  if (fireDown) {
    fbHeatEn = 'Satellite fire data (NASA FIRMS) is unavailable right now — this is not a "no fire" reading.';
    fbHeatVi = 'Hiện không có dữ liệu cháy vệ tinh (NASA FIRMS) — điều này KHÔNG có nghĩa là không có cháy.';
  } else if (fire === 0) {
    fbHeatEn = 'No satellite fire or heat detections statewide right now.';
    fbHeatVi = 'Hiện không có tín hiệu cháy hay nhiệt vệ tinh nào trên toàn bang.';
  } else if (wildland === 0 && volcanic > 0) {
    fbHeatEn = `${volcanic} satellite heat ${sigWord(volcanic)} in the Kīlauea/Mauna Loa volcanic zone — likely volcanic activity, not a wildfire. Vog may affect air quality.`;
    fbHeatVi = `${volcanic} tín hiệu nhiệt vệ tinh ở vùng núi lửa Kīlauea/Mauna Loa — có thể là hoạt động núi lửa, không phải cháy rừng. Vog có thể ảnh hưởng chất lượng không khí.`;
  } else {
    const exEn = volcanic > 0 ? ` +${volcanic} in the volcanic zone.` : '';
    const exVi = volcanic > 0 ? ` +${volcanic} trong vùng núi lửa.` : '';
    fbHeatEn = `${wildland} satellite heat ${sigWord(wildland)} outside volcanic zones — possible wildfire signals.${exEn}`;
    fbHeatVi = `${wildland} tín hiệu nhiệt vệ tinh ngoài vùng núi lửa — có thể là dấu hiệu cháy rừng.${exVi}`;
  }
  if (firePartial) { fbHeatEn += ` ${partialEn}`; fbHeatVi += ` ${partialVi}`; }
  const fbSmokeEn = smokeSt === 'detected' ? 'outlined' : smokeSt === 'none' ? 'none outlined' : 'data unavailable';
  const fbSmokeVi = smokeSt === 'detected' ? 'có khoanh vùng' : smokeSt === 'none' ? 'chưa khoanh vùng' : 'chưa có dữ liệu';
  const fbStatsEn = `🗺️ Official fire perimeters: ${perim}. Smoke: ${fbSmokeEn}.`;
  const fbStatsVi = `🗺️ Ranh giới cháy chính thức: ${perim}. Khói: ${fbSmokeVi}.`;
  const fbStaleEn = stale ? ` ⚠ Some data delayed (${delayed.length ? delayed.join(', ') : SOURCES_LINE}).` : '';
  const fbStaleVi = stale ? ` ⚠ Dữ liệu có thể bị trễ (${delayed.length ? delayed.join(', ') : SOURCES_LINE}).` : '';
  const brief_fb_en = [
    `${icon} Kahu Ola — ${hp.hhmm} HST`,
    fbHeatEn,
    fbStatsEn + fbStaleEn,
    `Situational awareness only — follow official guidance. ${LIVE_MAP}`,
  ].join('\n');
  const brief_fb_vi = [
    `${icon} Kahu Ola — ${hp.hhmm} HST`,
    fbHeatVi,
    fbStatsVi + fbStaleVi,
    `Chỉ để nhận thức tình huống — theo hướng dẫn chính thức. ${LIVE_MAP}`,
  ].join('\n');

  return { brief_en, brief_vi, brief_fb_en, brief_fb_vi, allowedInts, generated_at: d.generated_at, fireDown, firePartial };
}

// Degraded brief — fetch failed / unusable JSON. Still a real brief, never silent.
function degradedTemplate(nowIso) {
  const brief_en = [
    'Kahu Ola — Hawaiʻi morning hazard brief',
    "⚠ We could not load this morning's snapshot data — please check the Live Map and official sources directly.",
    'Situational awareness only — this does not replace official emergency directives. Follow NWS, county, and HI-EMA guidance.',
    `Live map: ${LIVE_MAP}`,
  ].join('\n');
  const brief_vi = [
    'Kahu Ola — Bản tin hiểm họa buổi sáng Hawaiʻi',
    '⚠ Không lấy được dữ liệu snapshot sáng nay — hãy xem Live Map và nguồn chính thức.',
    'Chỉ để nhận thức tình huống — không thay thế chỉ đạo khẩn cấp chính thức. Hãy theo hướng dẫn của NWS, quận, và HI-EMA.',
    `Bản đồ trực tiếp: ${LIVE_MAP}`,
  ].join('\n');
  const brief_fb_en = `⚠ Kahu Ola — this morning's snapshot data is unavailable. Check the Live Map and official sources. Situational awareness only — follow official guidance. ${LIVE_MAP}`;
  const brief_fb_vi = `⚠ Kahu Ola — không lấy được dữ liệu snapshot sáng nay. Xem Live Map và nguồn chính thức. Chỉ để nhận thức tình huống — theo hướng dẫn chính thức. ${LIVE_MAP}`;
  return { brief_en, brief_vi, brief_fb_en, brief_fb_vi, generated_at: nowIso };
}

// ── Validation gate (applied ONLY to Gemma output) ───────────────────────────
// Returns { ok, reason }. Any failure → caller uses the template.
function validateGemma(text, { allowedInts, lang }) {
  if (typeof text !== 'string') return { ok: false, reason: 'not_a_string' };
  const t = text.trim();
  if (t.length < 200 || t.length > 1200) return { ok: false, reason: `length_${t.length}` };

  // a. every digit-run must be an allowed value (counts + HST hour/minute).
  const nums = t.match(/\d+/g) || [];
  for (const n of nums) {
    if (!allowedInts.has(parseInt(n, 10))) return { ok: false, reason: `foreign_number_${n}` };
  }
  // b. blocklist (case-insensitive substring).
  const low = t.toLowerCase();
  for (const w of BLOCKLIST) {
    if (low.includes(w)) return { ok: false, reason: `blocked_word_${w}` };
  }
  // c. required markers: freshness (HST), disclaimer, link.
  if (!/\bHST\b/.test(t)) return { ok: false, reason: 'missing_freshness' };
  if (!t.includes(LIVE_MAP)) return { ok: false, reason: 'missing_link' };
  const hasDisc = lang === 'vi'
    ? (/nhận thức tình huống/i.test(t) || /không thay thế/i.test(t))
    : /situational awareness/i.test(t);
  if (!hasDisc) return { ok: false, reason: 'missing_disclaimer' };
  return { ok: true, reason: null };
}

// ── Gemma polish (Layer B) — one call per language, gated ────────────────────
async function gemmaOne(templateText, lang, allowedInts) {
  const sys =
    'You rewrite a civic hazard brief to read more naturally. STRICT RULES: ' +
    'keep EVERY number exactly as given; do not add, remove, or change any number; ' +
    'do not add new facts, locations, or recommendations; never mention evacuation, ' +
    'eruption, or official orders; keep the final three lines (the "Data as of … HST" ' +
    'line, the disclaimer line, and the "Live map"/"Bản đồ" link) verbatim. ' +
    'Return ONLY the rewritten brief text, same language, no preamble.';
  const prompt = `${sys}\n\n---\n${templateText}\n---`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), GEMMA_TIMEOUT_MS);
  try {
    const r = await fetch(OLLAMA_GEN, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false, keep_alive: '24h',
        options: { temperature: 0.2 } }),
    });
    if (!r.ok) return { ok: false, reason: `gemma_http_${r.status}` };
    const j = await r.json();
    const out = (j && typeof j.response === 'string') ? j.response.trim() : '';
    const v = validateGemma(out, { allowedInts, lang });
    return v.ok ? { ok: true, text: out } : { ok: false, reason: v.reason };
  } catch (e) {
    const msg = String(e && e.name === 'AbortError' ? 'gemma_timeout' : (e && e.message || e));
    return { ok: false, reason: msg };
  } finally {
    clearTimeout(t);
  }
}

// Polish both languages; if EITHER fails the gate, use the template for BOTH
// (keeps EN/VI consistent). Returns { source, reason, en, vi }.
async function gemmaPolish(tmpl) {
  const en = await gemmaOne(tmpl.brief_en, 'en', tmpl.allowedInts);
  if (!en.ok) return { source: 'template', reason: `en:${en.reason}` };
  const vi = await gemmaOne(tmpl.brief_vi, 'vi', tmpl.allowedInts);
  if (!vi.ok) return { source: 'template', reason: `vi:${vi.reason}` };
  return { source: 'gemma', reason: null, en: en.text, vi: vi.text };
}

// SAT-0b-4. Channel flags, pure so they are testable.
//   degraded     — read by n8n "IF: Post to FB? (not degraded)": true ONLY
//                  when fire data is unavailable (ruling), so Facebook skips.
//   data_delayed — the old meaning: any source stale / summary degraded.
//   skipGemma    — fire unavailable: the AI rewrite is not allowed to touch it.
function channelFlags(tmpl, data) {
  return {
    degraded: tmpl.fireDown === true,
    data_delayed: data.stale === true || data.degraded === true,
    skipGemma: tmpl.fireDown === true,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main(argv) {
  const noGemma = argv.includes('--no-gemma');
  const nowIso = new Date().toISOString();

  const res = await fetchSummary();
  let out;
  if (!res.ok) {
    const dt = degradedTemplate(nowIso);
    // brief_fb_* are ALWAYS template (no AI on the public channel).
    out = { brief_en: dt.brief_en, brief_vi: dt.brief_vi, brief_fb_en: dt.brief_fb_en, brief_fb_vi: dt.brief_fb_vi,
      generated_at: dt.generated_at, source: 'template', degraded: true, data_delayed: true, reason: `fetch:${res.error}` };
  } else {
    const tmpl = buildTemplate(res.data);
    // SAT-0b-4 ruling. `degraded` is what the n8n Facebook gate reads ("IF:
    // Post to FB? (not degraded)"): Facebook is skipped ONLY when fire data is
    // unavailable. One satellite down still posts, with the reduced-coverage
    // line; a delayed smoke/perimeter source still posts, with its delay note.
    // The old meaning (any source delayed) moves to data_delayed.
    const { degraded, data_delayed, skipGemma } = channelFlags(tmpl, res.data);
    let source = 'template', reason = null;
    let brief_en = tmpl.brief_en, brief_vi = tmpl.brief_vi;
    if (skipGemma) {
      // The Gemma gate checks numbers, length and markers, not meaning: a
      // rewrite could turn "unavailable" into "no fire". Template only.
      reason = 'fire_unavailable_template_only';
    } else if (!noGemma) {
      const g = await gemmaPolish(tmpl);
      if (g.source === 'gemma') { source = 'gemma'; brief_en = g.en; brief_vi = g.vi; }
      else reason = g.reason;              // stayed template; log why
    } else {
      reason = 'no_gemma_flag';
    }
    // brief_fb_* are ALWAYS the template variant (never AI-touched).
    out = { brief_en, brief_vi, brief_fb_en: tmpl.brief_fb_en, brief_fb_vi: tmpl.brief_fb_vi,
      generated_at: tmpl.generated_at, source, degraded, data_delayed,
      fire_status: tmpl.fireDown ? 'unavailable' : (res.data.fire?.status ?? null),
      fire_health: res.data.fire?.health ?? null };
    if (reason) out.reason = reason;
  }

  const file = join(OUTPUT_DIR, 'brief-latest.json');
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify(out) + '\n');
  return out;
}

// ── Fixture tests (node generate-brief.mjs --test) ───────────────────────────
function runTests() {
  let pass = 0, fail = 0;
  const ok = (n, c) => { c ? (pass++, console.log('PASS — ' + n)) : (fail++, console.log('FAIL — ' + n)); };

  // Branch fixtures → template engine.
  const base = { generated_at: '2026-07-05T16:00:00.000Z', stale: false,
    smoke: { present: false, count: 0, status: 'none' },
    perimeters: { count: 0, status: 'none' } };
  const volc = buildTemplate({ ...base, fire: { count: 25, volcanic_zone_count: 25, wildland_count: 0, status: 'detected' } });
  ok('volcanic branch: EN says volcanic activity not wildfire', /volcanic activity, not a wildfire/.test(volc.brief_en));
  ok('volcanic branch: VI says hoạt động núi lửa không phải cháy rừng', /hoạt động núi lửa, không phải cháy rừng/.test(volc.brief_vi));
  ok('volcanic branch: mentions vog', /vog/i.test(volc.brief_en) && /vog/i.test(volc.brief_vi));

  const wild = buildTemplate({ ...base, fire: { count: 3, volcanic_zone_count: 1, wildland_count: 2, status: 'detected' } });
  ok('wildfire branch: EN possible wildfire signals', /possible wildfire signals/.test(wild.brief_en));
  ok('wildfire branch: allowed ints include 2,1,3', wild.allowedInts.has(2) && wild.allowedInts.has(1));

  const clear = buildTemplate({ ...base, fire: { count: 0, volcanic_zone_count: 0, wildland_count: 0, status: 'none' } });
  ok('all-clear branch: EN no detections', /no fire or heat detections/.test(clear.brief_en));

  const smokey = buildTemplate({ ...base, fire: { count: 0, volcanic_zone_count: 0, wildland_count: 0, status: 'none' }, smoke: { present: true, count: 4, status: 'detected' } });
  ok('smoke branch: EN shows smoke', /showing smoke/.test(smokey.brief_en));
  // SAT-0a-2: none is "not outlined", never "no smoke"; anything else is unavailable.
  const smokeNone = buildTemplate({ ...base, fire: { count: 0, volcanic_zone_count: 0, wildland_count: 0, status: 'none' } });
  ok('smoke none: EN does not rule out smoke', /none outlined by NOAA analysts.*does not rule out smoke/.test(smokeNone.brief_en));
  ok('smoke none: VI không loại trừ', /không loại trừ khả năng có khói/.test(smokeNone.brief_vi));
  const smokeDown = buildTemplate({ ...base, fire: { count: 0, volcanic_zone_count: 0, wildland_count: 0, status: 'none' }, smoke: { present: false, count: 0, status: 'unavailable' } });
  ok('smoke unavailable: EN says unavailable', /NOAA HMS data unavailable/.test(smokeDown.brief_en) && !/none/i.test(smokeDown.brief_en.split('\n').find((l) => l.includes('💨'))));
  const smokeMiss = buildTemplate({ ...base, fire: { count: 0, volcanic_zone_count: 0, wildland_count: 0, status: 'none' }, smoke: { present: false, count: 0, status: 'miss' } });
  ok('smoke miss: VI chưa có dữ liệu', /chưa có dữ liệu NOAA HMS/.test(smokeMiss.brief_vi));

  const staleT = buildTemplate({ ...base, stale: true, fire: { count: 0, volcanic_zone_count: 0, wildland_count: 0, status: 'unavailable' } });
  ok('stale branch: names delayed source', /delayed \(NASA FIRMS\)/.test(staleT.brief_en) && /bị trễ \(NASA FIRMS\)/.test(staleT.brief_vi));

  const deg = degradedTemplate('2026-07-05T16:00:00.000Z');
  ok('degraded template: VI fixed sentence', /Không lấy được dữ liệu snapshot sáng nay/.test(deg.brief_vi));

  // Gate fixtures. allowedInts from the volcanic case: {25, 6, 0} (16:00 UTC = 06:00 HST).
  const A = volc.allowedInts;
  ok('gate: valid gemma output passes',
    validateGemma('Kahu Ola morning brief. Satellite heat: 25 detections in the Kīlauea/Mauna Loa volcanic zone — likely volcanic activity, not a wildfire. Smoke: none. Volcanic smog (vog) can affect air quality. Official fire perimeters: 0 active. Data as of 06:00 HST · sources: NASA FIRMS / NOAA HMS / NIFC WFIGS. Situational awareness only — does not replace official emergency directives. Live map: kahuola.org/live-map', { allowedInts: A, lang: 'en' }).ok);
  ok('gate: REJECT foreign number (7)',
    validateGemma('Satellite heat: 25 detections and 7 new fires in the Kīlauea/Mauna Loa volcanic zone. Data as of 06:00 HST. Situational awareness only. Live map: kahuola.org/live-map. Padding padding padding padding padding padding padding padding padding padding padding.', { allowedInts: A, lang: 'en' }).reason?.startsWith('foreign_number'));
  ok('gate: REJECT blocked word (evacuation)',
    validateGemma('Satellite heat: 25 detections in the Kīlauea/Mauna Loa volcanic zone. An evacuation may be needed. Data as of 06:00 HST. situational awareness only. Live map: kahuola.org/live-map. padding padding padding padding padding padding padding padding.', { allowedInts: A, lang: 'en' }).reason === 'blocked_word_evacuat');
  ok('gate: REJECT blocked word VI (sơ tán)',
    validateGemma('Nhiệt vệ tinh: 25 tín hiệu trong vùng núi lửa Kīlauea/Mauna Loa. Có thể cần sơ tán. Dữ liệu tính đến 06:00 HST. nhận thức tình huống. Bản đồ: kahuola.org/live-map. đệm đệm đệm đệm đệm đệm đệm đệm đệm đệm đệm đệm.', { allowedInts: A, lang: 'vi' }).reason === 'blocked_word_sơ tán');
  ok('gate: REJECT missing disclaimer',
    validateGemma('Satellite heat: 25 detections in the Kīlauea/Mauna Loa volcanic zone — likely volcanic activity, not a wildfire. Official fire perimeters: 0 active. Data as of 06:00 HST · sources listed. Live map: kahuola.org/live-map. padding padding padding padding padding padding.', { allowedInts: A, lang: 'en' }).reason === 'missing_disclaimer');
  ok('gate: REJECT too short',
    validateGemma('25 in the volcanic zone. 06:00 HST. situational awareness. kahuola.org/live-map', { allowedInts: A, lang: 'en' }).reason?.startsWith('length'));
  ok('gate: REJECT missing freshness (no HST)',
    validateGemma('Satellite heat: 25 detections in the Kīlauea/Mauna Loa volcanic zone — likely volcanic activity, not a wildfire. Official fire perimeters: 0 active. situational awareness only — does not replace official directives. Live map: kahuola.org/live-map. padding padding padding padding padding.', { allowedInts: A, lang: 'en' }).reason === 'missing_freshness');
  ok('gate: valid brief with legit HST time digits is NOT rejected as foreign',
    validateGemma('Kahu Ola. Satellite heat: 0 detections in the current snapshot. Smoke: none. Official fire perimeters: 0 active. Data as of 06:00 HST · sources: NASA FIRMS / NOAA HMS / NIFC WFIGS. Situational awareness only — does not replace official emergency directives. Live map: kahuola.org/live-map', { allowedInts: buildTemplate({ ...base, fire: { count: 0, volcanic_zone_count: 0, wildland_count: 0, status: 'none' } }).allowedInts, lang: 'en' }).ok);


  // ── Facebook variant fixtures (ported from the n8n assets fork) ────────────
  const fbLen = (o) => Math.max(o.brief_fb_en.length, o.brief_fb_vi.length);
  ok(`FB length gate: volcanic ≤${FB_MAX} (en ${volc.brief_fb_en.length}/vi ${volc.brief_fb_vi.length})`, fbLen(volc) <= FB_MAX);
  ok(`FB length gate: wildfire ≤${FB_MAX}`, fbLen(wild) <= FB_MAX);
  ok(`FB length gate: all-clear ≤${FB_MAX}`, fbLen(clear) <= FB_MAX);
  const worst = buildTemplate({ ...base, stale: true,
    fire: { count: 99, volcanic_zone_count: 11, wildland_count: 88, status: 'detected', health: 'partial' },
    smoke: { present: true, count: 12, status: 'unavailable' },
    perimeters: { count: 34, status: 'unavailable' } });
  ok(`FB length gate: WORST (wildfire +volcanic, partial, 2 delayed) ≤${FB_MAX} (en ${worst.brief_fb_en.length}/vi ${worst.brief_fb_vi.length})`, fbLen(worst) <= FB_MAX);
  ok('FB volcanic: VI wording + count + link', /🌋/.test(volc.brief_fb_vi) && /có thể là hoạt động núi lửa, không phải cháy rừng/.test(volc.brief_fb_vi) && volc.brief_fb_vi.includes('25') && volc.brief_fb_vi.includes(LIVE_MAP));
  ok('FB volcanic: never asserts eruption', !/erupt/i.test(volc.brief_fb_en) && !/phun trào/.test(volc.brief_fb_vi));
  ok('FB wildfire: fire icon + counts', /🔥/.test(wild.brief_fb_en) && wild.brief_fb_en.includes('2') && wild.brief_fb_en.includes('1'));
  ok('FB all-clear: check icon only when fire answered none', /✅/.test(clear.brief_fb_en));
  ok('FB smoke follows status (none → "none outlined", never "none")', /Smoke: none outlined\./.test(clear.brief_fb_en) && /Khói: chưa khoanh vùng\./.test(clear.brief_fb_vi));
  const fbDeg = degradedTemplate('2026-07-05T16:00:00.000Z');
  ok('FB degraded (fetch failed): disclaimer + link', /Situational awareness only/.test(fbDeg.brief_fb_en) && fbDeg.brief_fb_vi.includes(LIVE_MAP));

  // ── SAT-0b-4: fire unavailable is never "no fire" ──────────────────────────
  const fdown = buildTemplate({ ...base, degraded: true, fire: { count: null, volcanic_zone_count: null, wildland_count: null, status: 'unavailable', health: 'unavailable' } });
  for (const [k, txt] of [['brief_en', fdown.brief_en], ['brief_fb_en', fdown.brief_fb_en]]) {
    ok(`fire unavailable: ${k} has no ✅ and no "no … detections"`, !/✅/.test(txt) && !/no (satellite )?fire or heat detections/i.test(txt) && !/No satellite fire/i.test(txt));
  }
  ok('fire unavailable: EN says unavailable, not a "no fire" reading', /fire data is unavailable/.test(fdown.brief_en) && /not a "no fire" reading/.test(fdown.brief_en));
  ok('fire unavailable: VI KHÔNG có nghĩa là không có cháy', /KHÔNG có nghĩa là không có cháy/.test(fdown.brief_vi) && /KHÔNG có nghĩa là không có cháy/.test(fdown.brief_fb_vi));
  ok('fire unavailable: VI has no "không có tín hiệu cháy"', !/không có tín hiệu cháy/.test(fdown.brief_vi) && !/không có tín hiệu cháy/.test(fdown.brief_fb_vi));
  ok('fire unavailable: FB icon ⚠', fdown.brief_fb_en.startsWith('⚠') && fdown.brief_fb_vi.startsWith('⚠'));
  ok(`fire unavailable: FB ≤${FB_MAX}`, fbLen(fdown) <= FB_MAX);
  const fmiss = buildTemplate({ ...base, degraded: true, fire: { count: 0, volcanic_zone_count: 0, wildland_count: 0, status: 'miss' } });
  ok('fire "miss" (pre-0b-2 Worker, count 0) is also unavailable, not ✅', fmiss.fireDown && !/✅/.test(fmiss.brief_en) && !/✅/.test(fmiss.brief_fb_en));

  // ── SAT-0b-4: one satellite down still reports, and says so ────────────────
  const fpart = buildTemplate({ ...base, degraded: true, fire: { count: 3, volcanic_zone_count: 1, wildland_count: 2, status: 'detected', health: 'partial' } });
  ok('partial: still reports the counts', /2 detection\(s\) outside volcanic zones/.test(fpart.brief_en) && fpart.brief_fb_en.includes('2'));
  ok('partial: EN + VI reduced-coverage line in brief and FB',
     /coverage is reduced/.test(fpart.brief_en) && /coverage is reduced/.test(fpart.brief_fb_en) &&
     /phạm vi quan sát bị giảm/.test(fpart.brief_vi) && /phạm vi quan sát bị giảm/.test(fpart.brief_fb_vi));
  const fpartNone = buildTemplate({ ...base, degraded: true, fire: { count: 0, volcanic_zone_count: 0, wildland_count: 0, status: 'none', health: 'partial' } });
  ok('partial + zero: the ✅ line carries the reduced-coverage caveat', /✅/.test(fpartNone.brief_en) && /coverage is reduced/.test(fpartNone.brief_en));

  // ── SAT-0b-4: channel flags (n8n FB gate reads `degraded`) ─────────────────
  ok('flags: fire unavailable → degraded (FB skipped), Gemma skipped', channelFlags(fdown, { degraded: true }).degraded === true && channelFlags(fdown, {}).skipGemma === true);
  ok('flags: one satellite down → NOT degraded (FB still posts)', channelFlags(fpart, { degraded: true }).degraded === false && channelFlags(fpart, { degraded: true }).data_delayed === true);
  const smokeLate = buildTemplate({ ...base, stale: true, fire: { count: 0, volcanic_zone_count: 0, wildland_count: 0, status: 'none' }, smoke: { present: false, count: 0, status: 'unavailable' } });
  ok('flags: only smoke delayed → NOT degraded, data_delayed true', channelFlags(smokeLate, { stale: true }).degraded === false && channelFlags(smokeLate, { stale: true }).data_delayed === true);
  ok('flags: all fine → nothing set', JSON.stringify(channelFlags(clear, {})) === JSON.stringify({ degraded: false, data_delayed: false, skipGemma: false }));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

// Exported for tests / n8n reuse (importing does NOT run the CLI, see guard below).
export { buildTemplate, degradedTemplate, validateGemma, hstParts };

// ── Entry (only when run directly, not when imported) ────────────────────────
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--test')) {
    runTests();
  } else {
    main(argv).catch((e) => { console.error('fatal:', e); process.exit(1); });
  }
}
