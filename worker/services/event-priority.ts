import type {
  FireSignal,
  FloodSignal,
  StormSignal,
  VolcanicSignal,
  FireWeatherSignal,
} from "../models";

export type PrimaryEventState =
  | "DEGRADED"
  | "FIRE_ACTIVE"
  | "FLOOD_WARNING"
  | "FLOOD_WATCH"
  | "STORM_ACTIVE"
  | "VOLCANIC_WATCH"
  | "FIRE_WEATHER_ELEVATED"
  | "MONITORING";

export interface EventPriorityInput {
  degraded: boolean;
  fireSignals: FireSignal[];
  floodSignals: FloodSignal[];
  stormSignals: StormSignal[];
  volcanicSignals?: VolcanicSignal[];
  fireWeatherSignals?: FireWeatherSignal[];
  regionScope: "statewide" | "island" | "local";
}

function isUsable<T extends { freshness: { state: string } }>(signal: T): boolean {
  return signal.freshness.state !== "STALE_DROP";
}

function hasActiveFire(signals: FireSignal[]): boolean {
  return signals.some(
    (s) =>
      isUsable(s) &&
      (s.display.severity === "WARNING" || s.display.severity === "CRITICAL" || s.display.severity === "WATCH"),
  );
}

function hasFloodWarning(signals: FloodSignal[]): boolean {
  return signals.some((s) => isUsable(s) && s.properties.alert_level === "warning");
}

function hasFloodWatch(signals: FloodSignal[]): boolean {
  return signals.some((s) => isUsable(s) && s.properties.alert_level === "watch");
}

function hasStorm(signals: StormSignal[]): boolean {
  return signals.some(
    (s) =>
      isUsable(s) &&
      (s.display.severity === "WATCH" ||
        s.display.severity === "WARNING" ||
        s.display.severity === "ELEVATED" ||
        s.display.severity === "CRITICAL"),
  );
}

function hasVolcanicWatch(signals: VolcanicSignal[] = []): boolean {
  return signals.some((s) => isUsable(s) && s.display.severity !== "CLEAR");
}

function hasElevatedFireWeather(signals: FireWeatherSignal[] = []): boolean {
  return signals.some((s) => {
    if (!isUsable(s)) return false;
    return (
      s.properties.risk_level === "elevated" ||
      s.properties.risk_level === "high" ||
      s.properties.risk_level === "critical"
    );
  });
}

export function selectPrimaryEvent(input: EventPriorityInput): PrimaryEventState {
  if (input.degraded) return "DEGRADED";
  if (hasActiveFire(input.fireSignals)) return "FIRE_ACTIVE";
  if (hasFloodWarning(input.floodSignals)) return "FLOOD_WARNING";
  if (hasFloodWatch(input.floodSignals)) return "FLOOD_WATCH";
  if (hasStorm(input.stormSignals)) return "STORM_ACTIVE";
  if (hasVolcanicWatch(input.volcanicSignals)) return "VOLCANIC_WATCH";
  if (hasElevatedFireWeather(input.fireWeatherSignals)) return "FIRE_WEATHER_ELEVATED";
  return "MONITORING";
}