import { parseFirmsPayload } from "../../worker/parsers/firms";

interface PollEnv {
  CACHE: KVNamespace;
  NASA_FIRMS_ENDPOINT: string;
  REGION?: string;
}

async function writeJsonCache<T>(
  cache: KVNamespace,
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  await cache.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
}

export async function pollFirms(env: PollEnv): Promise<{
  ok: boolean;
  count: number;
  dropped: number;
  errors: string[];
}> {
  const region = env.REGION ?? "hawaii";

  const res = await fetch(env.NASA_FIRMS_ENDPOINT, {
    method: "GET",
    headers: {
      "accept": "application/json,text/plain,*/*",
    },
  });

  if (!res.ok) {
    throw new Error(`FIRMS upstream error: ${res.status}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  let payload: unknown;

  if (contentType.includes("application/json")) {
    payload = await res.json();
  } else {
    const text = await res.text();

    // Simple CSV fallback
    const lines = text.trim().split("\n");
    const header = lines[0]?.split(",").map((s) => s.trim()) ?? [];
    payload = lines.slice(1).map((line) => {
      const cols = line.split(",");
      const row: Record<string, unknown> = {};
      for (let i = 0; i < header.length; i += 1) {
        row[header[i]] = cols[i];
      }
      return row;
    });
  }

  const parsed = parseFirmsPayload(payload, region);

  await writeJsonCache(env.CACHE, `hazard:fire:${region}`, parsed.items, 15 * 60);

  return {
    ok: true,
    count: parsed.items.length,
    dropped: parsed.dropped,
    errors: parsed.errors,
  };
}
