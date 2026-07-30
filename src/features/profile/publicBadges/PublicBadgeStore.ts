import type { BackendSessionSource } from "../../developer-center/AuthorizationStore";
import type { PublicBadgeClient } from "./PublicBadgeClient";
import type { PublicBadge } from "./types";

export type PublicBadgeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; badges: PublicBadge[] }
  | { status: "error" };

export class PublicBadgeStore {
  private state: PublicBadgeState = { status: "idle" };
  private readonly listeners = new Set<(state: PublicBadgeState) => void>();
  private unsubscribeSession?: () => void;
  private request?: AbortController;
  private generation = 0;

  constructor(
    private readonly client: PublicBadgeClient,
    private readonly sessions: BackendSessionSource
  ) {}

  getState() { return this.state; }
  subscribe(listener: (state: PublicBadgeState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  start() {
    if (this.unsubscribeSession) return;
    this.unsubscribeSession = this.sessions.subscribeSession((session) => {
      if (session) void this.load();
      else this.clear();
    });
    if (this.sessions.getActiveSession()) void this.load();
    else this.clear();
  }
  stop() {
    this.request?.abort();
    this.unsubscribeSession?.();
    this.unsubscribeSession = undefined;
    this.clear();
  }
  retry() { return this.load(); }

  private async load() {
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    const generation = ++this.generation;
    this.setState({ status: "loading" });
    try {
      const badges = await this.client.list(request.signal);
      if (generation === this.generation) this.setState({ status: "ready", badges });
    } catch (error) {
      if (
        generation === this.generation &&
        !(error instanceof DOMException && error.name === "AbortError")
      ) this.setState({ status: "error" });
    }
  }
  private clear() {
    this.request?.abort();
    this.request = undefined;
    this.generation += 1;
    this.setState({ status: "idle" });
  }
  private setState(state: PublicBadgeState) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
