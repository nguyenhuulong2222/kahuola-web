#!/usr/bin/env node
/**
 * Kahu Ola — Automated Data Insight Generator
 * Phase 2: Data-Led Growth (mock data prototype)
 *
 * Reads a local mock data.json (NASA FIRMS / NOAA / AQI for Maui), asks the
 * Anthropic API for a short calm 3-bullet Markdown summary for Wailuku and
 * Lahaina, and writes public/insights/today.md.
 *
 * DOCTRINE / GROWTH_FEATURES COMPLIANCE
 *  - Runs server-side (Node / n8n), NOT in a browser → Invariant I not engaged
 *    here, but production wiring (Phase 3) must still read aggregated data via
 *    the Kahu Ola Worker, never upstream APIs from a client.
 *  - Layer A owns truth: numbers come ONLY from data.json. The model (Layer B)
 *    narrates; it must not invent or alter figures. Enforced via system prompt.
 *  - Invariant II / fail-soft: ANY failure → deterministic safe fallback file
 *    is still written. The pipeline never produces nothing.
 *  - Invariant III: invalid JSON is dropped (fallback), never inferred/repaired.
 *  - GROWTH_FEATURES §1 guardrails: cite official sources, label freshness
 *    (generated time HST + source fetch time), no evacuation/emergency orders.
 *  - Mock data is permitted in a PROTOTYPE (SYSTEM_INVARIANTS Invariant 2 only
 *    forbids mock in PRODUCTION). Phase 3 replaces data.json with real
 *    aggregated data from the Kahu Ola Worker.
 *
 * No secrets hard-coded. API key via ANTHROPIC_API_KEY env var only.
 */

'use strict';

const fs = require('fs/promises');
const path = require('path');

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, 'data.json');
const OUT_DIR = path.join(ROOT, 'public', 'insights');
const OUT_PATH = path.join(OUT_DIR, 'today.md');

const MODEL = 'claude-sonnet-4-20250514';
const TOWNS = ['Wailuku', 'Lahaina'];

