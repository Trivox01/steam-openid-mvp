import type { GameRepository } from "../repositories/contracts";
import type { SteamOpenIdSignInService } from "./platform/SteamOpenIdSignInService";
import type { SteamLibrarySyncService } from "./platform/SteamLibrarySyncService";
import type { SteamAchievementSyncService } from "./platform/SteamAchievementSyncService";
import { publishLibraryChange } from "./dataEvents.ts";

export type SmartSyncTrigger = "startup" | "page-open" | "manual" | "reconnect" | "live-session";
export type SmartSyncStatus = "idle" | "queued" | "updating" | "success" | "saved" | "unavailable";
type Listener = () => void;
type Job = { key: string; priority: 1 | 2 | 3; run: (signal: AbortSignal) => Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void };

export const SMART_SYNC_POLICY = Object.freeze({
  libraryCooldownMs: 12 * 60_000,
  gameCooldownMs: 4 * 60_000,
  reconnectDebounceMs: 1_500,
  concurrency: 3,
  initialBackoffMs: 15_000,
  maximumBackoffMs: 5 * 60_000
});

export class SmartSyncCoordinator {
  private readonly sessions: SteamOpenIdSignInService | undefined;
  private readonly library: SteamLibrarySyncService;
  private readonly achievements: SteamAchievementSyncService;
  private readonly games: GameRepository;
  private readonly now: () => number;
  private readonly clearAccountCache: () => Promise<void>;
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly states = new Map<string, SmartSyncStatus>();
  private readonly failures = new Map<string, { count: number; retryAt: number }>();
  private readonly queue: Job[] = [];
  private readonly listeners = new Set<Listener>();
  private sessionController = new AbortController();
  private generation = 0;
  private running = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private stopSession?: () => void;
  private started = false;
  private currentGameId?: string;
  private activeAccount?: string;

  constructor(
    sessions: SteamOpenIdSignInService | undefined,
    library: SteamLibrarySyncService,
    achievements: SteamAchievementSyncService,
    games: GameRepository,
    now: () => number = Date.now,
    clearAccountCache: () => Promise<void> = async () => undefined
  ) {
    this.sessions = sessions;
    this.library = library;
    this.achievements = achievements;
    this.games = games;
    this.now = now;
    this.clearAccountCache = clearAccountCache;
  }

  start() {
    if (this.started) return;
    this.started = true;
    void this.sessions?.getSavedIdentity().then((identity) => { this.activeAccount = identity?.steamId; });
    this.stopSession = this.sessions?.subscribeSession((session) => { void this.handleSession(session); });
    globalThis.addEventListener?.("online", this.onOnline);
    globalThis.addEventListener?.("offline", this.onOffline);
    if (this.sessions?.getActiveSession() && this.isOnline()) void this.startup().catch(() => undefined);
  }

  private async handleSession(session: ReturnType<SteamOpenIdSignInService["getActiveSession"]>) {
    this.resetSession();
    if (!session) return;
    const identity = await this.sessions?.getSavedIdentity();
    const nextAccount = identity?.steamId;
    if (this.activeAccount && nextAccount && this.activeAccount !== nextAccount) {
      await this.clearAccountCache();
      publishLibraryChange();
    }
    this.activeAccount = nextAccount ?? this.activeAccount;
    if (this.isOnline()) await this.startup().catch(() => undefined);
  }

  stop() {
    this.stopSession?.();
    this.stopSession = undefined;
    globalThis.removeEventListener?.("online", this.onOnline);
    globalThis.removeEventListener?.("offline", this.onOffline);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.resetSession();
    this.started = false;
  }

