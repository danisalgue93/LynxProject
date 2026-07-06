// Optional shared store for distributed rate limiting.
// When REDIS_URL is set (recommended for any deployment with more than one
// backend instance/replica), rate limits are enforced across all instances.
// When it is not set (local dev, tests, single-instance deployments), callers
// must fall back to an in-memory counter — see createSimpleRateLimit in server.ts.
import Redis from 'ioredis';

export const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => Math.min(times * 200, 2000)
    })
  : null;

if (redis) {
  redis.on('error', (err) => {
    // Never crash the process on a transient Redis error — rate limiting
    // callers are expected to catch failures and fail open to the
    // in-memory limiter for the affected request.
    console.error('[redis] connection error:', err instanceof Error ? err.message : err);
  });
}
