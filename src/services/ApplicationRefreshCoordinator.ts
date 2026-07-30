export type RefreshTask = {
  id: string;
  run: (signal: AbortSignal) => Promise<void>;
};

export type ApplicationRefreshState = {
  status: "idle" | "refreshing" | "success" | "partial";
  failedTasks: string[];
};

type Listener = (state: ApplicationRefreshState) => void;

export class ApplicationRefreshCoordinator {
  private readonly tasks = new Map<string, RefreshTask["run"]>();
  private readonly listeners = new Set<Listener>();
  private controller?: AbortController;
  private active?: Promise<ApplicationRefreshState>;
  private state: ApplicationRefreshState = { status: "idle", failedTasks: [] };

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
    if (this.active) return this.active;
    this.controller = new AbortController();
    this.setState({ status: "refreshing", failedTasks: [] });
    const signal = this.controller.signal;
    this.active = Promise.allSettled(
      [...this.tasks].map(async ([id, run]) => {
        await run(signal);
        return id;
      })
    ).then((results) => {
      const ids = [...this.tasks.keys()];
      const failedTasks = results.flatMap((result, index) =>
        result.status === "rejected" && !signal.aborted ? [ids[index]] : []
      );
      const state: ApplicationRefreshState = {
        status: failedTasks.length ? "partial" : "success",
        failedTasks
      };
      this.setState(state);
      return state;
    }).finally(() => {
      this.active = undefined;
      this.controller = undefined;
    });
    return this.active;
  }

  abort() {
    this.controller?.abort();
  }

  private setState(state: ApplicationRefreshState) {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }
}
