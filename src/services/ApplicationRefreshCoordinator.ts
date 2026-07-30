export type RefreshTaskCompletion =
  | { status: "success" }
  | { status: "skipped"; reason: string };

export type RefreshTask = {
  id: string;
  run: (signal: AbortSignal) => Promise<void | RefreshTaskCompletion>;
};

export type RefreshTaskResult = {
  id: string;
  status: "success" | "failed" | "skipped";
  durationMs: number;
  reason?: string;
  statusCode?: number;
};

export type ApplicationRefreshState = {
  status: "idle" | "refreshing" | "success" | "partial";
  results: RefreshTaskResult[];
  retryingFailedOnly: boolean;
};

type Listener = (state: ApplicationRefreshState) => void;

export class RefreshHandlerError extends Error {
  readonly reason: string;
  readonly statusCode?: number;

  constructor(reason: string, statusCode?: number) {
    super("Refresh handler failed");
    this.name = "RefreshHandlerError";
    this.reason = reason;
    this.statusCode = statusCode;
  }
}

export function skipped(reason: string): RefreshTaskCompletion {
  return { status: "skipped", reason };
}

export class ApplicationRefreshCoordinator {
  private readonly tasks = new Map<string, RefreshTask["run"]>();
  private readonly listeners = new Set<Listener>();
  private controller?: AbortController;
  private active?: Promise<ApplicationRefreshState>;
  private state: ApplicationRefreshState = {
    status: "idle", results: [], retryingFailedOnly: false
  };

  register(task: RefreshTask) {
    this.tasks.set(task.id, task.run);
    return () => this.tasks.delete(task.id);
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }

  getSnapshot = () => this.state;

  refreshAll() {
    return this.execute([...this.tasks.keys()], false);
  }

  retryFailedOnly() {
    const failed = this.state.results
      .filter((result) => result.status === "failed")
      .map((result) => result.id);
    if (!failed.length) return Promise.resolve(this.state);
    return this.execute(failed, true);
  }

  abort() {
    this.controller?.abort();
  }

  private execute(ids: string[], retryingFailedOnly: boolean) {
    if (this.active) return this.active;
    this.controller = new AbortController();
    this.setState({ status: "refreshing", results: [], retryingFailedOnly });
    const signal = this.controller.signal;
    this.active = Promise.all(ids.map((id) => this.runTask(id, signal)))
      .then((results) => {
        const state: ApplicationRefreshState = {
          status: results.some((result) => result.status === "failed")
            ? "partial"
            : "success",
          results,
          retryingFailedOnly: false
        };
        this.setState(state);
        return state;
      })
      .finally(() => {
        this.active = undefined;
        this.controller = undefined;
      });
    return this.active;
  }

  private async runTask(id: string, signal: AbortSignal): Promise<RefreshTaskResult> {
    const startedAt = performance.now();
    const run = this.tasks.get(id);
    if (!run) {
      return { id, status: "skipped", durationMs: 0, reason: "handler_unavailable" };
    }
    try {
      const completion = await run(signal);
      const result: RefreshTaskResult = completion?.status === "skipped"
        ? { id, status: "skipped", reason: completion.reason, durationMs: elapsed(startedAt) }
        : { id, status: "success", durationMs: elapsed(startedAt) };
      logDevelopmentResult(result);
      return result;
    } catch (error) {
      const safe = safeFailure(error);
      const result: RefreshTaskResult = {
        id,
        status: signal.aborted ? "skipped" : "failed",
        durationMs: elapsed(startedAt),
        reason: signal.aborted ? "cancelled" : safe.reason,
        statusCode: safe.statusCode
      };
      logDevelopmentResult(result);
      return result;
    }
  }

  private setState(state: ApplicationRefreshState) {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }
}

function elapsed(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function safeFailure(error: unknown) {
  if (error instanceof RefreshHandlerError) {
    return { reason: sanitizeReason(error.reason), statusCode: error.statusCode };
  }
  if (typeof error === "object" && error !== null) {
    const value = error as { code?: unknown; status?: unknown };
    return {
      reason: sanitizeReason(typeof value.code === "string" ? value.code : "request_failed"),
      statusCode: typeof value.status === "number" ? value.status : undefined
    };
  }
  return { reason: "request_failed", statusCode: undefined };
}

function sanitizeReason(reason: string) {
  const normalized = reason.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 48);
  return normalized || "request_failed";
}

function logDevelopmentResult(result: RefreshTaskResult) {
  const environment = (import.meta as ImportMeta & {
    env?: { DEV?: boolean };
  }).env;
  if (!environment?.DEV) return;
  const details = {
    handlerId: result.id,
    outcome: result.status,
    statusCode: result.statusCode,
    durationMs: result.durationMs,
    reason: result.reason
  };
  if (result.status === "failed") console.warn("[application-refresh]", details);
  else console.info("[application-refresh]", details);
}
