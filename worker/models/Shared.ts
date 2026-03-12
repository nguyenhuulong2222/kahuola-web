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
  | "flood"
  | "storm";

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
  color: "green" | "blue" | "yellow" | "orange" | "red" | "gray";
  confidence_label?: string;
}

export interface BaseSignal<TProps = Record<string, unknown>> {
  schema_version: "4.8";
  signal_type: SignalType;
  signal_id: string;
  region: string;
  scope: "local" | "island" | "statewide";
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
