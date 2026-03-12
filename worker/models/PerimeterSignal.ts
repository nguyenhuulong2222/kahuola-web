import type { BaseSignal } from "./Shared";

export interface PerimeterSignalProps {
  incident_name: string;
  official: boolean;
  acres: number | null;
  containment_pct: number | null;
  status: "active" | "contained" | "unknown";
}

export type PerimeterSignal = BaseSignal<"perimeter", PerimeterSignalProps>;