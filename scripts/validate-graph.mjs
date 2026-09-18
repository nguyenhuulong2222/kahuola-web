/**
 * Kahu Ola — RHSCG capability graph validator (P34, schema capgraph-1.1)
 *
 * No dependencies. There is no root package.json, so run it directly:
 *
 *     node scripts/validate-graph.mjs
 *
 * Exit 0 = every node PASSED and the resources.html embed matches the JSON.
 * Exit 1 = anything else. This is the gate: a registry that cannot be
 * verified must never reach a wildfire page.
 *
 * What it enforces
 *   - Envelope shape and schema_version
 *   - Every node field, fail closed on unknown enum values
 *   - R3: the string "foster_kinship" is a hard error wherever it appears
 *   - last_verified must be a real ISO date; the "PENDING" sentinel fails,
 *     which is what blocks a commit before Long's hand-verification
 *   - Duplicate ids
 *   - P34 ruling (d): resources.html embeds a second copy of the graph, so
 *     the two are hash-compared. Two copies of truth require a comparator.
 */

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const GRAPH_PATH = "data/no-door/capability-graph.json";
const PAGE_PATH = "resources.html";
const EMBED_ID = "capability-graph-embed";

const SCHEMA_VERSION = "capgraph-1.1";
const CAPABILITIES = ["transportation", "shelter", "medication_continuity"];
// P34 UI exposes five constraint chips. wheelchair_mobility is a valid data
// value with no chip yet (Gate 1 ruling on cap-meo-transportation) — real
// information about the node, filterable from P35.
const AUDIENCE = ["child", "kupuna", "pet", "no_vehicle", "limited_english", "wheelchair_mobility"];
const AVAILABILITY = ["standing", "disaster_activated", "seasonal"];
const AUTHORITY = ["official", "partner", "community"];
const ISLANDS = ["maui"];
const CHANNEL_KEYS = ["phone", "url", "sms", "offline_note_i18n_key"];

