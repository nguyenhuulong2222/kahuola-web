import type { BaseSignal } from "./Shared";

// ─────────────────────────────────────────────────────────────────────────────
// CIVIC CONTRACT NOTE
//
// FireSignal là OBSERVATION-LEVEL schema.
// Nó KHÔNG phải confirmed public hazard, fire incident, evacuation order,
// hay public warning level.
//
// Downstream UI/logic phải:
//   - Không hiển thị FireSignal như "fire confirmed" mà không có corroboration
//   - Luôn kèm theo signal_class để user hiểu bản chất của tín hiệu
//   - Luôn hiển thị observed_at_utc và freshness_status
//   - Không merge với PerimeterSignal hay SmokeSignal mà không kiểm tra source
//
// "official_hazard" trong signal_class chỉ dùng khi tín hiệu ĐẾN TỪ official_feed
// VÀ source_reliability === "primary". Worker phải enforce — không gắn tùy tiện.
//
// Invariant V applies: estimated data NEVER presented as official.
// ─────────────────────────────────────────────────────────────────────────────


// ─── Signal classification ────────────────────────────────────────────────────

/**
 * Phân loại bản chất của tín hiệu.
 *
 * "satellite_detection"   — điểm nóng thô từ VIIRS/MODIS. Chưa xác nhận.
 *                           Giá trị phổ biến nhất từ NASA FIRMS.
 *
 * "derived_signal"        — qua xử lý nội bộ / terrain scoring của Kahu Ola.
 *                           Không phải observation trực tiếp.
 *
 * "confirmed_observation" — xác nhận từ ≥ 2 nguồn độc lập hoặc ground truth.
 *
 * "official_hazard"       — từ official feed của cơ quan có thẩm quyền.
 *                           ĐIỀU KIỆN BẮT BUỘC:
 *                             provenance.processing_origin === "official_feed"
 *                             AND provenance.source_reliability === "primary"
 *                           Validator sẽ DROP signal nếu vi phạm.
 *
 * UI phải hiển thị signal_class — không được ẩn.
 * Không được treat "satellite_detection" như "official_hazard".
 */
export type FireSignalClass =
  | "satellite_detection"
  | "derived_signal"
  | "confirmed_observation"
  | "official_hazard";


// ─── Detection confidence ─────────────────────────────────────────────────────

/**
 * Độ tin cậy của phép ĐO/PHÁT HIỆN của satellite.
 * KHÔNG phải mức độ nguy hiểm của đám cháy.
 *
 * Nguồn: NASA FIRMS confidence classification
 *   "low"     — < 30%: tín hiệu yếu, nhiều khả năng false positive
 *   "nominal" — 30–79%: tín hiệu trung bình
 *   "high"    — ≥ 80%: tín hiệu mạnh, ít false positive
 *
 * UI label phải là "Detection confidence: High"
 * KHÔNG phải "Fire risk: High" hay "Severity: High".
 */
export type DetectionConfidence = "low" | "nominal" | "high";


// ─── Measurement basis ────────────────────────────────────────────────────────

/**
 * Nguồn gốc của các weather metrics (wind_mph, wind_direction, humidity_pct).
 *
 * "directly_observed" — đo trực tiếp từ sensor/satellite
 * "station_reported"  — từ trạm thời tiết mặt đất (RAWS, MesoWest)
 * "model_estimated"   — từ mô hình khí tượng / NWP
 * "terrain_inferred"  — nội suy từ địa hình Hawaiʻi (SMART_HAWAII_CELLS)
 * "unavailable"       — không có dữ liệu thời tiết cho tín hiệu này
 */
export type MeasurementBasis =
  | "directly_observed"
  | "station_reported"
  | "model_estimated"
  | "terrain_inferred"
  | "unavailable";


// ─── Wind direction ───────────────────────────────────────────────────────────

/**
 * Hướng gió theo 8 điểm la bàn (WMO standard: hướng GIÓ ĐẾN — wind FROM this direction).
 * Ví dụ: "NE" = gió từ hướng Đông Bắc thổi tới.
 * null khi không có dữ liệu hoặc weather_measurement_basis === "unavailable".
 */
