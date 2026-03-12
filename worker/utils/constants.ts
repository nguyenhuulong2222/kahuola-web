export const SCHEMA_VERSION = "4.8" as const;

export const TTL = {
  FIRE_SECONDS: 15 * 60,
  FIRE_STALE_OK_SECONDS: 60 * 60,

  NWS_ALERT_SECONDS: 10 * 60,
  NWS_ALERT_STALE_OK_SECONDS: 30 * 60,
};

export const COLORS = {
  FIRE: "red" as const,
  FLOOD: "blue" as const,
  STORM: "blue" as const,
  CLEAR: "green" as const,
  UNKNOWN: "gray" as const,
};