  subscribe(listener: Listener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  getStatus(key: string) { return this.states.get(key) ?? "idle"; }
  get taskCount() { return this.inflight.size + this.queue.length; }

  async startup() {
    if (!this.canSync()) return undefined;
    const tasks: Promise<unknown>[] = [this.syncLibrary("startup")];
    if (this.currentGameId) tasks.push(this.syncGame(this.currentGameId, "startup"));
    return Promise.all(tasks);
  }

  syncLibrary(trigger: SmartSyncTrigger, force = trigger === "manual") {
    return this.schedule("library", 1, trigger, force, SMART_SYNC_POLICY.libraryCooldownMs, async (signal) => {
      const metadata = await this.library.getLastSync();
      if (!force && fresh(metadata?.lastSyncedAt, SMART_SYNC_POLICY.libraryCooldownMs, this.now())) return "cooldown";
      const result = await this.library.sync(signal);
      publishLibraryChange();
      return result;
    });
  }

  syncGame(gameId: string, trigger: SmartSyncTrigger, force = trigger === "manual") {
    this.currentGameId = gameId;
    return this.schedule(`achievements:${gameId}`, trigger === "page-open" ? 1 : 2, trigger, force, SMART_SYNC_POLICY.gameCooldownMs, async (signal) => {
      const game = await this.games.getGameById(gameId);
      if (!game || game.platform !== "steam") return "unsupported";
      if (!force && fresh(game.achievementsSyncedAt, SMART_SYNC_POLICY.gameCooldownMs, this.now())) return "cooldown";
      const result = await this.achievements.syncGame(gameId, signal);
      publishLibraryChange();
      return result;
    });
  }

  syncLiveGame(gameId: string) {
    return this.schedule(`achievements:${gameId}`, 1, "live-session", true, 0, async (signal) => {
      const game = await this.games.getGameById(gameId);
      if (!game || game.platform !== "steam") return "unsupported";
      const result = await this.achievements.syncLiveGame(gameId, signal);
      publishLibraryChange();
      return result;
    });
  }

  manualRefresh() {
    if (!this.canSync()) return Promise.resolve([]);
    const tasks: Promise<unknown>[] = [this.syncLibrary("manual", true)];
    if (this.currentGameId) tasks.push(this.syncGame(this.currentGameId, "manual", true));
    return Promise.all(tasks);
  }

  private schedule(key: string, priority: 1 | 2 | 3, trigger: SmartSyncTrigger, force: boolean, cooldownMs: number, run: Job["run"]): Promise<unknown> {
    const existing = this.inflight.get(key);
    if (existing) { this.log(key, trigger, "joined-existing"); return existing; }
    if (!this.canSync()) { this.setStatus(key, this.isOnline() ? "unavailable" : "saved"); return Promise.resolve("skipped"); }
    const failure = this.failures.get(key);
    if (!force && failure && this.now() < failure.retryAt) return Promise.resolve("backoff");
    void cooldownMs;
    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<unknown>((ok, no) => { resolve = ok; reject = no; });
    this.inflight.set(key, promise);
    this.queue.push({ key, priority, run, resolve, reject });
    this.queue.sort((a, b) => a.priority - b.priority);
    this.setStatus(key, "queued");
    this.log(key, trigger, "started-new");
    this.drain(trigger);
    return promise;
  }

  private drain(trigger: SmartSyncTrigger) {
    while (this.running < SMART_SYNC_POLICY.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      const generation = this.generation;
      const started = performance.now();
      this.running += 1;
      this.setStatus(job.key, "updating");
      job.run(this.sessionController.signal).then((value) => {
        if (generation !== this.generation) throw new DOMException("stale session", "AbortError");
        this.failures.delete(job.key);
        this.setStatus(job.key, value === "cooldown" ? "success" : "success");
        job.resolve(value);
        this.log(job.key, trigger, "success", started);
      }).catch((error) => {
        if (generation === this.generation && !this.sessionController.signal.aborted) {
          const count = (this.failures.get(job.key)?.count ?? 0) + 1;
          const delay = Math.min(SMART_SYNC_POLICY.initialBackoffMs * 2 ** (count - 1), SMART_SYNC_POLICY.maximumBackoffMs);
          this.failures.set(job.key, { count, retryAt: this.now() + delay });
          this.setStatus(job.key, this.isOnline() ? "unavailable" : "saved");
        }
        job.reject(error);
        this.log(job.key, trigger, "failed", started);
      }).finally(() => {
        this.running -= 1;
        this.inflight.delete(job.key);
        this.drain(trigger);
      });
    }
  }

  private resetSession() {
    this.generation += 1;
    this.sessionController.abort();
    this.sessionController = new AbortController();
    for (const job of this.queue.splice(0)) job.reject(new DOMException("session changed", "AbortError"));
    this.inflight.clear();
    this.failures.clear();
    this.states.clear();
    this.emit();
  }

  private canSync() { return Boolean(this.sessions?.getActiveSession()) && this.isOnline(); }
  private isOnline() { return typeof navigator === "undefined" || navigator.onLine !== false; }
  private onOffline = () => { for (const key of this.states.keys()) this.setStatus(key, "saved"); };
  private onOnline = () => {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => { if (this.canSync()) void this.syncLibrary("reconnect"); }, SMART_SYNC_POLICY.reconnectDebounceMs);
  };
  private setStatus(key: string, status: SmartSyncStatus) { this.states.set(key, status); this.emit(); }
  private emit() { this.listeners.forEach((listener) => listener()); }
  private log(key: string, trigger: SmartSyncTrigger, result: string, started?: number) {
    if (!(import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) return;
    console.info("[smart-sync]", { taskId: key.replace(/[^a-z0-9:_-]/gi, "_").slice(0, 64), type: key.split(":")[0], trigger, result, durationMs: started === undefined ? 0 : Math.round(performance.now() - started) });
  }
}

function fresh(value: string | undefined, cooldown: number, now: number) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) && now - time < cooldown;
}