export type CardinalDirection =
  | "N" | "NE" | "E" | "SE"
  | "S" | "SW" | "W" | "NW";


// ─── Freshness status ─────────────────────────────────────────────────────────

/**
 * Trạng thái độ mới — do worker tính tại thời điểm build response.
 *
 * "FRESH"      — < 15 phút. Dùng được cho alert.
 * "STALE_OK"   — 15–60 phút. Hiển thị kèm "Data may be outdated".
 * "STALE_DROP" — > 60 phút. KHÔNG dùng cho alert. UI phải label rõ "OUTDATED".
 *
 * Client KHÔNG được tự tính từ timestamps.
 */
export type FreshnessStatus = "FRESH" | "STALE_OK" | "STALE_DROP";


// ─── Signal lifecycle state ───────────────────────────────────────────────────

/**
 * Vòng đời của tín hiệu trong hệ thống Kahu Ola.
 *
 * "new"        — lần đầu xuất hiện trong ingest cycle hiện tại
 * "active"     — vẫn trong TTL, chưa có evidence đã tắt
 * "updating"   — đang được cập nhật từ nguồn mới hơn
 * "expired"    — TTL hết hạn, chờ drop
 * "historical" — giữ cho audit, KHÔNG dùng cho alert
 *
 * Chỉ "new" và "active" được phép trigger notification/alert.
 */
export type SignalState = "new" | "active" | "updating" | "expired" | "historical";


// ─── Source provenance ────────────────────────────────────────────────────────

/**
 * Known upstream data agencies.
 * Dùng "OTHER" cho nguồn chưa có trong danh sách.
 * Khi source_agency === "OTHER", source_agency_label là BẮT BUỘC.
 * Khi source_agency !== "OTHER", source_agency_label phải là null.
 */
export type KnownSourceAgency =
  | "NASA_FIRMS"       // NASA Fire Information for Resource Management System
  | "NOAA_HMS"         // NOAA Hazard Mapping System (smoke/fire polygons)
  | "NIFC_WFIGS"       // National Interagency Fire Center perimeters
  | "NWS"              // National Weather Service alerts
  | "USGS"             // USGS / Hawaiian Volcano Observatory
  | "PACIOOS"          // Pacific Islands Ocean Observing System
  | "KAHUOLA_DERIVED"  // Kahu Ola internal terrain/scoring logic
  | "OTHER";           // Unlisted source — must set source_agency_label

export interface FireSignalProvenance {
  source_agency: KnownSourceAgency;

  /**
   * Bắt buộc khi source_agency === "OTHER". Null cho mọi giá trị known khác.
   * Ví dụ: "RAWS MesoWest station data", "Maui County EOC report"
   */
  source_agency_label: string | null;

  source_type: "satellite" | "ground_station" | "model" | "official_report" | "terrain_derived";
  source_reliability: "primary" | "secondary" | "supplemental";

  /**
   * "upstream_raw"    — dữ liệu thô, chưa qua Kahu Ola
   * "kahuola_derived" — đã qua xử lý/scoring của Worker
   * "official_feed"   — từ official feed đã xác nhận (prerequisite cho signal_class "official_hazard")
   */
  processing_origin: "upstream_raw" | "kahuola_derived" | "official_feed";

  /** URL hoặc identifier của upstream record. null nếu không có. */
  upstream_ref: string | null;
}


// ─── Hawaiʻi-specific geographic context ─────────────────────────────────────

/**
 * Context địa lý đặc thù Hawaiʻi.
 * Worker gắn nếu có thể tính từ fire coordinates.
 * Client KHÔNG được tự tính từ lat/lng.
 * null nếu worker chưa implement geographic mapping.
 */