/** HST timestamp (Pacific/Honolulu, no DST — fixed UTC-10). */
function hstTimestamp(d = new Date()) {
  const hst = new Date(d.getTime() - 10 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${hst.getUTCFullYear()}-${pad(hst.getUTCMonth() + 1)}-${pad(hst.getUTCDate())} ` +
    `${pad(hst.getUTCHours())}:${pad(hst.getUTCMinutes())} HST`
  );
}

/** Deterministic safe fallback — written whenever the AI path cannot complete. */
async function writeFallback(reason) {
  const ts = hstTimestamp();
  const md = [
    '# Kahu Ola — Daily Hazard Insight (Maui)',
    '',
    `_Generated: ${ts}_`,
    '',
    '> The automated summary is temporarily unavailable.',
    '> Please check official sources directly for current conditions.',
    '',
    '## Official sources',
    '',
    '- National Weather Service (Honolulu): https://www.weather.gov/hfo/',
    '- Hawaiʻi Emergency Management Agency (HIEMA): https://dod.hawaii.gov/hiema/',
    '- Maui County emergency info: https://www.mauicounty.gov/',
    '',
    '---',
    '',
    'Kahu Ola provides situational awareness and does not replace official ' +
      'emergency directives. Always follow official county, state, and federal guidance.',
    '',
    `<!-- fallback reason: ${String(reason).replace(/-->/g, '--&gt;')} -->`,
    '',
  ].join('\n');

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(OUT_PATH, md, 'utf8');
}

/**
 * Load hazard data.
 *  - Phase 3: if KAHUOLA_INSIGHTS_URL is set, fetch aggregated Maui data
 *    from the Kahu Ola Worker (server-side; not a browser; Invariant I n/a
 *    here but the Worker is still the single source of truth — Layer A).
 *  - Phase 2 / fallback: read local mock data.json from project root.
 * Throws tagged errors for precise handling.
 */
async function loadData() {
  const url = process.env.KAHUOLA_INSIGHTS_URL;
  if (url) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);
      if (!r.ok) {
        const err = new Error(`insights endpoint returned HTTP ${r.status}`);
        err.code = 'ENDPOINT_HTTP';
        throw err;
      }
      try {
        return await r.json();
      } catch (e) {
        const err = new Error('insights endpoint returned invalid JSON');
        err.code = 'BAD_JSON';
        err.cause = e;
        throw err; // Invariant III: drop, never repair.
      }
    } catch (e) {
      if (e && e.code) throw e;
      const err = new Error(`insights endpoint fetch failed: ${e && e.message}`);
      err.code = 'ENDPOINT_FETCH';
      err.cause = e;
      throw err;
    }
  }

  let raw;
  try {
    raw = await fs.readFile(DATA_PATH, 'utf8');
  } catch (e) {
    const err = new Error(`data.json not found at ${DATA_PATH}`);
    err.code = 'NO_DATA_FILE';
    err.cause = e;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    const err = new Error('data.json is not valid JSON');
    err.code = 'BAD_JSON';
    err.cause = e;
    throw err; // Invariant III: drop, never repair.
  }
}

/** Flatten mock data into a clean, prompt-ready string. Layer A = truth. */
function formatForPrompt(data) {
  const lines = [];
  const fetchedAt =
    (data && (data.source_fetched_at || data.fetched_at)) || 'unknown';
  lines.push(`Source data fetched at: ${fetchedAt}`);
  lines.push(`Region: Maui County (focus towns: ${TOWNS.join(', ')})`);
  lines.push('');

  const aqi = (data && data.air_quality) || {};
  lines.push('Air quality (EPA AirNow):');
  for (const town of TOWNS) {
    const v = aqi[town.toLowerCase()] ?? aqi[town] ?? null;
    lines.push(`  - ${town}: AQI ${v == null ? 'n/a' : v}`);
  }

  const fires = Array.isArray(data && data.fires) ? data.fires : [];
  lines.push('');
  lines.push(`Active fire detections (NASA FIRMS VIIRS/MODIS): ${fires.length}`);
  fires.slice(0, 10).forEach((f, i) => {
    const loc = f && (f.location || f.name) ? f.location || f.name : `detection ${i + 1}`;
    const conf = f && f.confidence != null ? `, confidence ${f.confidence}` : '';
    lines.push(`  - ${loc}${conf}`);
  });

  const wx = (data && data.weather) || {};
  if (wx && Object.keys(wx).length) {
    lines.push('');
    lines.push('Weather / fire-weather context (NOAA/NWS):');
    for (const [k, v] of Object.entries(wx)) {
      lines.push(`  - ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    }
  }
  return lines.join('\n');
}

const SYSTEM_PROMPT = [
  'You write a short daily civic hazard insight for Kahu Ola, a situational-',
  'awareness platform for Hawaiʻi. You are a NARRATION layer only.',
  '',
  'Hard rules:',
  '- Use ONLY the figures in the provided data. Never invent, infer, round',
  '  away, or alter numbers. If a value is missing, say "data not available".',
  '- Output EXACTLY three Markdown bullet points. No heading, no preamble.',
  '- Cover Wailuku and Lahaina specifically.',
  '- Calm, factual, non-sensational. No alarming language.',
  '- NEVER issue evacuation orders, emergency directives, or safety',
  '  instructions. Do not tell people what action to take.',
  '- If conditions look serious, the most you may say is that residents',
  '  should follow official NWS / HIEMA / county guidance.',
  '- Mention the data is from public sources (NASA FIRMS, NOAA/NWS, EPA AirNow).',
].join('\n');

