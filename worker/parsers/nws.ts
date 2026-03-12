import type { FloodSignal, ParseResult, StormSignal } from "../models";
import { buildFreshnessMeta } from "../services/freshness-engine";
import { SCHEMA_VERSION, COLORS, TTL } from "../utils/constants";
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
  if (e.includes("storm")) return "ELEVATED";
  return "UNKNOWN";
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
        const severity = alertSeverity(event);

        if (event.toLowerCase().includes("flood")) {
          const level = event.toLowerCase().includes("warning") ? "warning" : "watch";

          floodItems.push({
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
            freshness: buildFreshnessMeta(sent, {
              fresh_seconds: TTL.NWS_ALERT_SECONDS,
              stale_ok_seconds: TTL.NWS_ALERT_STALE_OK_SECONDS,
            }),
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
            geometry: (feature.geometry as GeoJSON.Geometry | null) ?? null,
          });
        } else if (
          event.toLowerCase().includes("storm") ||
          event.toLowerCase().includes("hurricane") ||
          event.toLowerCase().includes("wind")
        ) {
          stormItems.push({
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
            freshness: buildFreshnessMeta(sent, {
              fresh_seconds: TTL.NWS_ALERT_SECONDS,
              stale_ok_seconds: TTL.NWS_ALERT_STALE_OK_SECONDS,
            }),
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
            geometry: (feature.geometry as GeoJSON.Geometry | null) ?? null,
          });
        }
      } catch (err) {
        const msg = `NWS feature ${i} dropped: ${(err as Error).message}`;
        floodDropped += 1;
        stormDropped += 1;
        floodErrors.push(msg);
        stormErrors.push(msg);
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
