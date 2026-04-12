/**
 * Kahu Ola — Gemma 4 inference wrapper (Phase 2)
 *
 * Doctrine:
 *   - Gemma 4 ONLY. No Gemini, no OpenAI, no other vendor.
 *   - Browser NEVER calls this directly — inference is Worker-side only.
 *   - Code does math. AI does reasoning. They do not swap roles.
 *   - Template fallback (see zone-brief.ts) is the PRIMARY safety net.
 *     This wrapper is allowed to return "fallbackUsed: true" for any
 *     reason and the caller must handle that gracefully.
 *
 * Contract:
 *   1. Cache hit → return cached text immediately.
 *   2. Build a bounded prompt from the structured input only.
 *   3. Run Gemma 4 via env.AI.run(GEMMA_MODEL, ...).
 *   4. Validate output via validate-brief.ts.
 *   5. On any failure (timeout, validation reject, FALLBACK_REQUIRED
 *      marker, empty response), return { fallbackUsed: true, text: "" }.
 *      The caller falls through to the deterministic template.
 *   6. Cache valid result for BRIEF_TTL_MS.
 *
 * Phase 2 cache is in-memory per isolate (same constraint as cache.ts).
 * When KAHUOLA_CACHE KV id is wired, this can be swapped without changing
 * the public surface.
 */

import type { HouseholdProfile } from "./zone-brief";
import type { ZoneDynamicState, RiskLevel } from "./zones";
import { validateBrief, type ValidationContext } from "./validate-brief";

// Fixed per Long's directive (2026-04-10). Do not change without explicit
// reauthorization — the doctrine forbids silent model swaps.
export const GEMMA_MODEL = "@cf/google/gemma-4-26b-a4b-it";

// Gemma 4 on Workers AI uses reasoning/thinking mode and spends budget
// on hidden reasoning tokens before emitting the final answer. 1024
// gives the model room to finish reasoning AND produce output; with
// smaller budgets finish_reason becomes "length" and message.content
// comes back null. (Confirmed 2026-04-11.)
const MAX_TOKENS = 1024;
const GEMMA_TIMEOUT_MS = 12_000;
const BRIEF_TTL_MS = 15 * 60 * 1000;
export const FALLBACK_MARKER = "FALLBACK_REQUIRED";

const SYSTEM_PROMPT = [
  "<|thinking|>off",
  "/no_think",
  "Thinking mode: disabled. Do not emit reasoning steps, chain-of-thought, or bullet-list deliberations. Produce only the finished output.",
  "",
  "You are Kahu Ola — Guardian of Life. A civic hazard intelligence platform for Hawaiʻi, built after Lahaina.",
  "",
  "TONE RULES — strictly enforce:",
  "- When conditions are CLEAR (fire_risk LOW, flood_risk LOW, no NWS alerts):",
  "  Write with genuine Hawaiian warmth and calm. Use phrases like:",
  '  "E mālama pono", "conditions are calm today", "a good day to",',
  '  "Hawaiʻi is quiet right now". Celebrate the calm.',
  "  DO NOT mention terrain dangers, historical incidents, or \"be aware of\" anything.",
  "  DO NOT add caveats about what COULD happen. Only describe what IS happening.",
  "",
  "- When conditions are ACTIVE (any HIGH/EXTREME risk or NWS alert):",
  "  Be clear, direct, and action-focused. Never sensational.",
  "  Give specific actionable guidance. Reference official NWS alerts.",
  "",
  "ACCURACY RULES — never violate:",
  "- Use ONLY the live state data provided. Never infer from terrain profile.",
  "- state.fire_risk LOW = no fire concern today. Do not mention fire.",
  "- state.flood_risk LOW = no flood concern today. Do not mention flooding.",
  "- Historical incidents (zone.historical_signals) are PAST ONLY.",
  "  NEVER reference them as current risk or current concern.",
  "- Do NOT describe typical terrain characteristics as current hazards.",
  "- If state.nws_alerts is empty, there are NO official warnings. Say so warmly.",
  "",
  "LANGUAGE:",
  "- Weave in Hawaiian words naturally: mālama, pono, aloha, ʻāina, kūpuna, keiki",
  "- Warm, local, civic tone — like a trusted neighbor who knows the land",
  "- Never clinical, never bureaucratic, never fear-based when calm",
  "",
  "Use only the structured input provided.",
  "Do not invent facts, warnings, or official guidance.",
  "Be concise. Output only the final brief text. No preamble, no reasoning steps.",
  `If the input is insufficient, return: ${FALLBACK_MARKER}`,
].join("\n");

