/**
 * Kahu Ola — Brief output validator (Phase 2)
 *
 * Guards the boundary between Gemma 4's reasoning and the civic surface
 * of Kahu Ola. The validator rejects outputs that:
 *
 *   - Contain the fallback marker (`FALLBACK_REQUIRED`).
 *   - Invent road or highway closures that are not in the context.
 *   - Invent school closures or school names that are not in the context.
 *   - Create unsupported timelines ("tomorrow at 3pm", "in the next hour",
 *     "tonight", "by midnight" — anything that predicts when something
 *     will happen, which Kahu Ola is not in a position to assert).
 *   - Overstate certainty ("definitely", "guaranteed", "certain",
 *     "will definitely", "we know that", "no doubt").
 *   - Issue evacuation-like instructions without an NWS basis in the
 *     context's known alerts ("evacuate now", "leave immediately",
 *     "mandatory evacuation", "shelter in place").
 *
 * Rejection returns { ok: false, reason } — the caller is expected to
 * fall through to the deterministic template brief. This is a hard wall:
 * no "try to repair the output" step. If Gemma drifts, we do not ship it.
 *
 * Design notes:
 *   - Rules are plain regex / substring checks, not a model. Deterministic,
 *     cheap, auditable, and safe to run in the Worker hot path.
 *   - Context-aware exceptions: if ctx.knownAlerts contains a flash flood
 *     warning, Kahu Ola is allowed to relay "turn around, don't drown"
 *     advice; the validator lets that through.
 *   - Missing information is fine. Extra information is dangerous. The
 *     validator is intentionally asymmetric about that.
 */

import type { RiskLevel } from "./zones";

export interface ValidationContext {
  zoneName: string;
  schoolNames: string[];
  evacuationPrimary: string;
  fireRisk: RiskLevel;
  floodRisk: RiskLevel;
  knownAlerts: string[];
}

export interface ValidationVerdict {
  ok: boolean;
  reason?: string;
}

const FALLBACK_MARKER = "FALLBACK_REQUIRED";

// Words that signal the model is inventing a closure rather than quoting
// the known evacuation route.
const CLOSURE_PATTERNS: RegExp[] = [
  /\bhighway (?:is )?(?:closed|shut)\b/i,
  /\broad (?:is )?(?:closed|shut)\b/i,
  /\bbridge (?:is )?(?:closed|out)\b/i,
  /\b(?:is|has been) shut down\b/i,
  /\bclosed to (?:all )?traffic\b/i,
];

// Unsupported timelines: anything that predicts a specific time or
// time-window in the near future. Kahu Ola is not an oracle.
const TIMELINE_PATTERNS: RegExp[] = [
  /\bin the next \d+\s*(?:minute|hour|day)s?\b/i,
  /\bwithin (?:the next )?\d+\s*(?:minute|hour|day)s?\b/i,
  /\bby (?:this )?(?:evening|night|midnight|noon|tonight|morning|afternoon|tomorrow)\b/i,
  /\btomorrow\b/i,
  /\btonight\b/i,
  /\bat \d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)\b/i,
  /\bexpected (?:at|by|within)\b/i,
];

// Overstatement: words that claim certainty the system cannot support.
const CERTAINTY_PATTERNS: RegExp[] = [
  /\bdefinitely\b/i,
  /\bguaranteed\b/i,
  /\bcertain(?:ly)?\b/i,
  /\bwithout (?:a )?doubt\b/i,
  /\bno doubt\b/i,
  /\bwe know (?:that|for sure)\b/i,
  /\bwill definitely\b/i,
];

// Evacuation-style instructions. These are allowed IF the context carries
// an NWS alert that backs them — e.g., a Flash Flood Warning supports
// "move to higher ground". Otherwise they are forbidden.
const EVAC_PATTERNS: RegExp[] = [
  /\bevacuate (?:now|immediately)\b/i,
  /\bmandatory evacuation\b/i,
  /\bleave (?:now|immediately|your home)\b/i,
  /\bshelter in place\b/i,
];

function hasNwsBackingFor(kind: "evac", alerts: string[]): boolean {
  if (kind !== "evac") return false;
  // Any alert containing "warning" from NWS is considered to carry
  // actionable authority — Red Flag Warning, Flash Flood Warning,
  // Tsunami Warning, Hurricane Warning, etc.
  return alerts.some((a) => /warning/i.test(a));
}

function anyMatches(text: string, patterns: RegExp[]): RegExp | null {
  for (const p of patterns) {
    if (p.test(text)) return p;
  }
  return null;
}

