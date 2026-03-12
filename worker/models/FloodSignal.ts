import type { BaseSignal } from "./Shared";

export interface FloodSignalProps {
  alert_level: "watch" | "warning";
  event: string;
  onset?: string | null;
  ends?: string | null;
  area_desc?: string;
  rain_rate_in_hr?: number | null;
  duration_minutes?: number | null;
}

export type FloodSignal = BaseSignal<"flood", FloodSignalProps>;