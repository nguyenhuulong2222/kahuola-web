#!/usr/bin/env node
// collect-metrics.mjs — monthly Cloudflare Web Analytics snapshot for the
// Kahu Ola impact record (501(c)(3) + grant archive). Git is the immutable
// archive; every number carries source + date. ZERO-PII: aggregates only,
// country is the deepest geographic level.
//
// Doctrine (mirrors generate-brief.mjs): ESM, module-scope, never-throw
// helpers, fail-closed, fixture tests via --test.
//   - Fail-closed: any API error / schema mismatch → write NOTHING, exit ≠ 0.
//     A month with no data is recorded as explicitly "missing" — never a fake 0.
//   - metrics.json is APPEND-ONLY: a finalized month is immutable; only the
//     current (partial) month may be refreshed until it closes.
//   - METRICS.md is fully regenerated from metrics.json (json = source of truth)
//     and merges hand-editable annotations from events.json.
//
// Usage:
//   node collect-metrics.mjs [--month=YYYY-MM]   # default = previous month
//   node collect-metrics.mjs --test              # fixtures, no network
//
// Secrets (never in repo): CF_ANALYTICS_TOKEN / CF_ACCOUNT_ID env, else read
// from ~/.kahuola-secrets/{cf-analytics-token,cf-account-id} (trimmed).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
// Output dir: default = the repo archive (docs/impact). IMPACT_OUTPUT_DIR overrides
// it — used by the n8n container for a scratch VERIFICATION run (proves token +
// query + numbers work); the real append-only archive is committed locally.
function docsDir() { return process.env.IMPACT_OUTPUT_DIR || join(HERE, '..', '..', 'docs', 'impact'); }
function metricsPath() { return join(docsDir(), 'metrics.json'); }
function eventsPath() { return join(docsDir(), 'events.json'); }
function mdPath() { return join(docsDir(), 'METRICS.md'); }

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
// Account-owned token → verify at the ACCOUNT endpoint. The user endpoint
// (/user/tokens/verify) returns Invalid for account-owned tokens — that is
// correct behaviour, not an error, so we must not use it here.
const VERIFY_URL = (acct) => `https://api.cloudflare.com/client/v4/accounts/${acct}/tokens/verify`;
const SITE_TAG = process.env.CF_SITE_TAG || 'e7eea5e964e04af89c1fcbc0b1a4bb67';
const DATASET = 'rumPageloadEventsAdaptiveGroups';   // verified against the live schema
const HTTP_TIMEOUT_MS = 30000;

// Precise labels for the record (so IRS/grant reviewers can't misread them).
const META = {
  source: 'cloudflare-web-analytics',
  dataset: DATASET,
  site_tag: SITE_TAG,
  visits_definition: 'visits (sessions — cookie-free measurement; not unique individuals)',
  page_views_definition: 'page views = count of pageload events; bots excluded by Cloudflare RUM',
  geo_note: 'country is the deepest geographic level collected (Zero-PII: no IP, no user-level data)',
  generated_by: 'scripts/impact/collect-metrics.mjs',
};

// ── secrets (env first, then ~/.kahuola-secrets file; trimmed) ───────────────
function readSecret(envName, fileName) {
  const v = process.env[envName];
  if (v && v.trim()) return v.trim();
  const p = join(homedir(), '.kahuola-secrets', fileName);
  try { return readFileSync(p, 'utf8').trim(); } catch { return ''; }
}

