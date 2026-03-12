export interface CacheLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export async function readJsonCache<T>(
  cache: CacheLike,
  key: string,
): Promise<T | null> {
  const raw = await cache.get(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJsonCache<T>(
  cache: CacheLike,
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  await cache.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
}