// R3 — routing uses child + caregiver_support only. This term must not exist.
const FORBIDDEN_TERMS = ["foster_kinship"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

let hardErrors = [];
const rows = [];

function fail(msg) {
  hardErrors.push(msg);
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function checkEnumList(value, allowed, label, errs, { allowStar = false } = {}) {
  if (!Array.isArray(value) || value.length === 0) {
    errs.push(`${label} must be a non-empty array`);
    return;
  }
  for (const v of value) {
    if (allowStar && v === "*") continue;
    if (!allowed.includes(v)) {
      errs.push(`${label}: unknown value ${JSON.stringify(v)} (allowed: ${allowed.join(", ")}${allowStar ? ', "*"' : ""})`);
    }
  }
  if (allowStar && value.includes("*") && value.length > 1) {
    errs.push(`${label}: "*" cannot be combined with specific values`);
  }
}

function validateNode(node, index, seenIds) {
  const errs = [];
  const id = isPlainObject(node) ? node.id : undefined;

  if (!isPlainObject(node)) {
    return { id: `#${index}`, name: "(not an object)", errs: ["node is not an object"] };
  }

  if (typeof id !== "string" || !id.trim()) errs.push("id must be a non-empty string");
  else {
    if (!id.startsWith("cap-")) errs.push(`id must carry the "cap-" prefix`);
    if (seenIds.has(id)) errs.push(`duplicate id "${id}"`);
    seenIds.add(id);
  }

  for (const f of ["name", "i18n_key", "source_note"]) {
    if (typeof node[f] !== "string" || !node[f].trim()) errs.push(`${f} must be a non-empty string`);
  }

  checkEnumList(node.islands, ISLANDS, "islands", errs);
  checkEnumList(node.capabilities, CAPABILITIES, "capabilities", errs);
  checkEnumList(node.audience, AUDIENCE, "audience", errs, { allowStar: true });

  if (!Array.isArray(node.requires)) errs.push("requires must be an array");
  else if (node.requires.length !== 0) errs.push("requires must be empty in P34 (edges are derived in P35 — R1)");

  if (!AVAILABILITY.includes(node.availability)) {
    errs.push(`availability: unknown value ${JSON.stringify(node.availability)} (allowed: ${AVAILABILITY.join(", ")})`);
  }
  if (!AUTHORITY.includes(node.authority)) {
    errs.push(`authority: unknown value ${JSON.stringify(node.authority)} (allowed: ${AUTHORITY.join(", ")})`);
  }

  if (typeof node.max_age_hours !== "number" || !Number.isFinite(node.max_age_hours) || node.max_age_hours <= 0) {
    errs.push("max_age_hours must be a positive finite number");
  }

  if (!isPlainObject(node.channels)) {
    errs.push("channels must be an object");
  } else {
    const ch = node.channels;
    for (const k of Object.keys(ch)) {
      if (!CHANNEL_KEYS.includes(k)) errs.push(`channels: unknown key ${JSON.stringify(k)}`);
      if (typeof ch[k] !== "string" || !ch[k].trim()) errs.push(`channels.${k} must be a non-empty string`);
    }
    if (!ch.phone && !ch.url) errs.push("channels must carry at least one of phone or url");
    if (ch.url && !/^https:\/\//.test(ch.url)) errs.push("channels.url must be https");
  }

  if (!Array.isArray(node.languages) || !node.languages.includes("en")) {
    errs.push('languages must be an array including "en"');
  }

  if (node.last_verified === "PENDING") {
    errs.push("last_verified is still PENDING — hand-verification required before commit");
  } else if (typeof node.last_verified !== "string" || !ISO_DATE.test(node.last_verified)) {
    errs.push("last_verified must be an ISO date (YYYY-MM-DD)");
  } else if (Number.isNaN(Date.parse(node.last_verified))) {
    errs.push(`last_verified is not a real date: ${node.last_verified}`);
  }

  return { id: id || `#${index}`, name: node.name || "(unnamed)", errs };
}

// ── load ────────────────────────────────────────────────────────────────
if (!existsSync(GRAPH_PATH)) {
  console.error(`FATAL  missing ${GRAPH_PATH}`);
  process.exit(1);
}

const graphRaw = readFileSync(GRAPH_PATH, "utf8");

// R3 is a text-level ban: catch it even in a comment or a source_note.
for (const term of FORBIDDEN_TERMS) {
  if (graphRaw.includes(term)) {
    fail(`R3 VIOLATION: the term "${term}" appears in ${GRAPH_PATH}. Routing uses child + caregiver_support only.`);
  }
}

let graph;
try {
  graph = JSON.parse(graphRaw);
} catch (e) {
  console.error(`FATAL  ${GRAPH_PATH} is not valid JSON: ${e.message}`);
  process.exit(1);
}

if (graph.schema_version !== SCHEMA_VERSION) {
  fail(`schema_version must be "${SCHEMA_VERSION}", got ${JSON.stringify(graph.schema_version)}`);
}
if (typeof graph.generated_at !== "string" || Number.isNaN(Date.parse(graph.generated_at))) {
  fail("generated_at must be an ISO timestamp");
}
if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
  console.error("FATAL  nodes must be a non-empty array");
  process.exit(1);
}

// ── per-node ────────────────────────────────────────────────────────────
const seenIds = new Set();
graph.nodes.forEach((n, i) => rows.push(validateNode(n, i, seenIds)));

// ── embed comparator (P34 ruling d) ─────────────────────────────────────
let embedLine;
if (!existsSync(PAGE_PATH)) {
  embedLine = `SKIP   ${PAGE_PATH} not present yet — embed comparison deferred`;
} else {
  const page = readFileSync(PAGE_PATH, "utf8");
  for (const term of FORBIDDEN_TERMS) {
    if (page.includes(term)) fail(`R3 VIOLATION: the term "${term}" appears in ${PAGE_PATH}.`);
  }
  const re = new RegExp(
    `<script[^>]*id=["']${EMBED_ID}["'][^>]*>([\\s\\S]*?)<\\/script>`,
    "i"
  );
  const m = page.match(re);
  if (!m) {
    fail(`embed comparator: no <script id="${EMBED_ID}"> block found in ${PAGE_PATH}`);
    embedLine = "FAIL   embed block not found";
  } else {
    let embedJson;
    try {
      embedJson = JSON.parse(m[1]);
    } catch (e) {
      fail(`embed comparator: embedded JSON does not parse: ${e.message}`);
      embedJson = null;
    }
    if (embedJson) {
      // Compare canonical serialisations, so whitespace/indent in the page
      // cannot mask a real divergence and cannot cause a false alarm either.
      const canon = (o) => JSON.stringify(o);
      const hashOf = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);
      const a = canon(graph);
      const b = canon(embedJson);
      if (a === b) {
        embedLine = `OK     embed matches ${GRAPH_PATH}  (sha256:${hashOf(a)}, ${graph.nodes.length} nodes)`;
      } else {
        fail(
          `embed comparator: ${PAGE_PATH} embed does NOT match ${GRAPH_PATH}\n` +
          `         file  sha256:${hashOf(a)}  nodes=${graph.nodes.length}\n` +
          `         embed sha256:${hashOf(b)}  nodes=${Array.isArray(embedJson.nodes) ? embedJson.nodes.length : "?"}`
        );
        embedLine = "FAIL   embed diverges from the JSON file";
      }
    }
  }
}

// ── report ──────────────────────────────────────────────────────────────
const W_ID = 32, W_NAME = 46;
const pad = (s, n) => String(s).padEnd(n).slice(0, n);

console.log(`Kahu Ola RHSCG validator — ${SCHEMA_VERSION}`);
console.log(`graph: ${GRAPH_PATH}   nodes: ${graph.nodes.length}`);
console.log("");
console.log(pad("VERDICT", 8) + pad("id", W_ID) + pad("name", W_NAME) + "detail");
console.log("-".repeat(120));

let passed = 0, dropped = 0;
for (const r of rows) {
  if (r.errs.length === 0) {
    passed++;
    console.log(pad("PASS", 8) + pad(r.id, W_ID) + pad(r.name, W_NAME) + "—");
  } else {
    dropped++;
    console.log(pad("DROP", 8) + pad(r.id, W_ID) + pad(r.name, W_NAME) + r.errs[0]);
    for (const e of r.errs.slice(1)) console.log(pad("", 8) + pad("", W_ID) + pad("", W_NAME) + e);
  }
}

console.log("-".repeat(120));
console.log(`nodes: ${passed} PASS · ${dropped} DROP`);
console.log(`embed: ${embedLine}`);

const pendingIds = graph.nodes.filter((n) => n && n.last_verified === "PENDING").map((n) => n.id);
if (pendingIds.length) {
  console.log("");
  console.log(`VERIFICATION GATE — ${pendingIds.length} node(s) still PENDING:`);
  for (const id of pendingIds) console.log(`  · ${id}`);
  console.log("Hand-verify each entry, set last_verified to an ISO date, then re-run.");
}

if (hardErrors.length) {
  console.log("");
  console.log("HARD ERRORS:");
  for (const e of hardErrors) console.log(`  ✗ ${e}`);
}

const ok = dropped === 0 && hardErrors.length === 0;
console.log("");
console.log(ok ? "RESULT: PASS (exit 0)" : "RESULT: FAIL (exit 1)");
process.exit(ok ? 0 : 1);