// ── month helpers ────────────────────────────────────────────────────────────
function pad2(n) { return String(n).padStart(2, '0'); }
// Current YYYY-MM in Pacific/Honolulu (the run happens early-month HST).
function currentMonthHST() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Honolulu', year: 'numeric', month: '2-digit' });
  const parts = f.formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  return `${y}-${m}`;
}
function prevMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1)); d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}
// [geq, leq] RFC3339 bounds for a whole month (leq clamped to nowIso if partial).
function monthBounds(ym, nowIso) {
  const [y, m] = ym.split('-').map(Number);
  const geq = `${ym}-01T00:00:00Z`;
  const end = new Date(Date.UTC(y, m, 1)); // first of next month
  const leqFull = new Date(end.getTime() - 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  const leq = (nowIso && nowIso < leqFull) ? nowIso : leqFull;
  return { geq, leq };
}

// ── GraphQL query (verified fields: count, sum{visits}, requestPath, countryName) ──
const GQL = `query($a:String!,$s:String!,$geq:Time!,$leq:Time!){
  viewer{ accounts(filter:{accountTag:$a}){
    totals:${DATASET}(limit:1,filter:{siteTag:$s,datetime_geq:$geq,datetime_leq:$leq}){ count sum{visits} }
    pages:${DATASET}(limit:10,orderBy:[count_DESC],filter:{siteTag:$s,datetime_geq:$geq,datetime_leq:$leq}){ count dimensions{requestPath} }
    countries:${DATASET}(limit:200,orderBy:[count_DESC],filter:{siteTag:$s,datetime_geq:$geq,datetime_leq:$leq}){ count sum{visits} dimensions{countryName} }
  }}
}`;

// Fetch raw analytics for a month. Never throws → {ok, data|error}.
async function fetchAnalytics(token, accountTag, geq, leq) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    // health check on the ACCOUNT verify endpoint (see note above).
    const hv = await fetch(VERIFY_URL(accountTag), { signal: ctrl.signal, headers: { Authorization: `Bearer ${token}` } });
    const hj = await hv.json().catch(() => ({}));
    if (!hj.success || (hj.result && hj.result.status !== 'active')) {
      return { ok: false, error: `token verify failed (status=${hj.result && hj.result.status})` };
    }
    const r = await fetch(GRAPHQL_URL, {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: GQL, variables: { a: accountTag, s: SITE_TAG, geq, leq } }),
    });
    if (!r.ok) return { ok: false, error: `graphql http ${r.status}` };
    const j = await r.json();
    if (j.errors && j.errors.length) return { ok: false, error: `graphql: ${JSON.stringify(j.errors).slice(0, 300)}` };
    return { ok: true, data: j.data };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally { clearTimeout(t); }
}

// ── pure: build a month record from the API data (schema-strict, never fabricates) ──
function buildRecord(apiData, month, collectedAt, isPartial) {
  const accs = apiData && apiData.viewer && apiData.viewer.accounts;
  if (!Array.isArray(accs) || !accs.length) throw new Error('schema: no accounts node');
  const a = accs[0];
  if (!Array.isArray(a.totals) || !Array.isArray(a.pages) || !Array.isArray(a.countries)) {
    throw new Error('schema: missing totals/pages/countries');
  }
  const tot = a.totals[0] || {};
  const pv = tot.count, vis = tot.sum && tot.sum.visits;
  if (typeof pv !== 'number' || typeof vis !== 'number') throw new Error('schema: totals count/visits not numeric');
  const top_pages = a.pages.map((p) => {
    const path = p.dimensions && p.dimensions.requestPath;
    if (typeof path !== 'string' || typeof p.count !== 'number') throw new Error('schema: page row malformed');
    return { path, page_views: p.count };
  });
  const countries = {};
  for (const c of a.countries) {
    const name = c.dimensions && c.dimensions.countryName;
    if (typeof name !== 'string' || typeof c.count !== 'number') throw new Error('schema: country row malformed');
    countries[name] = { page_views: c.count, visits: (c.sum && typeof c.sum.visits === 'number') ? c.sum.visits : null };
  }
  const notes = [];
  if (isPartial) notes.push(`partial month (collected ${collectedAt.slice(0, 10)}; month not yet complete)`);
  return { month, visits: vis, page_views: pv, top_pages, countries, collected_at: collectedAt, source: META.source, notes };
}

// ── pure: append-only merge (finalized immutable; partial refreshable) ────────
function loadMetrics() {
  if (!existsSync(metricsPath())) return { _meta: META, months: [] };
  const j = JSON.parse(readFileSync(metricsPath(), 'utf8'));
  j._meta = META;                 // keep meta labels current (definitions only)
  if (!Array.isArray(j.months)) j.months = [];
  return j;
}
function isPartialRecord(rec) { return (rec.notes || []).some((n) => /partial/i.test(n)); }
function sameData(a, b) {
  return JSON.stringify({ v: a.visits, p: a.page_views, tp: a.top_pages, c: a.countries }) ===
         JSON.stringify({ v: b.visits, p: b.page_views, tp: b.top_pages, c: b.countries });
}
function appendOrUpdate(store, rec) {
  const i = store.months.findIndex((m) => m.month === rec.month);
  if (i < 0) { store.months.push(rec); store.months.sort((x, y) => x.month.localeCompare(y.month)); return 'appended'; }
  const prev = store.months[i];
  if (isPartialRecord(prev)) { store.months[i] = rec; return 'updated-partial'; }
  // finalized month: immutable.
  if (sameData(prev, rec)) return 'noop-identical';
  throw new Error(`immutable: finalized month ${rec.month} already recorded with different data — refusing to modify the archive`);
}

