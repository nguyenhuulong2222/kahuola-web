export const HERO_STATE_COPY = {
  DEGRADED: {
    title: "Hazard Signals Temporarily Degraded",
    summary: "Some data sources are delayed. Kahu Ola is showing the latest verified data available.",
    context: "System status from Kahu Ola Worker health checks.",
  },
  FIRE_ACTIVE: {
    title: "Wildfire Signal Active",
    summary: "Fire-related signals are currently elevated in the latest statewide snapshot.",
    context: "Primary source: NASA FIRMS hotspot detections.",
  },
  FLOOD_WARNING: {
    title: "Flood Warning Context Active",
    summary: "Flood warning indicators are present in current statewide context.",
    context: "Primary source: NWS flash-flood warning geometry.",
  },
  FLOOD_WATCH: {
    title: "Flood Watch Context Active",
    summary: "Flood watch or elevated flood context is active in current statewide conditions.",
    context: "Primary source: NWS alerts with flood-context support.",
  },
  STORM_ACTIVE: {
    title: "Kona Storm / Rain Context Active",
    summary: "Rain and storm context is elevated across Hawai'i in the current snapshot.",
    context: "Primary sources: NOAA/NWS rain-radar and flood-context signals.",
  },
  MONITORING: {
    title: "Statewide Hazard Monitoring",
    summary: "No major statewide hazard is currently elevated in the latest verified snapshot.",
    context: "Sources are available and being monitored.",
  },
};

export function resolveHeroState(primaryEvent) {
  return HERO_STATE_COPY[primaryEvent] ?? HERO_STATE_COPY.MONITORING;
}