export interface HawaiiGeoContext {
  island: "Maui" | "Hawaii" | "Oahu" | "Kauai" | "Molokai" | "Lanai" | "Kahoolawe" | "Niihau" | null;
  county: "Maui" | "Hawaii" | "Honolulu" | "Kauai" | null;
  /**
   * true  = phía leeward (khuất gió) — khô hơn, cháy lan nhanh hơn.
   * false = phía windward.
   * null  = chưa tính hoặc không xác định được.
   */
  leeward: boolean | null;
  /** ID của SMART_HAWAII_CELL địa hình gần nhất. null nếu chưa có mapping. */
  terrain_cell_id: string | null;
}


// ─── Null reason ──────────────────────────────────────────────────────────────

/**
 * Lý do signal-level cho các nullable field có giá trị null.
 *
 * "not_available"    — upstream không cung cấp field này
 * "not_applicable"   — field không áp dụng cho loại observation này
 * "not_yet_computed" — worker chưa tính (queued hoặc pending)
 * "sensor_error"     — sensor báo lỗi hoặc giá trị out-of-range
 *
 * null nghĩa là không có nullable field nào cần giải thích đặc biệt.
 */
export type NullReason =
  | "not_available"
  | "not_applicable"
  | "not_yet_computed"
  | "sensor_error";


// ─────────────────────────────────────────────────────────────────────────────
// FireSignalProps — V2.1
// ─────────────────────────────────────────────────────────────────────────────

export interface FireSignalProps {

  // ── Identity ──────────────────────────────────────────────────────────────────

  /**
   * ID ổn định trong hệ thống Kahu Ola — dùng để dedupe across ingest cycles.
   * Format: "fire_{source_agency}_{lat_6dp}_{lng_6dp}_{acq_date_yyyymmdd}"
   * Ví dụ: "fire_NASA_FIRMS_20.878300_-156.682500_20260406"
   * Worker tạo, client chỉ đọc.
   */
  signal_id: string;

  /** ID gốc từ upstream nếu có. null nếu upstream không cung cấp. */
  source_observation_id: string | null;

  // ── Signal classification ─────────────────────────────────────────────────────

  /** Phân loại bản chất tín hiệu. UI phải hiển thị — không được ẩn. */
  signal_class: FireSignalClass;

  // ── Detection confidence ──────────────────────────────────────────────────────

  /**
   * Độ tin cậy của phép ĐO vệ tinh — KHÔNG phải mức nguy hiểm.
   * UI label: "Detection confidence" — KHÔNG PHẢI "Fire risk".
   */
  detection_confidence: DetectionConfidence;

  /**
   * Mô tả cơ sở của detection_confidence.
   * Ví dụ: "NASA FIRMS VIIRS confidence score ≥ 80%"
   * null nếu upstream không cung cấp metadata.
   */
  confidence_basis: string | null;

  // ── Measurement basis ─────────────────────────────────────────────────────────

  /** Nguồn gốc chung của weather metrics (wind, humidity). */
  weather_measurement_basis: MeasurementBasis;

  // ── Core detection fields ─────────────────────────────────────────────────────

  /** Fire Radiative Power (MW) từ satellite. null nếu upstream không cung cấp. */
  frp_mw: number | null;

  /** Tên satellite phát hiện. Ví dụ: "NOAA-20", "Aqua", "Terra", "Suomi-NPP" */
  satellite: string;

  /**
   * true  = CHỈ có satellite detection, không có ground-truth confirmation.
   * false = có ít nhất một nguồn bổ sung xác nhận.
   */
  satellite_only: boolean;

  /**
   * Khoảng cách từ điểm nóng tới nearest populated place trong dataset Kahu Ola (miles).
   * null nếu worker chưa tính hoặc không có populated place trong range hợp lý.
   *
   * Invariant IV: khoảng cách từ FIRE tới địa danh —
   * KHÔNG PHẢI khoảng cách từ fire tới user device.
   */
  distance_to_nearest_place_miles: number | null;

  // ── Coordinates ───────────────────────────────────────────────────────────────

