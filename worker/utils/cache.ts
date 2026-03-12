export type CacheJson =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

export async function readJsonCache<T>(
  cache: KVNamespace,
  key: string,
): Promise<T | null> {
  const raw = await cache.get(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error(`Cache JSON parse failed for key=${key}`, err);
    return null;
  }
}

export async function writeJsonCache<T extends CacheJson>(
  cache: KVNamespace,
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  await cache.put(key, JSON.stringify(value), {
    expirationTtl: ttlSeconds,
  });
}

export async function deleteCacheKey(
  cache: KVNamespace,
  key: string,
): Promise<void> {
  await cache.delete(key);
}

export function cacheKey(scope: "hazard" | "home" | "health", type: string, region: string): string {
  return `${scope}:${type}:${region}`;
}
