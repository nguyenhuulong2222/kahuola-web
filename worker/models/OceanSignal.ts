import type { BaseSignal } from "./Shared";

export interface OceanSignalProps {
  advisory: string;
  shore: string;
  severity_level: "watch" | "warning" | "unknown";
}

export type OceanSignal = BaseSignal<"ocean", OceanSignalProps>;