/** Call Anthropic API via official SDK. Returns the 3-bullet body string. */
async function generateSummary(promptData) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error('ANTHROPIC_API_KEY is not set');
    err.code = 'NO_API_KEY';
    throw err;
  }

  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch (e) {
    const err = new Error('@anthropic-ai/sdk is not installed');
    err.code = 'NO_SDK';
    err.cause = e;
    throw err;
  }

  const client = new Anthropic({ apiKey });
  let resp;
  try {
    resp = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content:
            'Today\'s aggregated hazard data for Maui:\n\n' +
            promptData +
            '\n\nWrite the three bullet points now.',
        },
      ],
    });
  } catch (e) {
    const err = new Error(`Anthropic API call failed: ${e && e.message}`);
    err.code = 'API_FAILURE';
    err.cause = e;
    throw err;
  }

  const text = (resp && Array.isArray(resp.content) ? resp.content : [])
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  if (!text) {
    const err = new Error('Anthropic API returned no text content');
    err.code = 'EMPTY_RESPONSE';
    throw err;
  }
  return text;
}

/** Compose the final Markdown file (success path). */
function composeMarkdown(body, data) {
  const ts = hstTimestamp();
  const fetchedAt =
    (data && (data.source_fetched_at || data.fetched_at)) || 'unknown';
  return [
    '# Kahu Ola — Daily Hazard Insight (Maui)',
    '',
    `_Generated: ${ts} · Source data fetched: ${fetchedAt}_`,
    '',
    body.trim(),
    '',
    '## Sources',
    '',
    '- Wildfire detections: NASA FIRMS (VIIRS/MODIS)',
    '- Weather / fire weather: NOAA · National Weather Service',
    '- Air quality: EPA AirNow',
    '',
    'For official emergency information and instructions:',
    '',
    '- National Weather Service (Honolulu): https://www.weather.gov/hfo/',
    '- Hawaiʻi Emergency Management Agency: https://dod.hawaii.gov/hiema/',
    '- Maui County: https://www.mauicounty.gov/',
    '',
    '---',
    '',
    'Kahu Ola provides situational awareness and does not replace official ' +
      'emergency directives. Always follow official county, state, and federal guidance.',
    '',
  ].join('\n');
}

async function main() {
  let data;
  try {
    data = await loadData();
  } catch (e) {
    // Missing or invalid data.json → safe fallback, exit non-zero for the
    // scheduler to notice, but a valid file still exists on disk.
    await writeFallback(`${e.code || 'LOAD_ERROR'}: ${e.message}`);
    console.error(`[generate_insights] ${e.code || 'LOAD_ERROR'}: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  let promptData;
  try {
    promptData = formatForPrompt(data);
  } catch (e) {
    await writeFallback(`FORMAT_ERROR: ${e.message}`);
    console.error(`[generate_insights] FORMAT_ERROR: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  let body;
  try {
    body = await generateSummary(promptData);
  } catch (e) {
    await writeFallback(`${e.code || 'API_ERROR'}: ${e.message}`);
    console.error(`[generate_insights] ${e.code || 'API_ERROR'}: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    const md = composeMarkdown(body, data);
    await fs.mkdir(OUT_DIR, { recursive: true });
    await fs.writeFile(OUT_PATH, md, 'utf8');
  } catch (e) {
    // Filesystem write failure on the success path → try fallback write.
    try {
      await writeFallback(`WRITE_ERROR: ${e.message}`);
    } catch (_) {
      /* nothing more we can safely do */
    }
    console.error(`[generate_insights] WRITE_ERROR: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  console.error(`[generate_insights] OK → ${OUT_PATH}`);
}

if (require.main === module) {
  main().catch(async (e) => {
    // Last-resort guard: any unforeseen error still yields a safe file.
    try {
      await writeFallback(`UNEXPECTED: ${e && e.message}`);
    } catch (_) {
      /* swallow */
    }
    console.error(`[generate_insights] UNEXPECTED: ${e && e.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  hstTimestamp,
  formatForPrompt,
  composeMarkdown,
  loadData,
  __OUT_PATH: OUT_PATH,
};
