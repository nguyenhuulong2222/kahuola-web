import { parseFirmsPayload } from "../../worker/parsers/firms";
import { cacheKey, writeJsonCache } from "../../worker/utils/cache";
import { DEFAULT_REGION, FRESHNESS_POLICY } from "../../worker/utils/constants";

interface PollEnv {
  CACHE: KVNamespace;
  NASA_FIRMS_ENDPOINT: string;
  REGION?: string;
}

export interface PollFirmsResult {
  ok: boolean;
  count: number;
  dropped: number;
  errors: string[];
}

function csvToRows(csv: string): Record<string, unknown>[] {
  const lines = csv
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    const row: Record<string, unknown> = {};
    for (let i = 0; i < header.length; i += 1) {
      row[header[i]] = cols[i]?.trim();
    }
    return row;
  });
}

export async function pollFirms(env: PollEnv): Promise<PollFirmsResult> {
  const region = env.REGION ?? DEFAULT_REGION;

  const res = await fetch(env.NASA_FIRMS_ENDPOINT, {
    method: "GET",
    headers: {
      accept: "application/json,text/plain,*/*",
    },
  });

  if (!res.ok) {
    throw new Error(`FIRMS upstream error: ${res.status}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const payload: unknown = contentType.includes("application/json")
    ? await res.json()
    : csvToRows(await res.text());

  const parsed = parseFirmsPayload(payload, region);

  await writeJsonCache(
    env.CACHE,
    cacheKey("hazard", "fire", region),
    parsed.items,
    FRESHNESS_POLICY.fire.fresh_seconds,
  );

  return {
    ok: true,
    count: parsed.items.length,
    dropped: parsed.dropped,
    errors: parsed.errors,
  };
}