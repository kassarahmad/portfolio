/**
 * Fixed-window counter per key, held in memory. Limits apply per process:
 * with several replicas, put a shared limiter (reverse proxy or Redis) in
 * front. This is documented in the README's known limitations.
 */
export function createRateLimiter({ limit, windowMs, now = () => Date.now(), maxKeys = 50_000 }) {
  const hits = new Map();
  return {
    /** @returns {{ok: boolean, remaining: number, retryAfterSec: number}} */
    take(key) {
      const t = now();
      let e = hits.get(key);
      if (!e || t >= e.reset) {
        if (hits.size >= maxKeys) {
          for (const [k, val] of hits) if (t >= val.reset) hits.delete(k);
          if (hits.size >= maxKeys) hits.delete(hits.keys().next().value);
        }
        e = { count: 0, reset: t + windowMs };
        hits.set(key, e);
      }
      e.count++;
      const ok = e.count <= limit;
      return { ok, remaining: Math.max(0, limit - e.count), retryAfterSec: Math.ceil((e.reset - t) / 1000) };
    },
  };
}