// Minimal AI binding contract. The real Workers AI binding exposes more,
// but we only use `run` and we explicitly do not depend on library shapes.
interface AiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}

export interface GemmaEnv {
  AI: AiBinding;
}

export interface GenerateBriefInput {
  zoneId: string;
  lang: string;
  householdProfile: HouseholdProfile;
  zoneSnapshot: ZoneDynamicState;
  // Structured zone facts the caller has already pulled from the static
  // ZoneProfile. Passing them in (instead of importing ZoneProfile here)
  // keeps this module focused on inference and makes it easy to reuse
  // from /api/brief with a synthetic context.
  zoneName: string;
  zoneTerrain: string;
  zoneDrainageContext: string;
  zoneEvacuationPrimary: string;
  zoneNotableSchoolNames: string[];
  zoneHistoricalSignals: string[];
}

export interface GenerateBriefResult {
  text: string;
  fallbackUsed: boolean;
  sourceLabels: string[];
}

// ── cache ─────────────────────────────────────────────────
interface TextCacheEntry {
  result: GenerateBriefResult;
  expiresAt: number;
}

const textCache = new Map<string, TextCacheEntry>();

function cacheKeyFor(input: GenerateBriefInput): string {
  const s = input.zoneSnapshot;
  const h = input.householdProfile;
  const alerts = [...s.nws_alerts].sort().join(",");
  const household = `${h.kupuna ? 1 : 0}${h.keiki ? 1 : 0}${h.pets ? 1 : 0}${h.medical ? 1 : 0}${h.car ? 1 : 0}`;
  return `gemma:${input.zoneId}:${s.fire_risk}|${s.flood_risk}|${alerts}:${household}:${input.lang}`;
}

function readCache(key: string): GenerateBriefResult | null {
  const hit = textCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    textCache.delete(key);
    return null;
  }
  return hit.result;
}

function writeCache(key: string, result: GenerateBriefResult): void {
  textCache.set(key, { result, expiresAt: Date.now() + BRIEF_TTL_MS });
}

// ── prompt construction ───────────────────────────────────
/**
 * Build the user message. Only facts passed into `input` are visible to
 * the model — the Worker source, upstream responses, and anything outside
 * this message are not in scope.
 */
const LANG_NAMES: Record<string, string> = {
  en: "English", vi: "Vietnamese", tl: "Tagalog",
  ilo: "Ilocano", haw: "ʻŌlelo Hawaiʻi", ja: "Japanese",
};

function buildBriefSystemPrompt(input: GenerateBriefInput): string {
  const langName = LANG_NAMES[input.lang] || "English";
  const lines = [
    "<|thinking|>off",
    "/no_think",
    "Thinking mode: disabled. Produce only the finished output.",
    "",
    `You are Kahu Ola — Guardian of Life. A civic hazard intelligence platform for Hawaiʻi.`,
    `Write 1–2 warm sentences in ${langName} summarizing current conditions for a zone.`,
    `Use Hawaiian civic voice — like a trusted neighbor who knows the land.`,
    "",
    `OUTPUT RULES:`,
    `- Output ONLY the interpretation sentences in ${langName}.`,
    `- No field names. No JSON. No labels. No "headline:" or "what_it_means:" prefixes.`,
    `- No preamble, no reasoning steps, no bullet lists.`,
    "",
    `ACCURACY RULES:`,
    `- fire_risk LOW = no fire concern. Do not mention fire.`,
    `- flood_risk LOW = no flood concern. Do not mention flooding.`,
    `- If alerts are "none", there are NO official warnings. Celebrate the calm.`,
    `- Do NOT describe historical incidents as current risk.`,
    `- Do NOT invent facts, road closures, or statistics.`,
    "",
    `If the input is insufficient, return: ${FALLBACK_MARKER}`,
  ];
  return lines.join("\n");
}

