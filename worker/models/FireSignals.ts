import type { BaseSignal } from "./Shared";

export interface FireSignalProps {
  confidence: "low" | "nominal" | "high";
  frp_mw: number | null;
  satellite: string;
  distance_miles: number | null;
  wind_mph: number | null;
  wind_direction: string | null;
  humidity_pct: number | null;
  satellite_only: boolean;
  latitude: number;
  longitude: number;
  acq_datetime_utc: string | null;
}

export type FireSignal = BaseSignal<FireSignalProps> & {
  signal_type: "fire";
};
