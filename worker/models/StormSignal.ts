import type { BaseSignal } from "./Shared";

export interface StormSignalProps {
  event: string;
  urgency?: string | null;
  severity_text?: string | null;
  certainty?: string | null;
  area_desc?: string;
  wind_mph?: number | null;
  gust_mph?: number | null;
}

export type StormSignal = BaseSignal<"storm", StormSignalProps>;