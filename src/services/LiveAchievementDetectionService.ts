import type { Game, SteamAchievementSyncResult } from "../types";
import type { ActiveGameSession } from "./GameSessionStore";

export const LIVE_ACHIEVEMENT_POLICY = Object.freeze({
  pollIntervalMs: 30_000,
  reconnectDelayMs: 1_500,
  backoffMs: [30_000, 60_000, 120_000, 240_000] as const
});

type TimerHandle = ReturnType<typeof setTimeout>;

export interface LiveAchievementSessionSource {
  list(): ActiveGameSession[];
  subscribe(listener: () => void): () => void;
}

export interface LiveAchievementGameSource {
  getAllGames(): Promise<Game[]>;
}

export interface LiveAchievementSyncSource {
  syncLiveGame(gameId: string): Promise<unknown>;
}

export interface LiveAchievementGate {
  beginLiveSession(appId: string): void;
  resetLiveSessionBaseline(appId: string): void;
  endLiveSession(appId: string): void;
}

export interface LiveAchievementAuthSource {
  getActiveSession(): unknown | undefined;
  subscribeSession(listener: (session: unknown | undefined) => void): () => void;
}

export interface LiveAchievementEnvironment {
  isOnline(): boolean;
  setTimer(callback: () => void, delayMs: number): TimerHandle;
  clearTimer(timer: TimerHandle): void;
  onOnline(listener: () => void): () => void;
  onOffline(listener: () => void): () => void;
}

export type LiveAchievementDiagnostic = {
  appId: string;
  event: "poll_started" | "poll_stopped" | "poll_success" | "poll_failure";
  transitionCount: number;
  backoffMs: number;
  reason?: string;
};

type ActivePoll = {
  sessionId: string;
  appId: string;
  gameId: string;
  failures: number;
  suspended: boolean;
};

export class LiveAchievementDetectionService {
  private readonly sessions: LiveAchievementSessionSource;
  private readonly games: LiveAchievementGameSource;
  private readonly sync: LiveAchievementSyncSource;
  private readonly gate: LiveAchievementGate;
  private readonly auth: LiveAchievementAuthSource | undefined;
  private readonly environment: LiveAchievementEnvironment;
  private readonly diagnostics: ((entry: LiveAchievementDiagnostic) => void) | undefined;
  private active?: ActivePoll;
  private resolvingSessionId?: string;
  private unsupportedSessionId?: string;
  private timer?: TimerHandle;
  private request?: object;
  private stopSessions?: () => void;
  private stopAuth?: () => void;
  private stopOnline?: () => void;
  private stopOffline?: () => void;
  private started = false;
  private enabled = false;
  private generation = 0;

  constructor(
    sessions: LiveAchievementSessionSource,
    games: LiveAchievementGameSource,
    sync: LiveAchievementSyncSource,
    gate: LiveAchievementGate,
    auth?: LiveAchievementAuthSource,
    environment: LiveAchievementEnvironment = browserEnvironment(),
    diagnostics?: (entry: LiveAchievementDiagnostic) => void
  ) {
    this.sessions = sessions;
    this.games = games;
    this.sync = sync;
    this.gate = gate;
    this.auth = auth;
    this.environment = environment;
    this.diagnostics = diagnostics;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.stopSessions = this.sessions.subscribe(() => { void this.reconcile(); });
    this.stopAuth = this.auth?.subscribeSession(() => {
      this.stopActive("session-changed");
      void this.reconcile();
    });
    this.stopOnline = this.environment.onOnline(this.handleOnline);
    this.stopOffline = this.environment.onOffline(this.handleOffline);
    void this.reconcile();
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    this.stopSessions?.();
    this.stopAuth?.();
    this.stopOnline?.();
    this.stopOffline?.();
    this.stopSessions = this.stopAuth = this.stopOnline = this.stopOffline = undefined;
    this.stopActive("service-stopped");
  }

  configure(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.stopActive("notifications-disabled");
    else if (this.started) void this.reconcile();
  }

  snapshot() {
    return {
      activeAppId: this.active?.appId,
      failures: this.active?.failures ?? 0,
      suspended: this.active?.suspended ?? false,
      timerScheduled: this.timer !== undefined,
      requestActive: this.request !== undefined
    };
  }

  private async reconcile() {
    if (!this.started) return;
    const playing = newestPlayingSession(this.sessions.list());
    if (!playing) {
      this.unsupportedSessionId = undefined;
      this.stopActive("session-ended");
      return;
    }
    if (!this.enabled || !this.auth?.getActiveSession()) {
      this.stopActive(this.enabled ? "session-unavailable" : "notifications-disabled");
      return;
    }
    if (this.active && this.active.sessionId !== playing.sessionId) {
      this.stopActive("session-changed");
    }
    if (!this.environment.isOnline()) {
      if (this.active) this.suspendOffline();
      return;
    }
    if (this.active?.sessionId === playing.sessionId) {
      if (this.active.suspended) {
        this.active.suspended = false;
        this.gate.beginLiveSession(this.active.appId);
        this.log(this.active.appId, "poll_started", 0, 0, "reconnected");
        this.schedule(LIVE_ACHIEVEMENT_POLICY.reconnectDelayMs);
      } else if (!this.timer && !this.request) {
        this.schedule(0);
      }
      return;
    }
    if (this.unsupportedSessionId === playing.sessionId || this.resolvingSessionId === playing.sessionId) return;
    this.resolvingSessionId = playing.sessionId;
    const generation = ++this.generation;
    const games = await this.games.getAllGames().catch(() => []);
    this.resolvingSessionId = undefined;
    if (generation !== this.generation || !this.started || !this.enabled) return;
    const latest = newestPlayingSession(this.sessions.list());
    if (!latest || latest.sessionId !== playing.sessionId || !this.auth?.getActiveSession() || !this.environment.isOnline()) return;
    const game = games.find((item) => item.platform === "steam" && item.appId === playing.appId);
    if (!game) {
      this.unsupportedSessionId = playing.sessionId;
      this.log(playing.appId, "poll_stopped", 0, 0, "unsupported-game");
      return;
    }
    this.active = { sessionId: playing.sessionId, appId: playing.appId, gameId: game.id, failures: 0, suspended: false };
    this.gate.beginLiveSession(playing.appId);
    this.log(playing.appId, "poll_started", 0, 0, "session-playing");
    this.schedule(0);
  }

