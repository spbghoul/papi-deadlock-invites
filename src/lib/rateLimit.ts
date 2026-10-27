interface Bucket {
  count: number;
  resetAt: number;
}

/** Fixed-window in-memory rate limiter (single web instance; use Redis if you scale out). */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): { ok: boolean; retryAfterSec: number } {
    if (this.buckets.size > 10_000) this.sweep(now);
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, b);
    }
    b.count++;
    return { ok: b.count <= this.limit, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }

  private sweep(now: number) {
    for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
  }
}

const g = globalThis as unknown as { __ddiLimiters?: Map<string, RateLimiter> };

export function limiter(name: string, limit: number, windowMs: number): RateLimiter {
  g.__ddiLimiters ??= new Map();
  let l = g.__ddiLimiters.get(name);
  if (!l) {
    l = new RateLimiter(limit, windowMs);
    g.__ddiLimiters.set(name, l);
  }
  return l;
}

export function clientIp(headers: Headers, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = headers.get('x-forwarded-for');
    if (fwd) return fwd.split(',')[0]!.trim();
    const real = headers.get('x-real-ip');
    if (real) return real.trim();
  }
  return 'direct';
}
