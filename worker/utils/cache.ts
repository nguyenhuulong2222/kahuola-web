export interface CacheLike {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete?(key: string): Promise<void>;
}

export type CacheJson =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

export async function readJsonCache<T>(
  cache: CacheLike,
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
  cache: CacheLike,
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  await cache.put(key, JSON.stringify(value), {
    expirationTtl: ttlSeconds,
  });
}

export async function deleteCacheKey(
  cache: CacheLike,
  key: string,
): Promise<void> {
  if (cache.delete) {
    await cache.delete(key);
  }
}

export function cacheKey(
  scope: "hazard" | "home" | "health",
  type: string,
  region: string,
): string {
  return `${scope}:${type}:${region}`;
}
