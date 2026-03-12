export type FreshnessState = "FRESH" | "STALE_OK" | "STALE_DROP";

export type Severity =
  | "CLEAR"
  | "LOW"
  | "ELEVATED"
  | "WATCH"
  | "WARNING"
  | "CRITICAL"
  | "UNKNOWN";

export type SignalType =
  | "fire"
  | "smoke"
  | "perimeter"
  | "flood"
  | "storm"
  | "radar"
  | "air_quality"
  | "ocean"
  | "volcanic"
  | "fire_weather";

export type Scope = "local" | "island" | "statewide";

export type DisplayColor = "green" | "blue" | "yellow" | "orange" | "red" | "gray";

export interface SourceMeta {
  provider: string;
  product: string;
  official: boolean;
}

export interface FreshnessMeta {
  state: FreshnessState;
  generated_at: string;
  last_checked_at: string;
  stale_after_seconds: number;
}

export interface DisplayMeta {
  headline: string;
  summary: string;
  severity: Severity;
  color: DisplayColor;
  confidence_label?: string;
}

export interface BaseSignal<TSignalType extends SignalType, TProps = Record<string, unknown>> {
  schema_version: "4.8";
  signal_type: TSignalType;
  signal_id: string;
  region: string;
  scope: Scope;
  source: SourceMeta;
  freshness: FreshnessMeta;
  display: DisplayMeta;
  properties: TProps;
  geometry: GeoJSON.Geometry | null;
}

export interface ParseResult<T> {
  items: T[];
  dropped: number;
  errors: string[];
}