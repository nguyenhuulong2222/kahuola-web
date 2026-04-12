/**
 * Kahu Ola — Zone brief generator (Phase 1, deterministic template)
 *
 * Pure function: (zone profile + runtime state + household profile) → brief.
 * No AI, no upstream calls, no randomness. Same input always produces the
 * same output, so the cache and snapshot diff logic downstream stays honest.
 *
 * Phase 1 language note:
 *   `lang` is accepted and passed through, but template output is English
 *   only. ʻŌlelo Hawaiʻi and Vietnamese translations are Phase 2 work
 *   (Gemma 4) and will ship under a Beta — Community Review label.
 *
 * Invariants respected:
 *   II.  Every code path returns a valid brief — UI never goes blank.
 *   III. Never invents facts: every fact comes from the static zone
 *        profile or the runtime state; if a field is missing, the
 *        corresponding sentence is dropped, not guessed.
 *   V.   Never claims official authority: the brief points users at NWS
 *        / Maui Emergency Management for binding guidance.
 */

import type { ZoneProfile, ZoneDynamicState, RiskLevel } from "./zones";

export interface HouseholdProfile {
  kupuna: boolean;
  keiki: boolean;
  pets: boolean;
  medical: boolean; // daily medication or oxygen
  car: boolean;
}

export interface ZoneBriefInput {
  zone: ZoneProfile;
  state: ZoneDynamicState;
  household: HouseholdProfile;
  lang: string;
}

export interface ZoneBrief {
  headline: string;
  what_it_means: string;
  what_to_do: string;
  household_note: string | null;
  sources: string[];
  generated_by: "template" | "kahuola_ai";
  fallback_used: boolean;
}

type BriefBody = Pick<ZoneBrief, "headline" | "what_it_means" | "what_to_do">;

function isHighRisk(level: RiskLevel): boolean {
  return level === "HIGH" || level === "EXTREME";
}

function isExtreme(level: RiskLevel): boolean {
  return level === "EXTREME";
}

function firstSchoolName(zone: ZoneProfile): string | null {
  const s = zone.notable_locations.find((l) => l.type === "school");
  return s ? s.name : null;
}

function firstFloodHazard(zone: ZoneProfile): string {
  return zone.evacuation_routes.avoid_when_flood[0] ?? "low-lying water crossings";
}

function firstChokePoint(zone: ZoneProfile): string {
  return zone.evacuation_routes.choke_points[0] ?? "main road junctions";
}

function windPhrase(state: ZoneDynamicState): string {
  return state.wind_mph != null ? `${Math.round(state.wind_mph)} mph winds` : "elevated wind";
}

function humidityPhrase(state: ZoneDynamicState): string {
  return state.humidity_pct != null
    ? `humidity near ${Math.round(state.humidity_pct)}%`
    : "low humidity";
}

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toLowerCase() + s.slice(1);
}

function fireBrief(zone: ZoneProfile, state: ZoneDynamicState): BriefBody {
  const extreme = isExtreme(state.fire_risk);
  const wind = windPhrase(state);
  const humidity = humidityPhrase(state);

  const headline = extreme
    ? `${zone.zone_name}: Extreme fire weather — act now.`
    : `${zone.zone_name}: Elevated fire risk today.`;

  const what_it_means = extreme
    ? `Dry conditions, ${wind}, and ${humidity} mean any ignition in ${zone.zone_name} could spread quickly. The zone's baseline fire risk is ${state.fire_risk.toLowerCase()} and today's weather matches that pattern.`
    : `Fire weather is unfavorable in ${zone.zone_name} today. ${wind.charAt(0).toUpperCase() + wind.slice(1)} and ${humidity} allow small ignitions to grow faster than usual.`;

  const what_to_do =
    `Know your primary route out: ${zone.evacuation_routes.primary}. ` +
    `Expect ${firstChokePoint(zone)} to bottleneck if neighbors evacuate at the same time. ` +
    `Keep a go-bag accessible and clear flammable brush within a 5-foot structure perimeter. ` +
    `Follow official alerts from Maui Emergency Management and NWS Honolulu for any evacuation orders.`;

  return { headline, what_it_means, what_to_do };
}

function floodBrief(zone: ZoneProfile, state: ZoneDynamicState): BriefBody {
  const extreme = isExtreme(state.flood_risk);
  const hazard = firstFloodHazard(zone);

  const headline = extreme
    ? `${zone.zone_name}: Flash flood risk is high — act on alerts immediately.`
    : `${zone.zone_name}: Elevated flood risk today.`;

  const what_it_means = extreme
    ? `Heavy rainfall is possible in or above ${zone.zone_name}. ${zone.drainage_context}`
    : `Elevated rainfall may produce stream rise and localized flooding in ${zone.zone_name}. ${zone.drainage_context}`;

  const what_to_do =
    `Avoid ${hazard} and any water crossing where you cannot see the bottom. ` +
    `Primary safe route out of the zone: ${zone.evacuation_routes.primary}. ` +
    `Turn around, don't drown — six inches of moving water can sweep a person off their feet, twelve inches can float a vehicle. ` +
    `Monitor NWS Honolulu for flash flood warnings.`;

  return { headline, what_it_means, what_to_do };
}

