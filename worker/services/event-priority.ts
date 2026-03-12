import type { FireSignal, FloodSignal, StormSignal } from "../models";

export type PrimaryEventState =
  | "DEGRADED"
  | "FIRE_ACTIVE"
  | "FLOOD_WARNING"
  | "FLOOD_WATCH"
  | "STORM_ACTIVE"
  | "MONITORING";

export interface EventPriorityInput {
  degraded: boolean;
  fireSignals: FireSignal[];
  floodSignals: FloodSignal[];
  stormSignals: StormSignal[];
  regionScope: "statewide" | "island" | "local";
}

function hasActiveFire(signals: FireSignal[]): boolean {
  return signals.some((s) =>
    s.freshness.state !== "STALE_DROP" &&
    (s.display.severity === "WARNING" || s.display.severity === "CRITICAL")
  );
}

function hasFloodWarning(signals: FloodSignal[]): boolean {
  return signals.some((s) =>
    s.freshness.state !== "STALE_DROP" &&
    s.properties.alert_level === "warning"
  );
}

function hasFloodWatch(signals: FloodSignal[]): boolean {
  return signals.some((s) =>
    s.freshness.state !== "STALE_DROP" &&
    s.properties.alert_level === "watch"
  );
}

function hasStorm(signals: StormSignal[]): boolean {
  return signals.some((s) =>
    s.freshness.state !== "STALE_DROP" &&
    (s.display.severity === "WATCH" ||
      s.display.severity === "WARNING" ||
      s.display.severity === "ELEVATED")
  );
}

export function selectPrimaryEvent(input: EventPriorityInput): PrimaryEventState {
  if (input.degraded) return "DEGRADED";
  if (hasActiveFire(input.fireSignals)) return "FIRE_ACTIVE";
  if (hasFloodWarning(input.floodSignals)) return "FLOOD_WARNING";
  if (hasFloodWatch(input.floodSignals)) return "FLOOD_WATCH";
  if (hasStorm(input.stormSignals)) return "STORM_ACTIVE";
  return "MONITORING";
}
