import type { BaseSignal } from "./Shared";

export interface SmokeSignalProps {
  aqi: number | null;
  pm25: number | null;
  plume_density: "light" | "moderate" | "dense" | "unknown";
  sensitive_groups_warning: boolean;
}

export type SmokeSignal = BaseSignal<"smoke", SmokeSignalProps>;