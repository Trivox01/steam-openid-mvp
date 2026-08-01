export class PollingRateLimitError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super("polling_rate_limited");
    this.name = "PollingRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

interface Entry { timestamps: number[]; touchedAt: number }

/** Bounded, single-instance memory limiter; state resets on restart. */
export class PollingRateLimiter {
  readonly #entries = new Map<string, Entry>();
  readonly #minimumIntervalMs: number;
  readonly #windowMs: number;
  readonly #maxRequests: number;
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #now: () => number;

  constructor(options: { minimumIntervalMs?: number; windowMs?: number; maxRequests?: number; ttlMs?: number; maxEntries?: number; now?: () => number } = {}) {
    this.#minimumIntervalMs = options.minimumIntervalMs ?? 3_000;
    this.#windowMs = options.windowMs ?? 60_000;
    this.#maxRequests = options.maxRequests ?? 30;
    this.#ttlMs = options.ttlMs ?? Math.max(this.#windowMs * 2, 60_000);
    this.#maxEntries = options.maxEntries ?? 10_000;
    this.#now = options.now ?? Date.now;
  }

  assertAllowed(key: string) {
    const now = this.#now();
    this.cleanup(now);
    const entry = this.#entries.get(key) ?? { timestamps: [], touchedAt: now };
    entry.timestamps = entry.timestamps.filter((time) => now - time < this.#windowMs);
    const previous = entry.timestamps.at(-1);
    const intervalWait = previous === undefined ? 0 : this.#minimumIntervalMs - (now - previous);
    const windowWait = entry.timestamps.length < this.#maxRequests ? 0 : this.#windowMs - (now - entry.timestamps[0]);
    entry.touchedAt = now;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    this.evictExcess();
    if (intervalWait > 0 || windowWait > 0) throw new PollingRateLimitError(Math.max(intervalWait, windowWait));
    entry.timestamps.push(now);
  }

  cleanup(now = this.#now()) {
    for (const [key, entry] of this.#entries) if (now - entry.touchedAt >= this.#ttlMs) this.#entries.delete(key);
    this.evictExcess();
  }

  private evictExcess() {
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }

  get size() { return this.#entries.size; }
}
