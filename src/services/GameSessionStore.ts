import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "../runtime/environment";

export type SessionState = "starting" | "playing" | "ending";
export type SessionLaunchSource = "steam_local" | "nexus_launch" | "external_launch";

export interface ActiveGameSession {
  sessionId: string;
  appId: string;
  state: SessionState;
  startedAtMs: number;
  lastSeenAtMs: number;
  launchSource: SessionLaunchSource;
  recovered: boolean;
}

export interface GameSessionSummary {
  appId: string;
  startedAtMs: number;
  endedAtMs: number;
  durationSeconds: number;
  launchSource: string;
}

export interface SessionStatistics {
  sessionsToday: number;
  secondsToday: number;
  lastSession: GameSessionSummary | null;
  recentSessions: GameSessionSummary[];
}

type Listener = () => void;

const sessionStateEvent = "nexus://game-session-state";

export class GameSessionStore {
  private sessions = new Map<string, ActiveGameSession>();
  private readonly listeners = new Set<Listener>();
  private ticker: ReturnType<typeof setInterval> | undefined;

  constructor() {
    if (!isTauriRuntime()) {
      return;
    }
    void listen<{ sessions: ActiveGameSession[] }>(sessionStateEvent, (event) => {
      this.replace(event.payload.sessions);
    }).catch(() => undefined);
    void invoke<ActiveGameSession[]>("list_game_sessions")
      .then((sessions) => this.replace(sessions))
      .catch(() => undefined);
  }

  find(appId: string): ActiveGameSession | undefined {
    return this.sessions.get(appId);
  }

  isRunning(appId: string): boolean {
    return this.sessions.has(appId);
  }

  sessionCount(): number {
    return this.sessions.size;
  }

  elapsedSeconds(appId: string): number {
    const started = this.sessions.get(appId)?.startedAtMs;
    if (started === undefined) return 0;
    return Math.max(0, Math.floor((Date.now() - started) / 1000));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener();
    return () => {
      this.listeners.delete(listener);
    };
  }

  async statistics(limit = 20): Promise<SessionStatistics | undefined> {
    if (!isTauriRuntime()) return undefined;
    try {
      const result = await invoke<SessionStatistics>("game_session_statistics", { limit });
      return { ...result, lastSession: result.lastSession ?? null };
    } catch {
      return undefined;
    }
  }

  notifyLaunch(appId: string) {
    if (!isTauriRuntime()) return;
    void invoke("note_game_session_launch", { appId }).catch(() => undefined);
  }

  private replace(sessions: ActiveGameSession[]) {
    this.sessions = new Map(sessions.map((session) => [session.appId, session]));
    this.syncTicker();
    this.emit();
  }

  private syncTicker() {
    const active = this.sessions.size > 0;
    if (active && this.ticker === undefined) {
      this.ticker = setInterval(() => this.emit(), 1000);
    }
    if (!active && this.ticker !== undefined) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }
}