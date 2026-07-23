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
  // Used for the distributed lock's atomic compare-and-delete (see
  // releaseLock in server.ts). Declared here so call sites don't need an
  // `as any` cast to reach it.
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  // Daily credit counters (creditApprovals.ts).
  incrbyfloat(key: string, increment: number): Promise<string>;
  pexpireat(key: string, millisecondsTimestamp: number): Promise<number>;
  // Cursor-based iteration. Preferred over KEYS, which is O(N) and blocks the
  // whole Redis server for the duration of the scan.
  scan(cursor: string, ...args: (string | number)[]): Promise<[string, string[]]>;
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
