import type { BaseSignal } from "./Shared";

export interface FireWeatherSignalProps {
  wind_mph: number | null;
  gust_mph: number | null;
  humidity_pct: number | null;
  red_flag: boolean;
  risk_level: "low" | "elevated" | "high" | "critical";
}

export type FireWeatherSignal = BaseSignal<"fire_weather", FireWeatherSignalProps>;