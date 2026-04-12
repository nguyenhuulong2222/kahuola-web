/**
 * Kahu Ola — Zone brief cache + snapshot diff (Phase 1, in-memory per isolate)
 *
 * Phase 1 constraint (approved by Long):
 *   This module uses in-memory Maps scoped to the current Cloudflare Worker
 *   isolate. Cold starts and isolate recycles lose the cache. That is
 *   acceptable for the Maui-first rollout. The delta diff will simply fall
 *   back to the "unchanged" string until the isolate has seen two snapshot
 *   cycles separated by >23 hours, which is fine for correctness (briefs
 *   stay safe) even when it is not informative.
 *
 * Phase 2 migration path (planned):
 *   Swap the `briefCache` and `snapshotCache` Maps for a thin wrapper over
 *   the `KAHUOLA_CACHE` KV namespace declared in wrangler.toml. Keep the
 *   public surface of this module (getCachedBrief, putCachedBrief,
 *   writeSnapshot, computeSnapshotDelta, briefCacheKey) unchanged so the
 *   /api/hazards/zone/:zoneId handler does not need to care which backend
 *   is in use.
 *
 * Cache key format (stable — do not change without versioning):
 *   zone_brief:{zone_id}:{conditions_hash}:{household_hash}:{lang}
 *
 * Snapshot storage keys:
 *   snapshot:{zone_id}:current    — TTL 25h
 *   snapshot:{zone_id}:yesterday  — TTL 49h
 *
 * Snapshot rotation rule (called on every fresh state build):
 *   1. Read current
 *   2. If current.fetched_at age > 23h  → copy current → yesterday
 *   3. Write new state → current
 *
 * Brief cache TTL:
 *   Normal: 15 minutes.
 *   Changes in nws_alerts, fire_risk, or flood_risk do not need an explicit
 *   invalidation call: those fields are part of the conditions_hash that
 *   feeds into the cache key, so a change produces a new key and the old
 *   entry simply ages out. This is deliberate — it removes a whole class
 *   of "stale cache served after state change" bugs by construction.
 */

import type { ZoneDynamicState } from "./zones";
import type { HouseholdProfile, ZoneBrief } from "./zone-brief";

// ── TTLs ───────────────────────────────────────────────────
const BRIEF_TTL_MS = 15 * 60 * 1000;
const SNAPSHOT_CURRENT_TTL_MS = 25 * 60 * 60 * 1000;
const SNAPSHOT_YESTERDAY_TTL_MS = 49 * 60 * 60 * 1000;
const SNAPSHOT_ROTATE_AGE_MS = 23 * 60 * 60 * 1000;

// ── conditions hash ────────────────────────────────────────
/**
 * Deterministic hash of the state fields that materially affect the brief.
 * Wind and humidity are bucketed so minor sensor wobble does not churn
 * the cache key.
 */
export function conditionsHash(state: ZoneDynamicState): string {
  const alerts = [...state.nws_alerts].sort().join(",");
  const wind =
    state.wind_mph == null ? "x" : String(Math.round(state.wind_mph / 5) * 5);
  const hum =
    state.humidity_pct == null ? "x" : String(Math.round(state.humidity_pct / 10) * 10);
  return `${state.fire_risk}|${state.flood_risk}|${alerts}|w${wind}|h${hum}`;
}

export function householdHash(h: HouseholdProfile): string {
  return [
    h.kupuna ? "k" : "-",
    h.keiki ? "c" : "-",
    h.pets ? "p" : "-",
    h.medical ? "m" : "-",
    h.car ? "v" : "-",
  ].join("");
}

export function briefCacheKey(
  zoneId: string,
  state: ZoneDynamicState,
  household: HouseholdProfile,
  lang: string,
): string {
  return `zone_brief:${zoneId}:${conditionsHash(state)}:${householdHash(household)}:${lang}`;
}

// ── brief cache ────────────────────────────────────────────
interface BriefCacheEntry {
  brief: ZoneBrief;
  expiresAt: number;
}

const briefCache = new Map<string, BriefCacheEntry>();

export function getCachedBrief(key: string): ZoneBrief | null {
  const hit = briefCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    briefCache.delete(key);
    return null;
  }
  return hit.brief;
}

export function putCachedBrief(key: string, brief: ZoneBrief): void {
  briefCache.set(key, { brief, expiresAt: Date.now() + BRIEF_TTL_MS });
}

// ── snapshot storage ───────────────────────────────────────
interface SnapshotEntry {
  state: ZoneDynamicState;
  expiresAt: number;
}

type SnapshotSlot = "current" | "yesterday";

const snapshotCache = new Map<string, SnapshotEntry>();