function combinedBrief(zone: ZoneProfile, state: ZoneDynamicState): BriefBody {
  // Flood first per spec: water threats tend to arrive faster and block
  // the very routes needed to escape a wind-driven fire.
  const flood = floodBrief(zone, state);
  const fire = fireBrief(zone, state);

  return {
    headline: `${zone.zone_name}: Flood and fire risks are both elevated today.`,
    what_it_means: `${flood.what_it_means} At the same time, ${lowerFirst(fire.what_it_means)}`,
    what_to_do: `Flood first: ${flood.what_to_do} Fire next: ${fire.what_to_do}`,
  };
}

function quietBrief(zone: ZoneProfile, state: ZoneDynamicState): BriefBody {
  return {
    headline: `${zone.zone_name}: No elevated hazards right now.`,
    what_it_means:
      `Current conditions in ${zone.zone_name} are within normal range. ` +
      `The zone's baseline fire risk is ${state.fire_risk.toLowerCase()} and flood risk is ${state.flood_risk.toLowerCase()}.`,
    what_to_do:
      `Keep your go-bag current and confirm your primary evacuation route: ${zone.evacuation_routes.primary}. ` +
      `Review your household emergency plan while conditions are calm.`,
  };
}

function buildHouseholdNote(zone: ZoneProfile, household: HouseholdProfile): string | null {
  const notes: string[] = [];

  if (household.kupuna) {
    notes.push(
      "For kupuna in the household: confirm medications are accessible and that someone can reach them by phone if conditions change."
    );
  }

  if (household.keiki) {
    const school = firstSchoolName(zone);
    if (school) {
      notes.push(
        `For keiki: check ${school} for early-dismissal announcements and plan pickup before ${zone.evacuation_routes.primary} becomes congested.`
      );
    } else {
      notes.push(
        "For keiki: review the school's early-dismissal plan and confirm who is responsible for pickup."
      );
    }
  }

  if (household.pets) {
    notes.push(
      "For pets: shelter capacity is limited — have carriers, leashes, and water ready, and identify a pet-friendly destination in advance."
    );
  }

  if (household.medical) {
    notes.push(
      "For daily medication or oxygen: keep a 72-hour supply portable and verify battery backup for any powered equipment."
    );
  }

  if (!household.car) {
    // Rule: never suggest driving when car=false.
    notes.push(
      "Without a vehicle: coordinate now with a neighbor or family member who can provide a ride if an evacuation is ordered. Do not wait until an alert is issued."
    );
  }

  return notes.length > 0 ? notes.join(" ") : null;
}

/**
 * Generate a deterministic zone brief from the static zone profile and the
 * runtime state. `lang` is preserved for Phase 2 and does not affect
 * output content in Phase 1.
 */
export function generateZoneBrief(input: ZoneBriefInput): ZoneBrief {
  const { zone, state, household } = input;

  const fireHigh = isHighRisk(state.fire_risk);
  const floodHigh = isHighRisk(state.flood_risk);

  let base: BriefBody;
  if (fireHigh && floodHigh) {
    base = combinedBrief(zone, state);
  } else if (floodHigh) {
    base = floodBrief(zone, state);
  } else if (fireHigh) {
    base = fireBrief(zone, state);
  } else {
    base = quietBrief(zone, state);
  }

  return {
    headline: base.headline,
    what_it_means: base.what_it_means,
    what_to_do: base.what_to_do,
    household_note: buildHouseholdNote(zone, household),
    sources: state.sources.length > 0 ? state.sources : ["Kahu Ola zone profile"],
    generated_by: "template",
    fallback_used: false,
  };
}

/**
 * Minimal safe brief used when dynamic state cannot be built (upstream
 * failure, cache miss, internal error). Never blank, never misleading,
 * always points the user at official sources.
 */
export function generateFallbackBrief(zone: ZoneProfile, _lang: string): ZoneBrief {
  return {
    headline: `${zone.zone_name}: Live hazard data temporarily unavailable.`,
    what_it_means:
      `Kahu Ola could not retrieve current hazard conditions for ${zone.zone_name}. ` +
      `The zone's baseline: fire risk ${zone.typical_fire_risk.toLowerCase()}, flood risk ${zone.typical_flood_risk.toLowerCase()}.`,
    what_to_do:
      `Check NWS Honolulu alerts directly at weather.gov/hfo for the latest warnings. ` +
      `Know your primary evacuation route: ${zone.evacuation_routes.primary}.`,
    household_note: null,
    sources: ["Kahu Ola zone profile"],
    generated_by: "template",
    fallback_used: true,
  };
}