  /**
   * Tọa độ trung tâm điểm nóng (fire detection location).
   * Invariant IV: vị trí của FIRE — không bao giờ là device location.
   */
  latitude: number;
  longitude: number;

  // ── Weather context ───────────────────────────────────────────────────────────
  // Tất cả nullable. Nguồn gốc: xem weather_measurement_basis.

  wind_mph: number | null;
  wind_direction: CardinalDirection | null;
  humidity_pct: number | null;

  // ── Timestamps & freshness ────────────────────────────────────────────────────

  /** Thời điểm satellite acquisition từ FIRMS (ISO 8601 UTC). null nếu upstream không có. */
  acq_datetime_utc: string | null;

  /** Thời điểm worker ingest tín hiệu này (ISO 8601 UTC). Luôn có giá trị. */
  observed_at_utc: string;

  /** Thời điểm worker update gần nhất (ISO 8601 UTC). null nếu chưa có update. */
  updated_at_utc: string | null;

  /** Trạng thái độ mới — worker tính. Client KHÔNG tự tính từ timestamps. */
  freshness_status: FreshnessStatus;

  // ── Lifecycle ─────────────────────────────────────────────────────────────────

  /** Trạng thái vòng đời. Chỉ "new" và "active" được trigger alert. */
  signal_state: SignalState;

  // ── Provenance ────────────────────────────────────────────────────────────────

  provenance: FireSignalProvenance;

  // ── Hawaiʻi geographic context ────────────────────────────────────────────────

  /** null nếu worker chưa implement geographic mapping. */
  hawaii_context: HawaiiGeoContext | null;

  // ── Null reason ───────────────────────────────────────────────────────────────

  /** Lý do signal-level cho nullable fields. null nếu không cần giải thích. */
  null_reason: NullReason | null;
}


// ─────────────────────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export type FireSignal = BaseSignal<"fire", FireSignalProps>;


// ─────────────────────────────────────────────────────────────────────────────
// WORKER VALIDATION GUARD
//
// Dùng trong src/index.ts trước khi build FireSignal.
// false → caller phải return [] — Invariant III.
// ─────────────────────────────────────────────────────────────────────────────

