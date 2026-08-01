export type GameLaunchStatus =
  | "ready"
  | "launching"
  | "running"
  | "alreadyRunning"
  | "steamUnavailable"
  | "steamNotInstalled"
  | "gameUnavailable"
  | "launchFailed"
  | "offline";

export type GameSessionState = "running" | "notRunning" | "unknown";

export interface GameSessionProbe {
  getState(appId: string): Promise<GameSessionState>;
}

export interface GameSessionLifecycleEvent {
  type: "sessionStarted" | "sessionEnded";
  appId: string;
  occurredAt: string;
}

export interface SteamLaunchTransport {
  open(uri: string): Promise<void>;
}

export interface GameLaunchSnapshot {
  appId: string;
  status: GameLaunchStatus;
  result?: "launchRequested";
}

type Listener = (snapshot: GameLaunchSnapshot) => void;
type LauncherLogger = (entry: { appId: string; launchUri: string; result: string; durationMs: number }) => void;

const MAX_STEAM_APP_ID = 4_294_967_295;
const defaultProbe: GameSessionProbe = { getState: async () => "unknown" };

export class GameLauncherService {
  private readonly snapshots = new Map<string, GameLaunchSnapshot>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly inFlight = new Map<string, Promise<GameLaunchSnapshot>>();
  private readonly transport: SteamLaunchTransport;
  private readonly sessionProbe: GameSessionProbe;
  private readonly online: () => boolean;
  private readonly logger?: LauncherLogger;
  private readonly retryDelayMs: number;

  constructor(
    transport: SteamLaunchTransport,
    sessionProbe: GameSessionProbe = defaultProbe,
    online: () => boolean = () => typeof navigator === "undefined" || navigator.onLine,
    logger?: LauncherLogger,
    retryDelayMs = 700
  ) {
    this.transport = transport;
    this.sessionProbe = sessionProbe;
    this.online = online;
    this.logger = logger;
    this.retryDelayMs = retryDelayMs;
  }

  static normalizeAppId(value: string | number): string | undefined {
    const raw = String(value).trim();
    if (!/^[1-9]\d*$/.test(raw)) return undefined;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed <= MAX_STEAM_APP_ID ? String(parsed) : undefined;
  }

  static buildLaunchUri(value: string | number): string {
    const appId = GameLauncherService.normalizeAppId(value);
    if (!appId) throw new Error("invalid_app_id");
    return `steam://run/${appId}`;
  }

  getSnapshot(value: string | number): GameLaunchSnapshot {
    const normalized = GameLauncherService.normalizeAppId(value);
    if (!normalized) return { appId: String(value), status: "gameUnavailable" };
    const appId = normalized;
    return this.snapshots.get(appId) ?? { appId, status: this.online() ? "ready" : "offline" };
  }

  subscribe(value: string | number, listener: Listener): () => void {
    const appId = GameLauncherService.normalizeAppId(value) ?? String(value);
    const listeners = this.listeners.get(appId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(appId, listeners);
    listener(this.getSnapshot(appId));
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(appId);
    };
  }

  launch(value: string | number): Promise<GameLaunchSnapshot> {
    const appId = GameLauncherService.normalizeAppId(value);
    if (!appId) return Promise.resolve(this.publish({ appId: String(value), status: "gameUnavailable" }));
    const existing = this.inFlight.get(appId);
    if (existing) return existing;
    const launch = this.performLaunch(appId).finally(() => this.inFlight.delete(appId));
    this.inFlight.set(appId, launch);
    return launch;
  }

  private async performLaunch(appId: string): Promise<GameLaunchSnapshot> {
    const startedAt = performance.now();
    const launchUri = GameLauncherService.buildLaunchUri(appId);
    try {
      if (await this.sessionProbe.getState(appId) === "running") {
        return this.finish({ appId, status: "alreadyRunning" }, launchUri, startedAt);
      }
      this.publish({ appId, status: "launching" });
      try {
        await this.transport.open(launchUri);
      } catch {
        try {
          await this.transport.open("steam://open/main");
        } catch {
          return this.finish({ appId, status: "steamNotInstalled" }, launchUri, startedAt);
        }
        await delay(this.retryDelayMs);
        try {
          await this.transport.open(launchUri);
        } catch {
          return this.finish({ appId, status: "steamUnavailable" }, launchUri, startedAt);
        }
      }
      const state = await this.sessionProbe.getState(appId);
      if (state === "running") return this.finish({ appId, status: "running" }, launchUri, startedAt);
      return this.finish({ appId, status: this.online() ? "ready" : "offline", result: "launchRequested" }, launchUri, startedAt);
    } catch {
      return this.finish({ appId, status: "launchFailed" }, launchUri, startedAt);
    }
  }

  private publish(snapshot: GameLaunchSnapshot) {
    this.snapshots.set(snapshot.appId, snapshot);
    this.listeners.get(snapshot.appId)?.forEach((listener) => listener(snapshot));
    return snapshot;
  }

  private finish(snapshot: GameLaunchSnapshot, launchUri: string, startedAt: number) {
    this.logger?.({ appId: snapshot.appId, launchUri, result: snapshot.status, durationMs: Math.round(performance.now() - startedAt) });
    return this.publish(snapshot);
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
