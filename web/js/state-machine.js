export const HERO_STATE_COPY = {
  DEGRADED: {
    title: "Hazard Signals Temporarily Degraded",
    summary: "Some data sources are delayed. Use official alerts while verification is limited.",
  },
  FIRE_ACTIVE: {
    title: "Wildfire Signal Active",
    summary: "Fire-related signals are currently elevated in the latest snapshot.",
  },
  FLOOD_WARNING: {
    title: "Flood Warning Active",
    summary: "Flooding may be occurring or imminent in affected areas.",
  },
  FLOOD_WATCH: {
    title: "Flood Watch In Effect",
    summary: "Conditions may support flooding in valleys, stream corridors, and low-lying roads.",
  },
  STORM_ACTIVE: {
    title: "Statewide Storm Conditions",
    summary: "Heavy rain, wind, or rough seas are affecting Hawai'i conditions.",
  },
  VOLCANIC_WATCH: {
    title: "Volcanic Watch",
    summary: "Volcanic conditions are being monitored where relevant.",
  },
  FIRE_WEATHER_ELEVATED: {
    title: "Elevated Fire Weather",
    summary: "Wind and low humidity may increase wildfire spread risk.",
  },
  MONITORING: {
    title: "Statewide Hazard Monitoring",
    summary: "No major statewide hazard is currently elevated in the latest verified snapshot.",
  },
};

export function resolveHeroState(primaryEvent) {
  return HERO_STATE_COPY[primaryEvent] ?? HERO_STATE_COPY.MONITORING;
}