/** Exponential backoff with +/-20% jitter. attempt is 1-based. */
export function backoffMs(attempt: number, baseMs = 60_000, maxMs = 6 * 3600_000, random = Math.random): number {
  const raw = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const jitter = 1 + (random() * 0.4 - 0.2);
  return Math.round(Math.min(maxMs, raw * jitter));
}

export class TimeoutError extends Error {}

export function withTimeout<T>(promise: Promise<T>, ms: number, what = 'operation'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(`${what} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
