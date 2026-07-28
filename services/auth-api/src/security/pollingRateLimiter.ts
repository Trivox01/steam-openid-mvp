export class PollingRateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super("polling_rate_limited");
    this.name = "PollingRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class PollingRateLimiter {
  readonly #lastPollByRequest = new Map<string, number>();
  readonly #minimumIntervalMs: number;
  readonly #now: () => number;

  constructor(options: { minimumIntervalMs?: number; now?: () => number } = {}) {
    this.#minimumIntervalMs = options.minimumIntervalMs ?? 3_000;
    this.#now = options.now ?? Date.now;
  }

  assertAllowed(key: string) {
    const now = this.#now();
    const previous = this.#lastPollByRequest.get(key);
    if (
      previous !== undefined &&
      now - previous < this.#minimumIntervalMs
    ) {
      throw new PollingRateLimitError(
        this.#minimumIntervalMs - (now - previous)
      );
    }
    this.#lastPollByRequest.set(key, now);
  }
}
