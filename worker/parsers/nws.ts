import type { FloodSignal, ParseResult, StormSignal } from "../models";
import { buildFreshnessMeta } from "../services/freshness-engine";
import { SCHEMA_VERSION, FRESHNESS_POLICY, COLORS } from "../utils/constants";
import {
  assertArray,
  assertObject,
  assertString,
  optionalString,
} from "../utils/validation";

interface NwsFeature extends Record<string, unknown> {
  properties?: Record<string, unknown>;
  geometry?: GeoJSON.Geometry | null;
}

interface NwsFeatureCollection {
  type: string;
  features: NwsFeature[];
}

function alertSeverity(event: string): "WATCH" | "WARNING" | "ELEVATED" | "UNKNOWN" {
  const e = event.toLowerCase();
  if (e.includes("warning")) return "WARNING";
  if (e.includes("watch")) return "WATCH";
  if (e.includes("storm") || e.includes("hurricane") || e.includes("wind")) return "ELEVATED";
  return "UNKNOWN";
}

function isFloodEvent(event: string): boolean {
  const e = event.toLowerCase();
  return e.includes("flood");
}

function isStormEvent(event: string): boolean {
  const e = event.toLowerCase();
  return e.includes("storm") || e.includes("hurricane") || e.includes("wind");
}

export function parseNwsAlerts(
  payload: unknown,
  region = "hawaii",
): {
  floodSignals: ParseResult<FloodSignal>;
  stormSignals: ParseResult<StormSignal>;
} {
  const floodItems: FloodSignal[] = [];
  const stormItems: StormSignal[] = [];
  const floodErrors: string[] = [];
  const stormErrors: string[] = [];
  let floodDropped = 0;
  let stormDropped = 0;

  try {
    const root = assertObject(payload, "payload") as NwsFeatureCollection;
    if (root.type !== "FeatureCollection") {
      throw new Error("NWS payload is not FeatureCollection");
    }

    const features = assertArray(root.features, "features");

    for (let i = 0; i < features.length; i += 1) {
      try {
        const feature = assertObject(features[i], `feature[${i}]`) as NwsFeature;
        const props = assertObject(feature.properties, `feature[${i}].properties`);

        const event = assertString(props.event, "event");
        const sent = optionalString(props.sent) ?? optionalString(props.effective);
        const areaDesc = optionalString(props.areaDesc) ?? "Affected area";

        if (isFloodEvent(event)) {
          const level = event.toLowerCase().includes("warning") ? "warning" : "watch";

          const signal: FloodSignal = {
            schema_version: SCHEMA_VERSION,
            signal_type: "flood",
            signal_id: `flood_${region}_${i}`,
            region,
            scope: "island",
            source: {
              provider: "NWS Honolulu",
              product: "api.weather.gov alerts",
              official: true,
            },
            freshness: buildFreshnessMeta(sent, FRESHNESS_POLICY.flood),
            display: {
              headline: event,
              summary: `${event} affecting ${areaDesc}.`,
              severity: level === "warning" ? "WARNING" : "WATCH",
              color: COLORS.FLOOD,
            },
            properties: {
              alert_level: level,
              event,
              onset: optionalString(props.onset),
              ends: optionalString(props.ends),
              area_desc: areaDesc,
            },
            geometry: feature.geometry ?? null,
          };

          if (signal.freshness.state === "STALE_DROP") {
            floodDropped += 1;
            continue;
          }

          floodItems.push(signal);
          continue;
        }

        if (isStormEvent(event)) {
          const severity = alertSeverity(event);

          const signal: StormSignal = {
            schema_version: SCHEMA_VERSION,
            signal_type: "storm",
            signal_id: `storm_${region}_${i}`,
            region,
            scope: "statewide",
            source: {
              provider: "NWS Honolulu",
              product: "api.weather.gov alerts",
              official: true,
            },
            freshness: buildFreshnessMeta(sent, FRESHNESS_POLICY.storm),
            display: {
              headline: event,
              summary: `${event} affecting ${areaDesc}.`,
              severity,
              color: COLORS.STORM,
            },
            properties: {
              event,
              urgency: optionalString(props.urgency),
              severity_text: optionalString(props.severity),
              certainty: optionalString(props.certainty),
              area_desc: areaDesc,
            },
            geometry: feature.geometry ?? null,
          };

          if (signal.freshness.state === "STALE_DROP") {
            stormDropped += 1;
            continue;
          }

          stormItems.push(signal);
        }
      } catch (err) {
        const msg = `NWS feature ${i} dropped: ${(err as Error).message}`;
        floodErrors.push(msg);
        stormErrors.push(msg);
        floodDropped += 1;
        stormDropped += 1;
      }
    }
  } catch (err) {
    const msg = `NWS payload rejected: ${(err as Error).message}`;
    floodErrors.push(msg);
    stormErrors.push(msg);
  }

  return {
    floodSignals: {
      items: floodItems,
      dropped: floodDropped,
      errors: floodErrors,
    },
    stormSignals: {
      items: stormItems,
      dropped: stormDropped,
      errors: stormErrors,
    },
  };
}