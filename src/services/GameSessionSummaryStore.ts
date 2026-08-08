import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "../runtime/environment";
import { mergeUnseenSummaries } from "./sessionSummaryQueue";

export interface SessionProgress {
  unlocked: number;
  total: number;
  completionPercentage: number;
}

export interface SessionAchievement {
  achievementId: string;
  name: string;
  description: string;
  iconUrl?: string;
  unlockedAt: string;
  rarityPercentage?: number;
}

export interface GameSessionSummary {
  sessionId: string;
  appId: string;
  gameId?: string;
  gameName: string;
  coverUrl?: string;
  backgroundUrl?: string;
  startedAtMs: number;
  endedAtMs: number;
  durationSeconds: number;
  achievementsUnlocked: SessionAchievement[];
  unlockedCount: number;
  progressBefore?: SessionProgress;
  progressAfter?: SessionProgress;
  progressDelta?: number;
  source: "session_monitor" | "steam_unlock_time";
  generatedAtMs: number;
  recovered: boolean;
  seen: boolean;
}

type Listener = () => void;

const summaryEvent = "nexus://game-session-summary-ready";
const visibilityEvent = "nexus://app-visibility-changed";
const maxUnseen = 6;

export class GameSessionSummaryStore {
  private unseen: GameSessionSummary[] = [];
  private visible = typeof document === "undefined" || document.visibilityState === "visible";
  private listeners = new Set<Listener>();
  private initialized = false;

  constructor() {
    if (!isTauriRuntime()) return;
    void listen<GameSessionSummary>(summaryEvent, ({ payload }) => this.enqueue(payload)).catch(() => undefined);
    void listen<boolean>(visibilityEvent, ({ payload }) => this.setVisible(payload)).catch(() => undefined);
    const onVisibility = () => this.setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    void this.refreshUnseen();
  }

  active(): GameSessionSummary | undefined {
    return this.visible ? this.unseen[0] : undefined;
  }

  pendingCount(): number {
    return this.unseen.length;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener();
    return () => this.listeners.delete(listener);
  }

  async dismiss(sessionId: string): Promise<void> {
    this.unseen = this.unseen.filter((summary) => summary.sessionId !== sessionId);
    this.emit();
    if (!isTauriRuntime()) return;
    await invoke("mark_game_session_summary_seen", { sessionId }).catch(() => undefined);
  }

  async forGame(appId: string, limit = 5): Promise<GameSessionSummary[]> {
    if (!isTauriRuntime()) return [];
    try {
      return await invoke<GameSessionSummary[]>("list_game_session_summaries", {
        appId,
        unseenOnly: false,
        limit: Math.max(1, Math.min(limit, 20))
      });
    } catch {
      return [];
    }
  }

  preview(summary: GameSessionSummary) {
    if (!import.meta.env.DEV) return;
    this.enqueue(summary);
  }

  private async refreshUnseen() {
    if (!isTauriRuntime()) return;
    try {
      const summaries = await invoke<GameSessionSummary[]>("list_game_session_summaries", {
        unseenOnly: true,
        limit: maxUnseen
      });
      this.unseen = mergeUnseenSummaries(this.unseen, summaries);
      this.initialized = true;
      this.emit();
    } catch {
      this.initialized = true;
    }
  }

  private enqueue(summary: GameSessionSummary) {
    this.unseen = mergeUnseenSummaries(this.unseen, [summary]);
    this.emit();
  }

  private setVisible(visible: boolean) {
    if (this.visible === visible && this.initialized) return;
    this.visible = visible;
    if (visible) void this.refreshUnseen();
    this.emit();
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }
}
