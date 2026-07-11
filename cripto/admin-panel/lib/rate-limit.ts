// In-memory rate limiting — REQUIRES this admin panel to run as a single
// process/instance (as documented in the project README: local dev or one
// instance behind a VPN/localhost tunnel, never scaled to multiple replicas).
// NOTE: In-memory storage - will not work correctly with multiple instances.
//
// AP-20: This is acceptable for the single-instance admin panel architecture.
// If this ever needs to run as more than one instance, back this with a
// shared store (Redis/Postgres) instead — otherwise the limit can be
// bypassed by spreading requests across instances.
const buckets = new Map<string, { count: number; resetAt: number }>();

// Purge expired rate-limit buckets to prevent memory growth
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt < now) buckets.delete(key);
    }
  }, 5 * 60_000);
}

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) {
    return false;
  }

  bucket.count += 1;
  return true;
}
