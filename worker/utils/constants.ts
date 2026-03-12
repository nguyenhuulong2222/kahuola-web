export const SCHEMA_VERSION = "4.8" as const;

export const DEFAULT_REGION = "hawaii" as const;

export const FRESHNESS_POLICY = {
  fire: { fresh_seconds: 15 * 60, stale_ok_seconds: 60 * 60 },
  smoke: { fresh_seconds: 30 * 60, stale_ok_seconds: 2 * 60 * 60 },
  perimeter: { fresh_seconds: 60 * 60, stale_ok_seconds: 6 * 60 * 60 },
  flood: { fresh_seconds: 10 * 60, stale_ok_seconds: 30 * 60 },
  storm: { fresh_seconds: 10 * 60, stale_ok_seconds: 30 * 60 },
  radar: { fresh_seconds: 10 * 60, stale_ok_seconds: 30 * 60 },
  air_quality: { fresh_seconds: 30 * 60, stale_ok_seconds: 2 * 60 * 60 },
  ocean: { fresh_seconds: 30 * 60, stale_ok_seconds: 2 * 60 * 60 },
  volcanic: { fresh_seconds: 30 * 60, stale_ok_seconds: 2 * 60 * 60 },
  fire_weather: { fresh_seconds: 30 * 60, stale_ok_seconds: 2 * 60 * 60 },
} as const;

export const TTL = {
  FIRE_SECONDS: FRESHNESS_POLICY.fire.fresh_seconds,
  FIRE_STALE_OK_SECONDS: FRESHNESS_POLICY.fire.stale_ok_seconds,
  NWS_ALERT_SECONDS: FRESHNESS_POLICY.flood.fresh_seconds,
  NWS_ALERT_STALE_OK_SECONDS: FRESHNESS_POLICY.flood.stale_ok_seconds,
  HOME_SUMMARY_SECONDS: 60,
  HEALTH_SECONDS: 60,
} as const;

export const COLORS = {
  FIRE: "red",
  FLOOD: "blue",
  STORM: "blue",
  CLEAR: "green",
  UNKNOWN: "gray",
} as const;

export const CACHE_SCOPE = {
  HAZARD: "hazard",
  HOME: "home",
  HEALTH: "health",
  CONTEXT: "context",
  SYSTEM: "system",
} as const;

export const API_PATHS = {
  HOME_SUMMARY: "/v1/home/summary",
  HAZARDS_FIRE: "/v1/hazards/fire",
  HAZARDS_SMOKE: "/v1/hazards/smoke",
  HAZARDS_PERIMETERS: "/v1/hazards/perimeters",
  CONTEXT_FLOOD: "/v1/context/flood",
  CONTEXT_STORM: "/v1/context/storm",
  CONTEXT_RADAR: "/v1/context/radar",
  CONTEXT_AIR: "/v1/context/air",
  CONTEXT_OCEAN: "/v1/context/ocean",
  SYSTEM_HEALTH: "/v1/system/health",
  SYSTEM_STATUS: "/v1/system/status",
} as const;

export const PRIMARY_EVENT_PRIORITY = [
  "DEGRADED",
  "FIRE_ACTIVE",
  "FLOOD_WARNING",
  "FLOOD_WATCH",
  "STORM_ACTIVE",
  "VOLCANIC_WATCH",
  "FIRE_WEATHER_ELEVATED",
  "MONITORING",
] as const;