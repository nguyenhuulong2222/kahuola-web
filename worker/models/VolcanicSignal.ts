import type { BaseSignal } from "./Shared";

export interface VolcanicSignalProps {
  so2_elevated: boolean;
  vog_advisory: boolean;
  districts: string[];
}

export type VolcanicSignal = BaseSignal<"volcanic", VolcanicSignalProps>;