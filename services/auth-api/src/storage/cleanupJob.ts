import type { AuthTransactionRepository } from "./authRepository.ts";

const DEFAULT_INTERVAL_MS = 15 * 60_000;
const RETENTION_MS = 24 * 60 * 60_000;
const DEFAULT_BATCH_SIZE = 250;

export function startStorageCleanup(
  repository: AuthTransactionRepository,
  options: {
    intervalMs?: number;
    batchSize?: number;
    now?: () => number;
    onError?: () => void;
  } = {}
) {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const now = options.now ?? Date.now;
  const run = async () => {
    const current = now();
    try {
      await repository.cleanup({
        now: new Date(current).toISOString(),
        transactionRetentionBefore: new Date(current - RETENTION_MS).toISOString(),
        batchSize
      });
    } catch {
      options.onError?.();
    }
  };
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  return {
    run,
    stop() {
      clearInterval(timer);
    }
  };
}