// Detect mentions of schools that are not in the context. Matches the
// common Hawaiian naming pattern "<Name> Elementary/Intermediate/High/School".
const SCHOOL_MENTION_REGEX =
  /\b([A-ZĀĒĪŌŪʻ][A-Za-zĀĒĪŌŪāēīōūʻ'-]+(?:\s+[A-ZĀĒĪŌŪʻ][A-Za-zĀĒĪŌŪāēīōūʻ'-]+){0,3})\s+(?:Elementary|Intermediate|High|School|Academy)\b/g;

function checkInventedSchools(text: string, knownSchools: string[]): string | null {
  const known = knownSchools.map((s) => s.toLowerCase());
  let match: RegExpExecArray | null;
  const re = new RegExp(SCHOOL_MENTION_REGEX.source, SCHOOL_MENTION_REGEX.flags);
  while ((match = re.exec(text)) !== null) {
    const full = match[0];
    const lower = full.toLowerCase();
    // Consider it "known" if any known school name contains this mention
    // or vice versa (handles "Lahainaluna High" vs "Lahainaluna High School").
    const isKnown = known.some(
      (k) => k.includes(lower) || lower.includes(k),
    );
    if (!isKnown) return full;
  }
  return null;
}

// Reject mentions of a hazard level that is higher than the context allows.
// If ctx.fireRisk is MODERATE but the text says "extreme fire", the model
// is changing the hazard level — forbidden by doctrine.
const RISK_WORDS = ["LOW", "MODERATE", "HIGH", "EXTREME"] as const;
const RISK_RANK: Record<RiskLevel, number> = {
  LOW: 0,
  MODERATE: 1,
  HIGH: 2,
  EXTREME: 3,
};

function textClaimsHigherThan(
  text: string,
  kind: "fire" | "flood",
  ctxLevel: RiskLevel,
): string | null {
  const ctxRank = RISK_RANK[ctxLevel];
  for (const word of RISK_WORDS) {
    const rank = RISK_RANK[word];
    if (rank <= ctxRank) continue;
    // Look for "extreme fire", "extreme wildfire risk", etc.
    const kindPattern = kind === "fire" ? "fire|wildfire" : "flood|flooding";
    const re = new RegExp(`\\b${word}\\b[^.]{0,60}?\\b(?:${kindPattern})\\b`, "i");
    if (re.test(text)) return `${word} ${kind}`;
    // And the reverse order: "fire is extreme"
    const re2 = new RegExp(`\\b(?:${kindPattern})\\b[^.]{0,60}?\\b${word}\\b`, "i");
    if (re2.test(text)) return `${kind} ${word}`;
  }
  return null;
}

export function validateBrief(
  text: string,
  ctx: ValidationContext,
): ValidationVerdict {
  if (!text || text.trim().length === 0) {
    return { ok: false, reason: "empty output" };
  }
  if (text.includes(FALLBACK_MARKER)) {
    return { ok: false, reason: "contains fallback marker" };
  }

  const closureHit = anyMatches(text, CLOSURE_PATTERNS);
  if (closureHit) {
    return {
      ok: false,
      reason: `invented closure (pattern: ${closureHit.source})`,
    };
  }

  const inventedSchool = checkInventedSchools(text, ctx.schoolNames);
  if (inventedSchool) {
    return {
      ok: false,
      reason: `mentions school not in zone context: ${inventedSchool}`,
    };
  }

  const timelineHit = anyMatches(text, TIMELINE_PATTERNS);
  if (timelineHit) {
    return {
      ok: false,
      reason: `unsupported timeline (pattern: ${timelineHit.source})`,
    };
  }

  const certaintyHit = anyMatches(text, CERTAINTY_PATTERNS);
  if (certaintyHit) {
    return {
      ok: false,
      reason: `overstated certainty (pattern: ${certaintyHit.source})`,
    };
  }

  const evacHit = anyMatches(text, EVAC_PATTERNS);
  if (evacHit && !hasNwsBackingFor("evac", ctx.knownAlerts)) {
    return {
      ok: false,
      reason: `evacuation instruction without NWS warning in context (pattern: ${evacHit.source})`,
    };
  }

  const fireEscalation = textClaimsHigherThan(text, "fire", ctx.fireRisk);
  if (fireEscalation) {
    return {
      ok: false,
      reason: `escalates fire risk beyond context (${ctx.fireRisk}): "${fireEscalation}"`,
    };
  }
  const floodEscalation = textClaimsHigherThan(text, "flood", ctx.floodRisk);
  if (floodEscalation) {
    return {
      ok: false,
      reason: `escalates flood risk beyond context (${ctx.floodRisk}): "${floodEscalation}"`,
    };
  }

  return { ok: true };
}