// ── pure: render METRICS.md from json + hand-editable records ─────────────────
// Generic loader for the append-only sibling records (events / finances /
// contributions / engagement). Missing file → [] (never throws).
function loadArrayDoc(fileName, key) {
  const p = join(docsDir(), fileName);
  if (!existsSync(p)) return [];
  try { const j = JSON.parse(readFileSync(p, 'utf8')); return Array.isArray(j[key]) ? j[key] : []; }
  catch { return []; }
}
function loadEvents() { return loadArrayDoc('events.json', 'events'); }
function loadFinances() { return loadArrayDoc('finances.json', 'expenses'); }
function loadContributions() { return loadArrayDoc('contributions.json', 'contributions'); }
function loadEngagement() { return loadArrayDoc('engagement.json', 'engagement'); }

// ── schema validators for the hand-edited sibling records ─────────────────────
// Each throws on the FIRST violation so the caller fail-closes (writes nothing).
// Extra/unknown keys are allowed (forward-compatible: e.g. `note`, `estimate`);
// required fields and enums are not. amount/hours = number|null only — a `null`
// placeholder is honest ("not yet confirmed"); a guessed number would not be.
const FINANCE_CATEGORIES = new Set(['infra', 'services', 'hardware']);
const CONTRIB_CATEGORIES = new Set(['engineering', 'outreach', 'ops', 'governance']);
const ENGAGEMENT_TYPES = new Set(['media', 'community-review', 'user-feedback', 'partnership', 'milestone']);
const isStr = (x) => typeof x === 'string';
const numOrNull = (x) => x === null || typeof x === 'number';

function validateFinance(e, i) {
  if (!e || typeof e !== 'object') throw new Error(`finances[${i}]: not an object`);
  if (!isStr(e.date) || !e.date.trim()) throw new Error(`finances[${i}]: date must be a non-empty string (YYYY | YYYY-MM | YYYY-MM-DD)`);
  if (!isStr(e.item) || !e.item.trim()) throw new Error(`finances[${i}]: item is required`);
  if (!numOrNull(e.amount_usd)) throw new Error(`finances[${i}]: amount_usd must be a number or null (never a guessed figure)`);
  if (!FINANCE_CATEGORIES.has(e.category)) throw new Error(`finances[${i}]: category must be one of infra|services|hardware`);
  // recurring: boolean (current archive) OR the "monthly"|"yearly"|null cadence enum — both accepted.
  if (!(typeof e.recurring === 'boolean' || e.recurring === null || e.recurring === 'monthly' || e.recurring === 'yearly')) {
    throw new Error(`finances[${i}]: recurring must be boolean, "monthly", "yearly", or null`);
  }
  return e;
}
function validateContribution(c, i) {
  if (!c || typeof c !== 'object') throw new Error(`contributions[${i}]: not an object`);
  if (!/^\d{4}-\d{2}$/.test(c.month || '')) throw new Error(`contributions[${i}]: month must be YYYY-MM`);
  if (!numOrNull(c.hours_estimate)) throw new Error(`contributions[${i}]: hours_estimate must be a number or null`);
  if (!CONTRIB_CATEGORIES.has(c.category)) throw new Error(`contributions[${i}]: category must be one of engineering|outreach|ops|governance`);
  return c;
}
function validateEngagement(g, i) {
  if (!g || typeof g !== 'object') throw new Error(`engagement[${i}]: not an object`);
  if (!(g.date === null || isStr(g.date))) throw new Error(`engagement[${i}]: date must be a string or null`);
  if (!ENGAGEMENT_TYPES.has(g.type)) throw new Error(`engagement[${i}]: type must be one of media|community-review|user-feedback|partnership|milestone`);
  if (!isStr(g.description) || !g.description.trim()) throw new Error(`engagement[${i}]: description is required`);
  return g;
}