function buildUserPrompt(input: GenerateBriefInput): string {
  const s = input.zoneSnapshot;
  const h = input.householdProfile;
  const langName = LANG_NAMES[input.lang] || "English";

  const householdBits: string[] = [];
  if (h.kupuna) householdBits.push("kupuna (elderly) present");
  if (h.keiki) householdBits.push("keiki (children) present");
  if (h.pets) householdBits.push("pets present");
  if (h.medical) householdBits.push("daily medication or oxygen required");
  householdBits.push(h.car ? "has a vehicle" : "no vehicle — cannot drive themselves");

  const alerts = s.nws_alerts.length > 0 ? s.nws_alerts.join("; ") : "none";

  const lines: string[] = [
    `Zone: ${input.zoneName}`,
    `Conditions: fire_risk=${s.fire_risk}, flood_risk=${s.flood_risk}, alerts=${alerts}`,
    `Wind: ${s.wind_mph ?? "unknown"} mph, Humidity: ${s.humidity_pct ?? "unknown"}%`,
    `Household: ${householdBits.join(", ")}`,
    ``,
    `Write the interpretation in ${langName}.`,
  ];

  return lines.join("\n");
}

function stripFieldLabels(text: string): string {
  return text
    .replace(/^(headline|what_it_means|what_to_do|household_note)\s*[:：]\s*/gim, "")
    .trim();
}

// ── inference ─────────────────────────────────────────────

interface GemmaRawResult {
  text: string;
}

/**
 * Extract text from a Workers AI chat completion response, handling
 * every shape we have seen in the wild:
 *
 *   - Plain string response
 *   - { response: "text" }                    (Cloudflare native)
 *   - { result: { response: "text" } }         (Cloudflare wrapped)
 *   - { output_text: "text" }                  (Google legacy)
 *   - { choices: [{ text: "text" }] }          (OpenAI completion)
 *   - { choices: [{ message: { content: "text" } }] }
 *                                             (OpenAI chat, string content)
 *   - { choices: [{ message: { content: [{type:"text", text:"..."}] } }] }
 *                                             (OpenAI chat, content parts)
 *   - { choices: [{ delta: { content: "text" } }] }
 *                                             (OpenAI streaming chunk)
 *
 * Returns the first non-empty match, or "" if nothing parses.
 */
function extractContentString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    // OpenAI content-parts format: [{type:"text", text:"..."}, ...]
    const pieces: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        pieces.push(part);
      } else if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        if (typeof p.text === "string") pieces.push(p.text);
        else if (typeof p.content === "string") pieces.push(p.content);
      }
    }
    return pieces.join("");
  }
  return "";
}

/**
 * Gemma 4 on Workers AI runs in thinking/reasoning mode and emits its
 * entire chain-of-thought inside `message.reasoning` (or `content`) before
 * the final answer. Empirically the reasoning chain looks like:
 *
 *   * Identify the key facts: no active NWS alerts...
 *   * Acknowledge the need for a calm, civic tone...
 *   * Incorporate Hawaiian words for warmth...
 *   * Ensure the post is under 250 characters...
 *
 *   Aloha mai kākou. Kahu Ola is monitoring conditions across Hawaiʻi…
 *
 * This helper strips that preamble so only the final answer reaches the
 * validator. Two strategies, tried in order:
 *
 *   1. Find the last line that matches a bullet-reasoning pattern
 *      (`* ` or `  * ` or `- `) and return everything after it.
 *   2. Split on blank-line paragraph boundaries and return the last
 *      non-empty paragraph (the final answer usually comes last).
 *
 * If neither produces anything, fall through to the original text and
 * let the validator decide.
 */
