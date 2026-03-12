import type { FireSignal, ParseResult } from "../models";
import { buildFreshnessMeta } from "../services/freshness-engine";
import { SCHEMA_VERSION, FRESHNESS_POLICY } from "../utils/constants";
import { pointGeometry } from "../utils/geojson";
import { formatAcqDateTimeUtc } from "../utils/time";
import {
  assertArray,
  assertNumber,
  assertObject,
  optionalNumber,
  optionalString,
} from "../utils/validation";

type FirmsRow = Record<string, unknown>;

function normalizeConfidence(value: unknown): "low" | "nominal" | "high" {
  const raw = String(value ?? "").toLowerCase().trim();
  if (raw === "h" || raw === "high") return "high";
  if (raw === "l" || raw === "low") return "low";
  return "nominal";
}

function severityFromFire(confidence: "low" | "nominal" | "high", frpMw: number | null) {
  if (confidence === "high" && (frpMw ?? 0) >= 50) return "WARNING" as const;
  if (confidence === "high") return "WATCH" as const;
  if (confidence === "nominal") return "WATCH" as const;
  return "LOW" as const;
}

function colorFromSeverity(severity: "LOW" | "WATCH" | "WARNING"): "yellow" | "orange" | "red" {
  if (severity === "WARNING") return "red";
  if (severity === "WATCH") return "orange";
  return "yellow";
}

export function parseFirmsPayload(payload: unknown, region = "hawaii"): ParseResult<FireSignal> {
  const errors: string[] = [];
  const items: FireSignal[] = [];
  let dropped = 0;

  try {
    const rows = assertArray(payload, "payload");

    for (let i = 0; i < rows.length; i += 1) {
      try {
        const row = assertObject(rows[i], `payload[${i}]`) as FirmsRow;

        const lat = assertNumber(row.latitude, "latitude");
        const lon = assertNumber(row.longitude, "longitude");

        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          throw new Error("latitude/longitude out of range");
        }

        const confidence = normalizeConfidence(row.confidence);
        const frp = optionalNumber(row.frp);
        const satellite = optionalString(row.satellite) ?? "VIIRS";
        const acqDatetime = formatAcqDateTimeUtc(
          optionalString(row.acq_date) ?? undefined,
          row.acq_time,
        );

        const severity = severityFromFire(confidence, frp);

        const signal: FireSignal = {
          schema_version: SCHEMA_VERSION,
          signal_type: "fire",
          signal_id: `fire_${region}_${i}_${lat}_${lon}`,
          region,
          scope: "local",
          source: {
            provider: "NASA FIRMS",
            product: satellite,
            official: false,
          },
          freshness: buildFreshnessMeta(acqDatetime, FRESHNESS_POLICY.fire),
          display: {
            headline: "Fire signal detected",
            summary: "Satellite hotspot detected in the current hazard snapshot.",
            severity,
            color: colorFromSeverity(severity),
            confidence_label:
              confidence.charAt(0).toUpperCase() + confidence.slice(1),
          },
          properties: {
            confidence,
            frp_mw: frp,
            satellite,
            distance_miles: null,
            wind_mph: null,
            wind_direction: null,
            humidity_pct: null,
            satellite_only: true,
            latitude: lat,
            longitude: lon,
            acq_datetime_utc: acqDatetime,
          },
          geometry: pointGeometry(lon, lat),
        };

        // Fail-closed: never emit stale-drop records as operational signals.
        if (signal.freshness.state === "STALE_DROP") {
          dropped += 1;
          continue;
        }

        items.push(signal);
      } catch (err) {
        dropped += 1;
        errors.push(`FIRMS row ${i} dropped: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    errors.push(`FIRMS payload rejected: ${(err as Error).message}`);
  }

  return { items, dropped, errors };
}