const PRIORITY = [
  "DEGRADED",
  "FIRE_ACTIVE",
  "FLOOD_WARNING",
  "FLOOD_WATCH",
  "STORM_ACTIVE",
  "VOLCANIC_WATCH",
  "FIRE_WEATHER_ELEVATED",
  "MONITORING",
];

export function rankEvent(primaryEvent) {
  const idx = PRIORITY.indexOf(primaryEvent);
  return idx === -1 ? PRIORITY.length : idx;
}

export function isDegraded(primaryEvent, degradedFlag) {
  return degradedFlag === true || primaryEvent === "DEGRADED";
}