export function stripReasoningPreamble(text: string): string {
  if (!text) return text;

  // Strategy 1: find the last bullet-reasoning line, return everything after.
  const lines = text.split("\n");
  let lastBulletIdx = -1;
  const bulletRe = /^\s*[*\-•]\s+\S/u;
  for (let i = 0; i < lines.length; i++) {
    if (bulletRe.test(lines[i])) {
      lastBulletIdx = i;
    }
  }
  if (lastBulletIdx >= 0) {
    const after = lines.slice(lastBulletIdx + 1).join("\n").trim();
    if (after.length > 0) return after;
  }

  // Strategy 2: split on blank-line paragraph boundaries and take the
  // last non-empty chunk (the final answer is almost always at the end).
  const chunks = text
    .split(/\n\s*\n/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  if (chunks.length > 1) {
    return chunks[chunks.length - 1];
  }

  // Nothing to strip — return original and let the validator decide.
  return text;
}

export function extractResponseText(response: any): string {
  if (typeof response === "string") return response;
  if (response == null || typeof response !== "object") return "";

  if (typeof response.response === "string") return response.response;
  if (typeof response.result?.response === "string") return response.result.response;
  if (typeof response.output_text === "string") return response.output_text;

  const c0 = response.choices?.[0];
  if (c0 && typeof c0 === "object") {
    // 1. Chat format with message.content (string OR content-parts array)
    const msgContent = extractContentString(c0.message?.content);
    if (msgContent) return msgContent;

    // 2. Gemma 4 reasoning-mode fallback: Workers AI surfaces the final
    //    answer under message.reasoning when the model runs in
    //    thinking-mode and content is null. Some vLLM adapters use the
    //    variant key `reasoning_content`; check that too.
    //    (Root cause confirmed 2026-04-11 via raw response dump.)
    const reasoning = extractContentString(c0.message?.reasoning);
    if (reasoning) return reasoning;
    const reasoningContent = extractContentString(c0.message?.reasoning_content);
    if (reasoningContent) return reasoningContent;

    // 3. Streaming delta (non-streaming requests can still come back
    //    with delta if the adapter translated a stream internally)
    const deltaContent = extractContentString(c0.delta?.content);
    if (deltaContent) return deltaContent;

    // 4. Completion-style flat text
    if (typeof c0.text === "string") return c0.text;

    // 5. Belt-and-braces: some vLLM adapters nest under `content` directly
    const directContent = extractContentString(c0.content);
    if (directContent) return directContent;
  }

  return "";
}

async function runGemmaWithTimeout(
  env: GemmaEnv,
  userPrompt: string,
  systemPromptOverride?: string,
  maxTokensOverride?: number,
): Promise<GemmaRawResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMMA_TIMEOUT_MS);
  try {
    const response: any = await env.AI.run(GEMMA_MODEL, {
      messages: [
        { role: "system", content: systemPromptOverride ?? SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokensOverride ?? MAX_TOKENS,
      temperature: 0.2, // low — factual, not creative
    });

    const rawText = extractResponseText(response);
    return { text: rawText.trim() };
  } finally {
    clearTimeout(timer);
  }
}

// ── public API ────────────────────────────────────────────
export async function generateBrief(
  env: GemmaEnv,
  input: GenerateBriefInput,
): Promise<GenerateBriefResult> {
  const key = cacheKeyFor(input);

  const cached = readCache(key);
  if (cached) return cached;

  const sourceLabels: string[] = [
    ...input.zoneSnapshot.sources,
    "Gemma 4 (Workers AI)",
  ];

  let raw: GemmaRawResult;
  try {
    raw = await runGemmaWithTimeout(env, buildUserPrompt(input), buildBriefSystemPrompt(input));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("gemma.generateBrief runtime error:", msg);
    return { text: "", fallbackUsed: true, sourceLabels };
  }

  if (!raw.text || raw.text.includes(FALLBACK_MARKER)) {
    return { text: "", fallbackUsed: true, sourceLabels };
  }

  const stripped = stripReasoningPreamble(raw.text);
  const cleanedText = stripFieldLabels(stripped);
  if (!cleanedText) {
    return { text: "", fallbackUsed: true, sourceLabels };
  }

  const ctx: ValidationContext = {
    zoneName: input.zoneName,
    schoolNames: input.zoneNotableSchoolNames,
    evacuationPrimary: input.zoneEvacuationPrimary,
    fireRisk: input.zoneSnapshot.fire_risk,
    floodRisk: input.zoneSnapshot.flood_risk,
    knownAlerts: input.zoneSnapshot.nws_alerts,
  };

  const verdict = validateBrief(cleanedText, ctx);
  if (!verdict.ok) {
    console.warn(`gemma.generateBrief validation rejected: ${verdict.reason}`);
    return { text: "", fallbackUsed: true, sourceLabels };
  }

  const result: GenerateBriefResult = {
    text: cleanedText,
    fallbackUsed: false,
    sourceLabels,
  };
  writeCache(key, result);
  return result;
}

// Exported for tests / diagnostics only. Not part of the public contract.
export function _debugBuildPrompt(input: GenerateBriefInput): {
  system: string;
  user: string;
} {
  return { system: buildBriefSystemPrompt(input), user: buildUserPrompt(input) };
}

// Suppresses unused-var warning on RiskLevel re-export path; keeping the
// type surfaced lets callers infer fire/flood risk types from this module.
export type { RiskLevel };

// ══════════════════════════════════════════════════════════
// Social-post pipeline (n8n /api/brief endpoint)
// ══════════════════════════════════════════════════════════
//
// Separate prompt and validator from the zone-brief pipeline above. The
// social voice is civic + Hawaiian + short-form; the validator is lighter
// (no school or evacuation-route concerns — the social voice is forbidden
// from mentioning them outright).
//
// Same model, same env.AI binding, same fallback discipline.

const SOCIAL_SYSTEM_PROMPT = [
  // Thinking-mode suppression (Gemma 4 Workers AI adapter). Multiple
  // directives because different adapter versions respect different
  // tokens; whichever one the runtime understands will take effect,
  // and the others become harmless text.
  "<|thinking|>off",
  "/no_think",
  "Thinking mode: disabled. Do not emit reasoning steps, chain-of-thought, or bullet-list deliberations. Produce only the finished output.",
  "",
  "You are the social media voice of Kahu Ola — a civic hazard intelligence platform for Hawaiʻi (kahuola.org). Your job is to write one honest, calm Facebook post summarizing the current hazard context provided.",
  "",
  "Be concise. Output only the final post text. No preamble, no explanation, no reasoning steps, no thinking-out-loud. Do not narrate your process. Just produce the finished post.",
  "",
  "PLATFORM IDENTITY:",
  "- Name: Kahu Ola Hawaiʻi Hazard Intelligence",
  "- Mission: Civic wildfire and hazard situational awareness for Hawaiʻi",
  "- Tone: calm, civic, factual, never sensational, deeply Hawaiian",
  "- Principle: E mālama pono (care for people and land)",
  "- Hawaiian Voice: Warm, local tone. Use culturally appropriate words like \"Aloha mai kākou\", \"mahalo\", \"mālama\", \"ʻohana\", \"ʻāina\" where they naturally fit.",
  "",
  "CONTENT RULES:",
  "1. Max 250 characters",
  "2. Always end with: kahuola.org",
  "3. Max 2 emojis — only if they add clarity (🔥 fire, 🌧️ rain, 🌺 general)",
  "4. No hashtags",
  "5. No ALL CAPS except acronyms (NWS, FEMA, NOAA)",
  "6. Never exaggerate severity — if uncertain, say \"monitoring\"",
  "7. Cite source agency when relevant: NWS, NASA FIRMS, NOAA",
  "8. If no active alerts: post a genuinely positive, warm message celebrating calm conditions. Use Hawaiian warmth (E mālama pono, Aloha mai kākou). Do NOT mention terrain dangers, historical incidents, or what COULD happen. Celebrate the calm.",
  "",
  "FORBIDDEN:",
  "- Never say \"BREAKING\" or \"URGENT\" unless the context mentions an NWS Warning",
  "- Never invent hazard data — only use what the context provides",
  "- Never use sensational language (\"devastating\", \"catastrophic\")",
  "- Never mention evacuation routes (liability)",
  "",
  "OUTPUT FORMAT:",
  `Return ONLY the Facebook post text. No preamble. No explanation. No quotes around the text. Just the post, ready to publish. If the context is insufficient, respond exactly with: ${FALLBACK_MARKER}`,
].join("\n");

const FALLBACK_SOCIAL_POST =
  "Aloha mai kākou. Kahu Ola is monitoring hazard conditions across Hawaiʻi. Stay informed — kahuola.org 🌺";

// See MAX_TOKENS comment above re: Gemma 4 reasoning-mode token budget.
// Social post is shorter than a zone brief but still needs 1024 so the
// model can reason silently and emit the final post in one run.
const SOCIAL_MAX_TOKENS = 1024;

export interface GenerateSocialInput {
  context: string;
  lang?: string;
  maxChars?: number;
}

export interface GenerateSocialResult {
  post: string;
  fallbackUsed: boolean;
  sources: string[];
}

function extractContextAlerts(context: string): string[] {
  // Rough heuristic: "Flash Flood Warning", "Red Flag Warning", etc.
  const matches = context.match(/[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\s+(?:Warning|Watch|Advisory)/g);
  return matches ? Array.from(new Set(matches)) : [];
}

/**
 * Ensure the post ends with the kahuola.org citation. If the model didn't
 * include it, append " — kahuola.org 🌺". If appending would overflow
 * maxChars, trim the tail of the post to fit (breaking on a word boundary
 * where possible and dropping trailing punctuation that looks broken
 * after a cut).
 *
 * This replaces the old "missing citation = hard reject" rule. Empirically
 * Gemma 4 produces otherwise-valid Hawaiian-voice posts without the
 * citation; forcing a fallback just because of a missing URL wastes a
 * perfectly good generation.
 */
function ensureKahuolaCitation(post: string, maxChars: number): string {
  if (post.toLowerCase().includes("kahuola.org")) return post;

  const suffix = " — kahuola.org 🌺";
  const appended = post.trimEnd() + suffix;
  if (appended.length <= maxChars) return appended;

  // Post + suffix overflows. Trim the post tail to fit.
  const target = Math.max(0, maxChars - suffix.length);
  let trimmed = post.slice(0, target).trimEnd();
  // Drop trailing punctuation / dashes / whitespace that would look
  // broken right before the citation.
  trimmed = trimmed.replace(/[,;:\-\u2014\s]+$/u, "");
  return trimmed + suffix;
}

function validateSocialPost(
  post: string,
  contextAlerts: string[],
  maxChars: number,
): { ok: boolean; reason?: string } {
  const trimmed = post.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.length > maxChars) {
    return { ok: false, reason: `too long (${trimmed.length} > ${maxChars})` };
  }
  // kahuola.org citation is handled by ensureKahuolaCitation() upstream;
  // the validator no longer hard-rejects on missing citation.
  if (/\bBREAKING\b|\bURGENT\b/.test(trimmed)) {
    const hasWarning = contextAlerts.some((a) => /warning/i.test(a));
    if (!hasWarning) {
      return { ok: false, reason: "unsupported BREAKING/URGENT (no NWS Warning in context)" };
    }
  }
  if (/\bdevastating\b|\bcatastrophic\b/i.test(trimmed)) {
    return { ok: false, reason: "sensational language" };
  }
  if (/\bevacuat(?:e|ion)\b/i.test(trimmed)) {
    return { ok: false, reason: "evacuation language forbidden in social voice" };
  }
  return { ok: true };
}

/**
 * Generate a short civic Facebook post from a caller-supplied context
 * string. Used by /api/brief (n8n social poster pipeline).
 *
 * Template fallback discipline: any error, validation reject, or
 * FALLBACK_REQUIRED marker returns the static `FALLBACK_SOCIAL_POST`
 * with `fallbackUsed: true`. The caller never sees an exception.
 */
export async function generateSocialPost(
  env: GemmaEnv,
  input: GenerateSocialInput,
): Promise<GenerateSocialResult> {
  // IMPORTANT: maxChars ≠ max_tokens. maxChars is the character ceiling
  // for the FINAL post after validation/trimming. max_tokens (below) is
  // the generation budget given to Gemma 4, which needs headroom for
  // reasoning-mode thinking tokens PLUS the visible output. Never
  // collapse these two concepts.
  const maxChars = input.maxChars ?? 280;
  const gemmaSources = ["Gemma 4 (Workers AI)"];
  const templateFallback: GenerateSocialResult = {
    post: FALLBACK_SOCIAL_POST,
    fallbackUsed: true,
    sources: ["template_fallback"],
  };

  if (!env.AI || typeof env.AI.run !== "function") {
    return templateFallback;
  }

  const contextAlerts = extractContextAlerts(input.context);

  let raw: GemmaRawResult;
  try {
    // Gemma 4 token budget is SOCIAL_MAX_TOKENS (1024), never maxChars.
    raw = await runGemmaWithTimeout(
      env,
      input.context,
      SOCIAL_SYSTEM_PROMPT,
      SOCIAL_MAX_TOKENS,
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("generateSocialPost runtime error:", msg);
    return templateFallback;
  }

  if (!raw.text || raw.text.includes(FALLBACK_MARKER)) {
    return templateFallback;
  }

  // Strip Gemma 4 thinking-mode reasoning preamble. Gemma emits its
  // full chain-of-thought as bullet lines before the final answer;
  // we keep only the answer.
  const postReasoning = stripReasoningPreamble(raw.text);

  // Strip common quoting: models occasionally wrap the post in quotes
  // despite the system prompt saying not to.
  const stripped = postReasoning.replace(/^['"“”‘’]+|['"“”‘’]+$/g, "").trim();

  // Auto-append the kahuola.org citation if the model omitted it.
  const withCitation = ensureKahuolaCitation(stripped, maxChars);

  const verdict = validateSocialPost(withCitation, contextAlerts, maxChars);
  if (!verdict.ok) {
    console.warn(`generateSocialPost validation rejected: ${verdict.reason}`);
    return templateFallback;
  }

  return { post: withCitation, fallbackUsed: false, sources: gemmaSources };
}
