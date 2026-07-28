import type { SteamBackendSession } from "../../types/steamOpenId";
import {
  AuthorizationClientError,
  type AuthorizationApi
} from "./AuthorizationClient.ts";
import type { AuthorizationLoadState } from "./authorizationTypes";

export interface BackendSessionSource {
  getActiveSession(): SteamBackendSession | undefined;
  subscribeSession(listener: (session: SteamBackendSession | undefined) => void): () => void;
  expireSession(): void;
}

type StateListener = (state: AuthorizationLoadState) => void;
type ScheduleExpiration = (callback: () => void, delayMs: number) => () => void;

export class AuthorizationStore {
  private state: AuthorizationLoadState = { status: "idle" };
  private readonly listeners = new Set<StateListener>();
  private unsubscribeSession?: () => void;
  private request?: AbortController;
  private generation = 0;
  private readonly api: AuthorizationApi;
  private readonly sessions: BackendSessionSource;
  private readonly scheduleExpiration: ScheduleExpiration;
  private cancelExpiration?: () => void;

  constructor(
    api: AuthorizationApi,
    sessions: BackendSessionSource,
    scheduleExpiration: ScheduleExpiration = defaultScheduleExpiration
  ) {
    this.api = api;
    this.sessions = sessions;
    this.scheduleExpiration = scheduleExpiration;
  }

  getState() {
    return this.state;
  }

  subscribe(listener: StateListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start() {
    if (this.unsubscribeSession) return;
    this.unsubscribeSession = this.sessions.subscribeSession((session) => {
      void this.load(session);
    });
    void this.load(this.sessions.getActiveSession());
  }

  stop() {
    this.request?.abort();
    this.cancelExpiration?.();
    this.cancelExpiration = undefined;
    this.unsubscribeSession?.();
    this.unsubscribeSession = undefined;
    this.generation += 1;
    this.setState({ status: "idle" });
  }

  retry() {
    return this.load(this.sessions.getActiveSession());
  }

  private async load(session: SteamBackendSession | undefined) {
    this.request?.abort();
    this.cancelExpiration?.();
    this.cancelExpiration = undefined;
    const generation = ++this.generation;
    if (!session || Date.parse(session.expiresAt) <= Date.now()) {
      this.setState({ status: "unauthorized" });
      return;
    }
    this.cancelExpiration = this.scheduleExpiration(
      () => this.sessions.expireSession(),
      Math.max(0, Date.parse(session.expiresAt) - Date.now())
    );
    const request = new AbortController();
    this.request = request;
    this.setState({ status: "loading" });
    try {
      const snapshot = await this.api.loadSnapshot(session.token, request.signal);
      if (generation !== this.generation) return;
      this.setState(snapshot.canAccessDeveloperCenter
        ? { status: "authenticated", snapshot }
        : { status: "forbidden" });
    } catch (error) {
      if (generation !== this.generation || request.signal.aborted) return;
      if (error instanceof AuthorizationClientError) {
        if (error.kind === "unauthorized") {
          this.sessions.expireSession();
          this.setState({ status: "unauthorized" });
          return;
        }
        if (error.kind === "forbidden") {
          this.setState({ status: "forbidden" });
          return;
        }
        this.setState({
          status: "error",
          error: error.kind === "network" || error.kind === "malformed"
            ? error.kind
            : "unknown"
        });
        return;
      }
      this.setState({ status: "error", error: "unknown" });
    }
  }

  private setState(state: AuthorizationLoadState) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

function defaultScheduleExpiration(callback: () => void, delayMs: number) {
  const timer = globalThis.setTimeout(callback, delayMs);
  return () => globalThis.clearTimeout(timer);
}
