// Optional shared store for distributed rate limiting.
// When REDIS_URL is set (recommended for any deployment with more than one
// backend instance/replica), rate limits are enforced across all instances.
// When it is not set (local dev, tests, single-instance deployments), callers
// must fall back to an in-memory counter — see createSimpleRateLimit in server.ts.
import Redis from 'ioredis';

export interface RedisMultiLike {
  incr(key: string): RedisMultiLike;
  pttl(key: string): RedisMultiLike;
  exec(): Promise<[Error | null, unknown][] | null>;
}

export interface RedisLike {
  on(event: string, handler: (...args: unknown[]) => void): void;
  multi(): RedisMultiLike;
  pexpire(key: string, ms: number): Promise<unknown>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  exists(key: string): Promise<number>;
  del(key: string): Promise<number>;
}

const RedisClient = Redis as unknown as new (
  url: string,
  options?: Record<string, unknown>
) => RedisLike;

export const redis: RedisLike | null = process.env.REDIS_URL
  ? new RedisClient(process.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      retryStrategy: (times: number) => Math.min(times * 200, 2000)
    })
  : null;

if (redis) {
  redis.on('error', (err: unknown) => {
    // Never crash the process on a transient Redis error — rate limiting
    // callers are expected to catch failures and fail open to the
    // in-memory limiter for the affected request.
    console.error('[redis] connection error:', err instanceof Error ? err.message : err);
  });
}
