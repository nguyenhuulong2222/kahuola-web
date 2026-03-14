function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=120, s-maxage=300, stale-while-revalidate=300",
      ...(init?.headers || {}),
    },
  });
}

function errorResponse(status: number, error: string, detail?: string): Response {
  return jsonResponse(
    {
      error,
      ...(detail ? { detail } : {}),
    },
    { status },
  );
}

function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toIso(value: unknown, fallback = new Date()): string {
  if (typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return fallback.toISOString();
}

function isValidLinearRing(ring: unknown): ring is number[][] {
  if (!Array.isArray(ring) || ring.length < 4) return false;

  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2) return false;
    const lon = safeNumber(pt[0]);
    const lat = safeNumber(pt[1]);
    if (lon === null || lat === null) return false;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return false;
  }

  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

function isValidPolygonGeometry(geometry: any): boolean {
  if (!geometry || geometry.type !== "Polygon" || !Array.isArray(geometry.coordinates)) return false;
  if (!Array.isArray(geometry.coordinates[0])) return false;
  return isValidLinearRing(geometry.coordinates[0]);
}

function classifyMrmsSeverity(qpeMm: number | null): "LOW" | "MODERATE" | "ELEVATED" | "HIGH" {
  if (qpeMm === null) return "LOW";
  if (qpeMm >= 75) return "HIGH";
  if (qpeMm >= 40) return "ELEVATED";
  if (qpeMm >= 20) return "MODERATE";
  return "LOW";
}

function normalizeMrmsBand(value: unknown): "1H" | "3H" | "24H" {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "1H" || raw === "3H" || raw === "24H") return raw;
  if (raw.includes("24")) return "24H";
  if (raw.includes("3")) return "3H";
  return "1H";
}

function mapMrmsRecordToSignal(record: any, index: number, now: Date) {
  const geometry = record?.geometry;
  if (!isValidPolygonGeometry(geometry)) return null;

  const qpeMm = safeNumber(record?.qpe_mm);
  const band = normalizeMrmsBand(record?.band || record?.accumulation_window);
  const derivedSeverity = classifyMrmsSeverity(qpeMm);
  const riskIndex = String(record?.risk_index || derivedSeverity).toUpperCase();

  return {
    schema_version: "1.0",
    type: "MRMSRainSignal",
    id: String(record?.id || `mrms-${band.toLowerCase()}-${index + 1}`),
    source: {
      provider: "NOAA_MRMS",
      product: `QPE_${band}`,
      fetched_at: toIso(record?.fetched_at, now),
    },
    event_time: toIso(record?.observed_at || record?.event_time, now),
    geometry,
    severity: {
      level: derivedSeverity,
      reason_codes: ["MRMS_RAINFALL_CONTEXT"],
    },
    ttl_seconds: 900,
    properties: {
      band,
      qpe_mm: qpeMm,
      risk_index: riskIndex,
    },
  };
}

export async function handleMrmsQpe(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const region = (url.searchParams.get("region") || "hawaii").toLowerCase();
  const now = new Date();

  if (region !== "hawaii") {
    return errorResponse(400, "unsupported_region");
  }

  /**
   * DEV / SAFE FALLBACK:
   * Nếu bạn CHƯA có upstream thật, route vẫn trả 1 payload test
   * để frontend MRMS hết "Unavailable".
   *
   * Khi production có upstream thật, xóa block này hoặc đổi USE_TEST_MRMS=false.
   */
  const USE_TEST_MRMS = true;

  if (USE_TEST_MRMS) {
    return jsonResponse({
      generated_at: now.toISOString(),
      region,
      source: "Kahu Ola Worker · NOAA MRMS context",
      signals: [
        {
          schema_version: "1.0",
          type: "MRMSRainSignal",
          id: "mrms-maui-test-1",
          source: {
            provider: "NOAA_MRMS",
            product: "QPE_3H",
            fetched_at: now.toISOString(),
          },
          event_time: now.toISOString(),
          geometry: {
            type: "Polygon",
            coordinates: [[
              [-156.55, 20.92],
              [-156.20, 20.92],
              [-156.20, 20.62],
              [-156.55, 20.62],
              [-156.55, 20.92],
            ]],
          },
          severity: {
            level: "ELEVATED",
            reason_codes: ["MRMS_RAINFALL_CONTEXT"],
          },
          ttl_seconds: 900,
          properties: {
            band: "3H",
            qpe_mm: 42.8,
            risk_index: "ELEVATED",
          },
        },
      ],
    });
  }

  if (!env.MRMS_QPE_URL) {
    return errorResponse(503, "mrms_upstream_not_configured");
  }

  try {
    const upstreamUrl = new URL(env.MRMS_QPE_URL);
    upstreamUrl.searchParams.set("region", region);

    const upstreamResp = await fetch(upstreamUrl.toString(), {
      method: "GET",
      headers: env.MRMS_QPE_TOKEN
        ? { Authorization: `Bearer ${env.MRMS_QPE_TOKEN}` }
        : undefined,
      cf: {
        cacheTtl: 180,
        cacheEverything: false,
      },
    });

    if (!upstreamResp.ok) {
      return errorResponse(502, "mrms_upstream_failed", String(upstreamResp.status));
    }

    const upstreamJson: any = await upstreamResp.json();

    const rawRecords: any[] =
      Array.isArray(upstreamJson) ? upstreamJson :
      Array.isArray(upstreamJson?.records) ? upstreamJson.records :
      Array.isArray(upstreamJson?.signals) ? upstreamJson.signals :
      [];

    const signals = rawRecords
      .map((record, index) => mapMrmsRecordToSignal(record, index, now))
      .filter(Boolean);

    return jsonResponse({
      generated_at: now.toISOString(),
      region,
      source: "Kahu Ola Worker · NOAA MRMS context",
      signals,
    });
  } catch (error: any) {
    return errorResponse(502, "mrms_fetch_failed", error?.message || "unknown_error");
  }
}