  private schedule(delayMs: number) {
    this.clearTimer();
    if (!this.active || this.active.suspended || !this.started || !this.enabled) return;
    this.timer = this.environment.setTimer(() => {
      this.timer = undefined;
      void this.poll();
    }, delayMs);
  }

  private async poll() {
    const active = this.active;
    if (!active || active.suspended || !this.environment.isOnline() || !this.auth?.getActiveSession()) {
      await this.reconcile();
      return;
    }
    const request = {};
    this.request = request;
    const generation = this.generation;
    try {
      const result = await this.sync.syncLiveGame(active.gameId);
      if (!this.isCurrent(active, generation, request)) return;
      const outcome = syncOutcome(result);
      if (outcome.status === "success" || outcome.status === "partial") {
        active.failures = 0;
        this.log(active.appId, "poll_success", outcome.transitions, 0);
        this.schedule(LIVE_ACHIEVEMENT_POLICY.pollIntervalMs);
        return;
      }
      if (outcome.status === "unsupported" || outcome.reason === "unsupported") {
        this.unsupportedSessionId = active.sessionId;
        this.stopActive("unsupported-game");
        return;
      }
      if (outcome.reason === "session_expired") {
        this.stopActive("session-expired");
        return;
      }
      this.scheduleFailure(active, outcome.reason ?? "sync-failed");
    } catch (error) {
      if (!this.isCurrent(active, generation, request)) return;
      this.scheduleFailure(active, safeReason(error));
    } finally {
      if (this.request === request) this.request = undefined;
    }
  }

  private scheduleFailure(active: ActivePoll, reason: string) {
    active.failures += 1;
    const delay = LIVE_ACHIEVEMENT_POLICY.backoffMs[Math.min(active.failures - 1, LIVE_ACHIEVEMENT_POLICY.backoffMs.length - 1)];
    this.log(active.appId, "poll_failure", 0, delay, reason);
    this.schedule(delay);
  }

  private isCurrent(active: ActivePoll, generation: number, request: object) {
    return this.active === active && this.generation === generation && this.request === request;
  }

  private suspendOffline() {
    const active = this.active;
    if (!active || active.suspended) return;
    active.suspended = true;
    this.generation += 1;
    this.clearTimer();
    this.gate.endLiveSession(active.appId);
    this.log(active.appId, "poll_stopped", 0, 0, "offline");
  }

  private stopActive(reason: string) {
    const active = this.active;
    this.generation += 1;
    this.resolvingSessionId = undefined;
    this.clearTimer();
    if (!active) return;
    this.active = undefined;
    this.gate.endLiveSession(active.appId);
    this.log(active.appId, "poll_stopped", 0, 0, reason);
  }

  private clearTimer() {
    if (this.timer !== undefined) this.environment.clearTimer(this.timer);
    this.timer = undefined;
  }

  private handleOffline = () => this.suspendOffline();
  private handleOnline = () => { void this.reconcile(); };

  private log(appId: string, event: LiveAchievementDiagnostic["event"], transitionCount: number, backoffMs: number, reason?: string) {
    this.diagnostics?.({ appId, event, transitionCount, backoffMs, ...(reason ? { reason } : {}) });
  }
}

function newestPlayingSession(sessions: ActiveGameSession[]) {
  return sessions
    .filter((session) => session.state === "playing")
    .sort((left, right) => right.startedAtMs - left.startedAtMs)[0];
}

function syncOutcome(value: unknown) {
  if (value === "unsupported") return { status: "unsupported", transitions: 0, reason: "unsupported" };
  const summary = value as Partial<SteamAchievementSyncResult> | undefined;
  const game = Array.isArray(summary?.games) ? summary.games[0] : undefined;
  return {
    status: game?.status ?? "failed",
    transitions: game?.unlockTransitions ?? 0,
    reason: game?.errorCode
  };
}

function safeReason(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
  return error instanceof Error && /^[a-z0-9_-]{1,48}$/i.test(error.message) ? error.message : "sync-failed";
}

function browserEnvironment(): LiveAchievementEnvironment {
  const listen = (type: "online" | "offline", listener: () => void) => {
    globalThis.addEventListener?.(type, listener);
    return () => globalThis.removeEventListener?.(type, listener);
  };
  return {
    isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer: (timer) => clearTimeout(timer),
    onOnline: (listener) => listen("online", listener),
    onOffline: (listener) => listen("offline", listener)
  };
}