function snapKey(zoneId: string, slot: SnapshotSlot): string {
  return `snapshot:${zoneId}:${slot}`;
}

function readSnap(zoneId: string, slot: SnapshotSlot): ZoneDynamicState | null {
  const entry = snapshotCache.get(snapKey(zoneId, slot));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    snapshotCache.delete(snapKey(zoneId, slot));
    return null;
  }
  return entry.state;
}

function writeSnap(zoneId: string, slot: SnapshotSlot, state: ZoneDynamicState): void {
  const ttl = slot === "current" ? SNAPSHOT_CURRENT_TTL_MS : SNAPSHOT_YESTERDAY_TTL_MS;
  snapshotCache.set(snapKey(zoneId, slot), {
    state,
    expiresAt: Date.now() + ttl,
  });
}

/**
 * Snapshot write cycle — call on every fresh state build:
 *   1. If the existing current snapshot is older than 23h, rotate it into
 *      the yesterday slot first (so we can diff against it for up to 49h).
 *   2. Write the new state into the current slot.
 */
export function writeSnapshot(zoneId: string, state: ZoneDynamicState): void {
  const current = readSnap(zoneId, "current");
  if (current) {
    const ageMs = Date.now() - new Date(current.fetched_at).getTime();
    if (Number.isFinite(ageMs) && ageMs > SNAPSHOT_ROTATE_AGE_MS) {
      writeSnap(zoneId, "yesterday", current);
    }
  }
  writeSnap(zoneId, "current", state);
}

// ── delta diff ─────────────────────────────────────────────
export interface ZoneStateDelta {
  fire_risk_changed: boolean;
  flood_risk_changed: boolean;
  nws_alerts_changed: boolean;
  wind_changed: boolean;
  humidity_changed: boolean;
  summary: string;
  previous_fetched_at: string;
  current_fetched_at: string;
}

const UNCHANGED_MESSAGE = "Conditions unchanged since yesterday.";

function alertsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const as = [...a].sort();
  const bs = [...b].sort();
  for (let i = 0; i < as.length; i++) {
    if (as[i] !== bs[i]) return false;
  }
  return true;
}

function numbersClose(a: number | null, b: number | null, tolerance: number): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= tolerance;
}

/**
 * Compare the current and yesterday snapshots for a zone. Returns the
 * unchanged sentence if there is no yesterday snapshot yet or if nothing
 * material has moved, otherwise a structured delta the brief/template
 * layer can describe.
 */
export function computeSnapshotDelta(zoneId: string): string | ZoneStateDelta {
  const current = readSnap(zoneId, "current");
  const yesterday = readSnap(zoneId, "yesterday");
  if (!current || !yesterday) return UNCHANGED_MESSAGE;

  const fireChanged = current.fire_risk !== yesterday.fire_risk;
  const floodChanged = current.flood_risk !== yesterday.flood_risk;
  const alertsChanged = !alertsEqual(current.nws_alerts, yesterday.nws_alerts);
  const windChanged = !numbersClose(current.wind_mph, yesterday.wind_mph, 5);
  const humidityChanged = !numbersClose(current.humidity_pct, yesterday.humidity_pct, 10);

  if (!fireChanged && !floodChanged && !alertsChanged && !windChanged && !humidityChanged) {
    return UNCHANGED_MESSAGE;
  }

  const parts: string[] = [];
  if (fireChanged) {
    parts.push(`fire risk moved from ${yesterday.fire_risk} to ${current.fire_risk}`);
  }
  if (floodChanged) {
    parts.push(`flood risk moved from ${yesterday.flood_risk} to ${current.flood_risk}`);
  }
  if (alertsChanged) {
    if (yesterday.nws_alerts.length === 0 && current.nws_alerts.length > 0) {
      parts.push(
        `new NWS alert${current.nws_alerts.length > 1 ? "s" : ""}: ${current.nws_alerts.join(", ")}`
      );
    } else if (current.nws_alerts.length === 0 && yesterday.nws_alerts.length > 0) {
      parts.push("NWS alerts cleared");
    } else {
      parts.push("NWS alert set changed");
    }
  }
  if (windChanged) parts.push("wind changed meaningfully");
  if (humidityChanged) parts.push("humidity changed meaningfully");

  const summary = `Since yesterday: ${parts.join("; ")}.`;

  return {
    fire_risk_changed: fireChanged,
    flood_risk_changed: floodChanged,
    nws_alerts_changed: alertsChanged,
    wind_changed: windChanged,
    humidity_changed: humidityChanged,
    summary,
    previous_fetched_at: yesterday.fetched_at,
    current_fetched_at: current.fetched_at,
  };
}

export function formatDelta(delta: string | ZoneStateDelta): string {
  return typeof delta === "string" ? delta : delta.summary;
}
