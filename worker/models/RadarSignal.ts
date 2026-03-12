import type { BaseSignal } from "./Shared";

export interface RadarSignalProps {
  rain_rate_in_hr: number | null;
  coverage: "localized" | "broad" | "statewide" | "unknown";
  sustained_minutes: number | null;
}

export type RadarSignal = BaseSignal<"radar", RadarSignalProps>;