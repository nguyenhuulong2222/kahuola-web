import type { BaseSignal } from "./Shared";

export interface StormSignalProps {
  event: string;
  urgency?: string | null;
  severity_text?: string | null;
  certainty?: string | null;
  area_desc?: string;
}

export type StormSignal = BaseSignal<StormSignalProps> & {
  signal_type: "storm";
};
