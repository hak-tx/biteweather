import NodeCache from 'node-cache';

const apiCache = new NodeCache({
  stdTTL: 1800,
  checkperiod: 120,
  useClones: false,
});

export interface CacheOptions {
  ttl?: number;
}

export function getCacheKey(prefix: string, ...params: string[]): string {
  return [prefix, ...params.map(p => encodeURIComponent(p))].join(':');
}

export function getCached<T>(key: string): T | undefined {
  return apiCache.get<T>(key);
}

export function setCached<T>(key: string, value: T, ttl?: number): void {
  if (ttl) {
    apiCache.set(key, value, ttl);
  } else {
    apiCache.set(key, value);
  }
}

export function deleteCached(key: string): void {
  apiCache.del(key);
}

export function flushCache(): void {
  apiCache.flushAll();
}

export { apiCache };