// Strict loader: bad JSON, wrong container shape, or any schema-violating entry
// THROWS → the collector fail-closes and writes NOTHING. Missing file → [].
function loadArrayDocStrict(fileName, key, validate) {
  const p = join(docsDir(), fileName);
  if (!existsSync(p)) return [];
  let j;
  try { j = JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { throw new Error(`${fileName}: invalid JSON (${e.message})`); }
  const arr = j[key];
  if (!Array.isArray(arr)) throw new Error(`${fileName}: "${key}" must be an array`);
  arr.forEach((entry, i) => validate(entry, i));
  return arr;
}
// Validate all three sibling records; throws (fail-closed) on the first problem.
function validateSiblingDocs() {
  loadArrayDocStrict('finances.json', 'expenses', validateFinance);
  loadArrayDocStrict('contributions.json', 'contributions', validateContribution);
  loadArrayDocStrict('engagement.json', 'engagement', validateEngagement);
}

// Pure append-only guard for a hand-edited record diff: every prior entry must
// survive byte-for-byte (order-independent); a modified or deleted entry throws.
// Adding new entries is allowed. Cross-commit history is enforced by git — this
// guards a single before/after diff (used in fixtures; reusable by tooling).
function assertAppendOnly(prev, next, label = 'record') {
  const nextSet = new Set(next.map((e) => JSON.stringify(e)));
  prev.forEach((e, i) => {
    if (!nextSet.has(JSON.stringify(e))) {
      throw new Error(`append-only violation: ${label}[${i}] was modified or removed — prior entries are immutable`);
    }
  });
  return true;
}
function money(n) { return (typeof n === 'number') ? `$${n.toLocaleString('en-US')}` : '—'; }
function fmt(n) { return (typeof n === 'number') ? n.toLocaleString('en-US') : '—'; }
// A not-yet-confirmed placeholder renders loudly so no one forgets to fill it.
const TBD = '⚠ TBD — cần điền';
// Static ISO-3166 alpha-2 → name map for METRICS.md rendering only (metrics.json
// keeps the raw code as source of truth). Codes not in the map render as the raw
// code — never guessed.
const COUNTRY_NAMES = {
  US: 'United States', CA: 'Canada', GB: 'United Kingdom', AU: 'Australia',
  JP: 'Japan', PH: 'Philippines', DE: 'Germany', FR: 'France', NZ: 'New Zealand',
  KR: 'South Korea', CN: 'China', MX: 'Mexico', IN: 'India', BR: 'Brazil',
  IT: 'Italy', ES: 'Spain', NL: 'Netherlands', SG: 'Singapore', TW: 'Taiwan',
};
function countryLabel(code) { return COUNTRY_NAMES[code] ? `${COUNTRY_NAMES[code]} (${code})` : code; }
function renderMarkdown(store, events, finances = [], contributions = [], engagement = []) {
  const L = [];
  L.push('# Kahu Ola — Impact Metrics');
  L.push('');
  L.push('> Auto-generated from `metrics.json` + the sibling records (`events`, `finances`,');
  L.push('> `contributions`, `engagement`) by `scripts/impact/collect-metrics.mjs`. **Do not');
  L.push('> edit by hand** — edit the JSON and regenerate (`node scripts/impact/collect-metrics.mjs');
  L.push('> --render-only`). Every figure carries source + collection date. `' + TBD + '` = a');
  L.push('> placeholder awaiting a real, human-confirmed value (never fabricated).');
  L.push('');
  L.push('**Source:** Cloudflare Web Analytics (RUM), dataset `' + META.dataset + '`, bots excluded.');
  L.push('**visits** = ' + META.visits_definition + '.');
  L.push('**page views** = ' + META.page_views_definition + '.');
  L.push('**Geography:** ' + META.geo_note + '.');
  L.push('');
  L.push('## Monthly time series');
  L.push('');
  L.push('| Month | Visits | Page views | Top page | Countries | Note |');
  L.push('|-------|-------:|-----------:|----------|----------:|------|');
  for (const m of store.months) {
    const top = (m.top_pages && m.top_pages[0]) ? `${m.top_pages[0].path} (${fmt(m.top_pages[0].page_views)})` : '—';
    const nc = m.countries ? Object.keys(m.countries).length : 0;
    const note = (m.notes && m.notes.length) ? m.notes.join('; ') : '';
    L.push(`| ${m.month} | ${fmt(m.visits)} | ${fmt(m.page_views)} | ${top} | ${nc} | ${note} |`);
  }
  L.push('');
  // Per-month detail + merged annotations.
  L.push('## Monthly detail');
  for (const m of store.months) {
    L.push('');
    L.push(`### ${m.month}`);
    L.push(`- Visits: **${fmt(m.visits)}** · Page views: **${fmt(m.page_views)}** · collected ${m.collected_at}`);
    if (m.notes && m.notes.length) L.push(`- Note: ${m.notes.join('; ')}`);
    const evs = events.filter((e) => (e.date || '').slice(0, 7) === m.month);
    if (evs.length) {
      L.push('- Events:');
      for (const e of evs.sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
        L.push(`  - ${e.date} · [${e.type}] ${e.title}${e.source ? ` (${e.source})` : ''}`);
      }
    }
    if (m.top_pages && m.top_pages.length) {
      L.push('- Top pages:');
      for (const p of m.top_pages) L.push(`  - ${p.path} — ${fmt(p.page_views)} page views`);
    }
    if (m.countries && Object.keys(m.countries).length) {
      const rows = Object.entries(m.countries).map(([k, v]) => `${countryLabel(k)}: ${fmt(v.page_views)} pv / ${fmt(v.visits)} visits`);
      L.push('- Countries (Zero-PII, country-level only): ' + rows.join(' · '));
    }
  }

  // ── Finances (append-only; null amount = not yet confirmed) ─────────────────
  if (finances.length) {
    L.push('');
    L.push('## Finances (expenses)');
    L.push('');
    L.push('| Date | Item | Amount (USD) | Category | Recurring | Note |');
    L.push('|------|------|-------------:|----------|-----------|------|');
    let confirmed = 0, hasNull = false;
    for (const e of finances) {
      if (typeof e.amount_usd === 'number') confirmed += e.amount_usd; else hasNull = true;
      const amount = (typeof e.amount_usd === 'number') ? money(e.amount_usd) : TBD;
      const recurring = (e.recurring === 'monthly' || e.recurring === 'yearly') ? e.recurring : (e.recurring ? 'yes' : 'no');
      L.push(`| ${e.date || '—'} | ${e.item || '—'} | ${amount} | ${e.category || '—'} | ${recurring} | ${e.note || ''} |`);
    }
    L.push('');
    L.push(`_Confirmed total: **${money(confirmed)}**${hasNull ? ' (excludes rows with amount not yet confirmed — filled from invoices)' : ''}._`);
  }

  // ── Contributed hours (founder/volunteer; estimates, clearly marked) ────────
  if (contributions.length) {
    L.push('');
    L.push('## Contributed hours (estimates)');
    L.push('');
    L.push('| Month | Hours (est.) | Category | Note |');
    L.push('|-------|-------------:|----------|------|');
    let total = 0;
    for (const c of contributions) {
      if (typeof c.hours_estimate === 'number') total += c.hours_estimate;
      const hours = (typeof c.hours_estimate === 'number') ? fmt(c.hours_estimate) : TBD;
      L.push(`| ${c.month || '—'} | ${hours} | ${c.category || '—'} | ${c.note || ''} |`);
    }
    L.push('');
    L.push(`_Total (rough estimate): **${fmt(total)} hours**. Founder-owned figures — refine with actuals._`);
  }

  // ── Engagement / reach (media, community review, feedback, partnership) ─────
  if (engagement.length) {
    L.push('');
    L.push('## Engagement & reach');
    L.push('');
    for (const g of engagement.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
      const link = g.source_link ? ` — ${g.source_link}` : '';
      const note = g.note ? ` _(${g.note})_` : '';
      L.push(`- ${g.date || TBD} · [${g.type}] ${g.description}${link}${note}`);
    }
  }

  L.push('');
  return L.join('\n');
}

// Defensive: never let a token-looking string reach a versioned file.
function assertNoSecret(text, token) {
  if (token && token.length > 8 && text.includes(token)) throw new Error('refusing to write: token found in output');
}

function writeArchive(store, token) {
  const jsonOut = JSON.stringify(store, null, 2) + '\n';
  const mdOut = renderMarkdown(store, loadEvents(), loadFinances(), loadContributions(), loadEngagement());
  assertNoSecret(jsonOut, token); assertNoSecret(mdOut, token);
  mkdirSync(docsDir(), { recursive: true });   // scratch dir may not exist yet
  writeFileSync(metricsPath(), jsonOut, 'utf8');
  writeFileSync(mdPath(), mdOut, 'utf8');
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main(argv) {
  // --render-only: regenerate METRICS.md from the committed JSON only (no network,
  // no token). Fail-closed on a malformed sibling record. This is the offline
  // step of the mùng-1 ritual: after hand-adding rows, re-render then commit.
  if (argv.includes('--render-only')) {
    try { validateSiblingDocs(); }
    catch (e) { console.error(`SIBLING SCHEMA MISMATCH: ${e.message}. Nothing written (fail-closed).`); return 1; }
    const store = loadMetrics();
    const md = renderMarkdown(store, loadEvents(), loadFinances(), loadContributions(), loadEngagement());
    mkdirSync(docsDir(), { recursive: true });
    writeFileSync(mdPath(), md, 'utf8');
    console.log(JSON.stringify({ mode: 'render-only', wrote: 'METRICS.md', months: store.months.length }));
    return 0;
  }

  const monthArg = (argv.find((a) => a.startsWith('--month=')) || '').split('=')[1];
  const targetMonth = monthArg || prevMonth(currentMonthHST());
  if (!/^\d{4}-\d{2}$/.test(targetMonth)) { console.error(`bad --month: ${targetMonth}`); return 2; }

  const token = readSecret('CF_ANALYTICS_TOKEN', 'cf-analytics-token');
  const accountTag = readSecret('CF_ACCOUNT_ID', 'cf-account-id');
  if (!token || !accountTag) { console.error('missing token or accountTag (env or ~/.kahuola-secrets)'); return 2; }

  const nowIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const isPartial = targetMonth === currentMonthHST();
  const { geq, leq } = monthBounds(targetMonth, nowIso);

  const res = await fetchAnalytics(token, accountTag, geq, leq);
  if (!res.ok) {   // FAIL-CLOSED: write nothing, non-zero exit.
    console.error(`FAILED for ${targetMonth}: ${res.error}. Nothing written (a missing month is better than a wrong number).`);
    return 1;
  }
  let record;
  try { record = buildRecord(res.data, targetMonth, nowIso, isPartial); }
  catch (e) { console.error(`SCHEMA MISMATCH for ${targetMonth}: ${e.message}. Nothing written.`); return 1; }

  const store = loadMetrics();
  let action;
  try { action = appendOrUpdate(store, record); }
  catch (e) { console.error(String(e.message)); return 1; }

  // Fail-closed: a malformed sibling record must not reach METRICS.md.
  try { validateSiblingDocs(); }
  catch (e) { console.error(`SIBLING SCHEMA MISMATCH: ${e.message}. Nothing written (fail-closed).`); return 1; }

  writeArchive(store, token);
  console.log(JSON.stringify({ month: targetMonth, action, partial: isPartial, visits: record.visits, page_views: record.page_views, countries: Object.keys(record.countries).length }));
  return 0;
}

// ── fixtures (node collect-metrics.mjs --test) ───────────────────────────────
function runTests() {
  let pass = 0, fail = 0;
  const ok = (n, c) => { c ? (pass++, console.log('PASS — ' + n)) : (fail++, console.log('FAIL — ' + n)); };

  const sample = { viewer: { accounts: [{
    totals: [{ count: 57, sum: { visits: 29 } }],
    pages: [{ count: 39, dimensions: { requestPath: '/' } }, { count: 11, dimensions: { requestPath: '/live-map' } }],
    countries: [{ count: 57, sum: { visits: 29 }, dimensions: { countryName: 'US' } }],
  }] } };
  const rec = buildRecord(sample, '2026-07', '2026-07-05T22:00:00Z', true);
  ok('build: page_views=57 visits=29', rec.page_views === 57 && rec.visits === 29);
  ok('build: top page / with 39', rec.top_pages[0].path === '/' && rec.top_pages[0].page_views === 39);
  ok('build: country US present', rec.countries.US && rec.countries.US.page_views === 57);
  ok('build: partial note added', rec.notes.some((n) => /partial/.test(n)));

  // schema mismatch → throws (fail-closed), no fabrication.
  let threw = false;
  try { buildRecord({ viewer: { accounts: [{ totals: [{}], pages: [], countries: [] }] } }, '2026-07', '2026-07-05T22:00:00Z', false); }
  catch { threw = true; }
  ok('fail-closed: missing totals throws', threw);
  let threw2 = false;
  try { buildRecord({ viewer: { accounts: [] } }, '2026-07', 'x', false); } catch { threw2 = true; }
  ok('fail-closed: empty accounts throws', threw2);

  // append: new month appends; existing months untouched.
  const store = { _meta: META, months: [{ month: '2026-05', visits: 10, page_views: 20, top_pages: [], countries: {}, collected_at: 'c', source: 's', notes: [] }] };
  const a1 = appendOrUpdate(store, { month: '2026-06', visits: 5, page_views: 9, top_pages: [], countries: {}, collected_at: 'c', source: 's', notes: [] });
  ok('append: new month appended, sorted', a1 === 'appended' && store.months.map((m) => m.month).join(',') === '2026-05,2026-06');
  ok('append: old month 2026-05 unchanged', store.months[0].visits === 10);

  // immutability: finalized month with different data → refuse.
  let refused = false;
  try { appendOrUpdate(store, { month: '2026-05', visits: 999, page_views: 999, top_pages: [], countries: {}, collected_at: 'c2', source: 's', notes: [] }); }
  catch { refused = true; }
  ok('immutable: finalized month different data → refused', refused && store.months[0].visits === 10);

  // finalized identical → noop.
  const noop = appendOrUpdate(store, { month: '2026-05', visits: 10, page_views: 20, top_pages: [], countries: {}, collected_at: 'later', source: 's', notes: [] });
  ok('immutable: identical finalized → noop', noop === 'noop-identical' && store.months[0].visits === 10);

  // partial month refreshable.
  const store2 = { _meta: META, months: [{ month: '2026-07', visits: 5, page_views: 9, top_pages: [], countries: {}, collected_at: 'c', source: 's', notes: ['partial month (collected 2026-07-03)'] }] };
  const upd = appendOrUpdate(store2, { month: '2026-07', visits: 8, page_views: 15, top_pages: [], countries: {}, collected_at: 'c2', source: 's', notes: ['partial month (collected 2026-07-05)'] });
  ok('partial: current partial month refreshed', upd === 'updated-partial' && store2.months[0].visits === 8);

  // annotation merge into METRICS.md.
  const md = renderMarkdown(store2, [{ date: '2026-07-05', type: 'product', title: 'Volcanic fix shipped', source: 'PR #20' }]);
  ok('render: month row present', md.includes('| 2026-07 |'));
  ok('render: annotation merged into 2026-07 detail', md.includes('Volcanic fix shipped') && md.includes('[product]'));
  ok('render: visits label present', md.includes('sessions — cookie-free'));
  // country render: mapped code → full name (with code); JSON stays raw.
  const md2 = renderMarkdown({ _meta: META, months: [{ month: '2026-07', visits: 29, page_views: 57, top_pages: [], countries: { US: { page_views: 57, visits: 29 }, ZZ: { page_views: 1, visits: 0 } }, collected_at: 'c', source: 's', notes: [] }] }, []);
  ok('render: US → "United States (US)"', md2.includes('United States (US)'));
  ok('render: unmapped code ZZ stays raw (not guessed)', md2.includes('ZZ: 1 pv'));

  // finances / contributions / engagement render into METRICS.md.
  const mdRec = renderMarkdown(
    { _meta: META, months: [] }, [],
    [{ date: '2026', item: 'Apple Developer Program', amount_usd: 99, category: 'services', recurring: true, note: 'annual' },
     { date: '2026', item: 'Domain', amount_usd: null, category: 'infra', recurring: true, note: 'fill' }],
    [{ month: '2026-07', hours_estimate: 40, category: 'engineering', note: 'estimate' }],
    [{ date: '2026-07-05', type: 'community-review', description: 'HAW/ILO review', source_link: 'PR #20' }]);
  ok('render: finances confirmed total = $99 (null row excluded)', /## Finances/.test(mdRec) && mdRec.includes('Confirmed total: **$99**'));
  ok('render: null amount shows ⚠ TBD (not fabricated)', mdRec.includes('| Domain | ⚠ TBD — cần điền |'));
  ok('render: contributions marked estimate + total', /## Contributed hours \(estimates\)/.test(mdRec) && /40 hours/.test(mdRec) && /Founder-owned/.test(mdRec));
  ok('render: engagement lists community-review row', /## Engagement & reach/.test(mdRec) && /\[community-review\] HAW\/ILO review/.test(mdRec));
  ok('render: sections omitted when their arrays are empty', !/## Finances/.test(renderMarkdown({ _meta: META, months: [] }, [])));

  // ── sibling-record schema validators (fail-closed on bad data) ───────────────
  const okThrow = (n, fn) => { let t = false; try { fn(); } catch { t = true; } ok(n, t); };
  ok('validate: good finance row passes', validateFinance({ date: '2026', item: 'Domain', amount_usd: null, category: 'infra', recurring: true }, 0));
  ok('validate: finance recurring cadence enum accepted', validateFinance({ date: '2026', item: 'MapTiler', amount_usd: null, category: 'services', recurring: 'yearly' }, 0));
  okThrow('validate: finance bad category → throws', () => validateFinance({ date: '2026', item: 'x', amount_usd: 1, category: 'bogus', recurring: true }, 0));
  okThrow('validate: finance guessed-string amount → throws', () => validateFinance({ date: '2026', item: 'x', amount_usd: '99', category: 'infra', recurring: true }, 0));
  okThrow('validate: finance missing item → throws', () => validateFinance({ date: '2026', item: '', amount_usd: null, category: 'infra', recurring: true }, 0));
  ok('validate: contribution governance category accepted', validateContribution({ month: '2026-07', hours_estimate: 5, category: 'governance' }, 0));
  okThrow('validate: contribution bad month → throws', () => validateContribution({ month: '2026', hours_estimate: 5, category: 'ops' }, 0));
  ok('validate: engagement milestone type accepted', validateEngagement({ date: '2026-07-05', type: 'milestone', description: 'i18n complete' }, 0));
  ok('validate: engagement null date accepted (unknown date)', validateEngagement({ date: null, type: 'partnership', description: 'App Store live' }, 0));
  okThrow('validate: engagement bad type → throws', () => validateEngagement({ date: null, type: 'press', description: 'x' }, 0));
  okThrow('validate: engagement missing description → throws', () => validateEngagement({ date: null, type: 'media', description: '' }, 0));

  // ── append-only guard: add ok; modify/remove a prior entry → caught ──────────
  const prev = [{ date: '2026', item: 'Apple', amount_usd: 99 }, { date: '2026', item: 'Domain', amount_usd: null }];
  ok('append-only: adding a new row is allowed', assertAppendOnly(prev, [...prev, { date: '2026', item: 'MapTiler', amount_usd: null }], 'finances'));
  ok('append-only: identical set is allowed', assertAppendOnly(prev, prev.slice(), 'finances'));
  okThrow('append-only: modifying a prior entry → caught', () => assertAppendOnly(prev, [{ date: '2026', item: 'Apple', amount_usd: 120 }, prev[1]], 'finances'));
  okThrow('append-only: removing a prior entry → caught', () => assertAppendOnly(prev, [prev[0]], 'finances'));

  // ── strict loader fail-closes on a schema-violating file (write nothing) ─────
  const scratch = join(process.env.TMPDIR || '/tmp', `impact-guard-${pass}${fail}`);
  mkdirSync(scratch, { recursive: true });
  const savedDir = process.env.IMPACT_OUTPUT_DIR;
  process.env.IMPACT_OUTPUT_DIR = scratch;
  writeFileSync(join(scratch, 'finances.json'), JSON.stringify({ expenses: [{ date: '2026', item: 'x', amount_usd: 1, category: 'not-a-category', recurring: true }] }), 'utf8');
  okThrow('fail-closed: malformed sibling file makes validateSiblingDocs throw', () => validateSiblingDocs());
  writeFileSync(join(scratch, 'finances.json'), JSON.stringify({ expenses: [{ date: '2026', item: 'x', amount_usd: 1, category: 'infra', recurring: true }] }), 'utf8');
  let cleanPass = true; try { validateSiblingDocs(); } catch { cleanPass = false; }
  ok('fail-closed: valid sibling files pass validation', cleanPass);
  if (savedDir) process.env.IMPACT_OUTPUT_DIR = savedDir; else delete process.env.IMPACT_OUTPUT_DIR;

  // token guard.
  let guard = false;
  try { assertNoSecret('...abcSECRETxyz...', 'abcSECRETxyz'); } catch { guard = true; }
  ok('guard: refuses output containing the token', guard);

  // IMPACT_OUTPUT_DIR override (used by the n8n scratch verification run).
  const savedEnv = process.env.IMPACT_OUTPUT_DIR;
  process.env.IMPACT_OUTPUT_DIR = '/tmp/impact-scratch-xyz';
  ok('docsDir: env override honored', docsDir() === '/tmp/impact-scratch-xyz');
  delete process.env.IMPACT_OUTPUT_DIR;
  ok('docsDir: default is docs/impact', docsDir().endsWith(join('docs', 'impact')));
  if (savedEnv) process.env.IMPACT_OUTPUT_DIR = savedEnv;

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

// ── entry ────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
export { buildRecord, appendOrUpdate, renderMarkdown, loadMetrics, monthBounds, currentMonthHST, docsDir,
  validateFinance, validateContribution, validateEngagement, validateSiblingDocs, assertAppendOnly };
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--test')) runTests();
  else main(argv).then((code) => process.exit(code)).catch((e) => { console.error('fatal:', e); process.exit(1); });
}