const _SIGNAL_CLASS: readonly FireSignalClass[] = [
  "satellite_detection", "derived_signal", "confirmed_observation", "official_hazard",
];
const _DETECTION_CONF: readonly DetectionConfidence[] = ["low", "nominal", "high"];
const _MEAS_BASIS: readonly MeasurementBasis[] = [
  "directly_observed", "station_reported", "model_estimated", "terrain_inferred", "unavailable",
];
const _FRESHNESS: readonly FreshnessStatus[] = ["FRESH", "STALE_OK", "STALE_DROP"];
const _SIGNAL_STATE: readonly SignalState[] = [
  "new", "active", "updating", "expired", "historical",
];
const _SOURCE_AGENCY: readonly KnownSourceAgency[] = [
  "NASA_FIRMS", "NOAA_HMS", "NIFC_WFIGS", "NWS", "USGS", "PACIOOS", "KAHUOLA_DERIVED", "OTHER",
];
const _SOURCE_TYPE = [
  "satellite", "ground_station", "model", "official_report", "terrain_derived",
] as const;
const _RELIABILITY = ["primary", "secondary", "supplemental"] as const;
const _PROC_ORIGIN = ["upstream_raw", "kahuola_derived", "official_feed"] as const;
const _NULL_REASON: readonly NullReason[] = [
  "not_available", "not_applicable", "not_yet_computed", "sensor_error",
];
const _CARDINAL: readonly CardinalDirection[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const _ISLANDS = [
  "Maui", "Hawaii", "Oahu", "Kauai", "Molokai", "Lanai", "Kahoolawe", "Niihau",
] as const;
const _COUNTIES = ["Maui", "Hawaii", "Honolulu", "Kauai"] as const;

export function validateFireSignalProps(props: unknown): props is FireSignalProps {
  if (!props || typeof props !== "object") return false;
  const p = props as Record<string, unknown>;

  // Identity
  if (typeof p.signal_id !== "string" || p.signal_id.length === 0) return false;
  if (p.source_observation_id !== null && typeof p.source_observation_id !== "string") return false;

  // Classification & confidence
  if (!(_SIGNAL_CLASS as readonly string[]).includes(p.signal_class as string)) return false;
  if (!(_DETECTION_CONF as readonly string[]).includes(p.detection_confidence as string)) return false;
  if (p.confidence_basis !== null && typeof p.confidence_basis !== "string") return false;

  // Measurement basis
  if (!(_MEAS_BASIS as readonly string[]).includes(p.weather_measurement_basis as string)) return false;

  // Core detection
  if (p.frp_mw !== null && typeof p.frp_mw !== "number") return false;
  if (typeof p.satellite !== "string" || p.satellite.length === 0) return false;
  if (typeof p.satellite_only !== "boolean") return false;
  if (p.distance_to_nearest_place_miles !== null &&
    typeof p.distance_to_nearest_place_miles !== "number") return false;

  // Coordinates
  if (typeof p.latitude !== "number" || p.latitude < -90 || p.latitude > 90) return false;
  if (typeof p.longitude !== "number" || p.longitude < -180 || p.longitude > 180) return false;

  // Weather
  if (p.wind_mph !== null && typeof p.wind_mph !== "number") return false;
  if (p.wind_direction !== null &&
    !(_CARDINAL as readonly string[]).includes(p.wind_direction as string)) return false;
  if (p.humidity_pct !== null && typeof p.humidity_pct !== "number") return false;

  // Timestamps & freshness
  if (p.acq_datetime_utc !== null && typeof p.acq_datetime_utc !== "string") return false;
  if (typeof p.observed_at_utc !== "string" || p.observed_at_utc.length === 0) return false;
  if (p.updated_at_utc !== null && typeof p.updated_at_utc !== "string") return false;
  if (!(_FRESHNESS as readonly string[]).includes(p.freshness_status as string)) return false;

  // Lifecycle
  if (!(_SIGNAL_STATE as readonly string[]).includes(p.signal_state as string)) return false;

  // Provenance — shape
  if (!p.provenance || typeof p.provenance !== "object") return false;
  const pv = p.provenance as Record<string, unknown>;
  if (!(_SOURCE_AGENCY as readonly string[]).includes(pv.source_agency as string)) return false;
  // OTHER requires label; known agency must have null label
  if (pv.source_agency === "OTHER") {
    if (typeof pv.source_agency_label !== "string" || pv.source_agency_label.length === 0) return false;
  } else {
    if (pv.source_agency_label !== null) return false;
  }
  if (!(_SOURCE_TYPE as readonly string[]).includes(pv.source_type as string)) return false;
  if (!(_RELIABILITY as readonly string[]).includes(pv.source_reliability as string)) return false;
  if (!(_PROC_ORIGIN as readonly string[]).includes(pv.processing_origin as string)) return false;
  if (pv.upstream_ref !== null && typeof pv.upstream_ref !== "string") return false;

  // official_hazard integrity rule
  if (p.signal_class === "official_hazard") {
    if (pv.processing_origin !== "official_feed") return false;
    if (pv.source_reliability !== "primary") return false;
  }

  // hawaii_context
  if (p.hawaii_context !== null) {
    if (typeof p.hawaii_context !== "object") return false;
    const hc = p.hawaii_context as Record<string, unknown>;
    if (hc.island !== null &&
      !(_ISLANDS as readonly string[]).includes(hc.island as string)) return false;
    if (hc.county !== null &&
      !(_COUNTIES as readonly string[]).includes(hc.county as string)) return false;
    if (hc.leeward !== null && typeof hc.leeward !== "boolean") return false;
    if (hc.terrain_cell_id !== null && typeof hc.terrain_cell_id !== "string") return false;
  }

  // null_reason
  if (p.null_reason !== null &&
    !(_NULL_REASON as readonly string[]).includes(p.null_reason as string)) return false;

  return true;
}
