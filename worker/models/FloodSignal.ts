import type { BaseSignal } from "./Shared";

export interface FloodSignalProps {
  alert_level: "watch" | "warning";
  event: string;
  onset?: string | null;
  ends?: string | null;
  area_desc?: string;
}

export type FloodSignal = BaseSignal<FloodSignalProps> & {
  signal_type: "flood";
};
