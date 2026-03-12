import type { BaseSignal } from "./Shared";

export interface AirQualitySignalProps {
  aqi: number | null;
  category: string;
  pm25: number | null;
  health_note: string;
}

export type AirQualitySignal = BaseSignal<"air_quality", AirQualitySignalProps>;