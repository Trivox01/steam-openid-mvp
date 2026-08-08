export type AchievementAudioPort = {
  preload: () => Promise<void>;
  play: (volume: number) => Promise<void>;
  unlock?: () => Promise<void>;
  stop: () => void;
  dispose: () => void;
};

export type AchievementSoundDiagnostic = {
  event: "asset" | "configure" | "preload" | "unlock" | "play";
  outcome: "resolved" | "unavailable" | "attempted" | "success" | "failure" | "skipped";
  assetResolved: boolean;
  enabled: boolean;
  volume: number;
  appState: "foreground" | "background";
  reason?: string;
};

type DiagnosticLogger = (diagnostic: AchievementSoundDiagnostic) => void;

export class AchievementSoundService {
  private readonly audio?: AchievementAudioPort;
  private readonly now: () => number;
  private readonly cooldownMs: number;
  private readonly diagnostics: DiagnosticLogger;
  private enabled = false;
  private volume = 70;
  private lastPlayedAt = -Infinity;
  private preloaded = false;
  private preloadPromise?: Promise<boolean>;
  private playPromise?: Promise<boolean>;
  private unlockPromise?: Promise<boolean>;

  constructor(
    audio?: AchievementAudioPort,
    now = () => Date.now(),
    cooldownMs = 900,
    diagnostics: DiagnosticLogger = logDevelopmentDiagnostic
  ) {
    this.audio = audio;
    this.now = now;
    this.cooldownMs = cooldownMs;
    this.diagnostics = diagnostics;
    this.report("asset", audio ? "resolved" : "unavailable");
  }

  configure(settings: { enabled: boolean; volume: number }) {
    this.enabled = settings.enabled;
    this.volume = clampVolume(settings.volume);
    this.report("configure", "success");
    if (!settings.enabled || this.volume === 0) this.stop();
  }

  preload() {
    if (!this.audio) {
      this.report("preload", "failure", "AudioUnavailable");
      return Promise.resolve(false);
    }
    if (this.preloaded) return Promise.resolve(true);
    if (this.preloadPromise) return this.preloadPromise;

    this.report("preload", "attempted");
    this.preloadPromise = this.audio.preload()
      .then(() => {
        this.preloaded = true;
        this.report("preload", "success");
        return true;
      })
      .catch((error: unknown) => {
        this.report("preload", "failure", errorName(error));
        return false;
      });
    return this.preloadPromise;
  }

  unlock() {
    if (!this.audio?.unlock) return Promise.resolve(Boolean(this.audio));
    if (this.unlockPromise) return this.unlockPromise;

    this.report("unlock", "attempted");
    this.unlockPromise = this.audio.unlock()
      .then(() => {
        this.report("unlock", "success");
        return true;
      })
      .catch((error: unknown) => {
        this.report("unlock", "failure", errorName(error));
        this.unlockPromise = undefined;
        return false;
      });
    return this.unlockPromise;
  }

  play() {
    if (!this.audio) {
      this.report("play", "skipped", "AudioUnavailable");
      return Promise.resolve(false);
    }
    if (!this.enabled) {
      this.report("play", "skipped", "Disabled");
      return Promise.resolve(false);
    }
    if (this.volume === 0) {
      this.report("play", "skipped", "Muted");
      return Promise.resolve(false);
    }
    if (this.playPromise) {
      this.report("play", "skipped", "AlreadyPlaying");
      return this.playPromise;
    }
    const now = this.now();
    if (now - this.lastPlayedAt < this.cooldownMs) {
      this.report("play", "skipped", "Cooldown");
      return Promise.resolve(false);
    }

    this.report("play", "attempted");
    this.playPromise = this.performPlay(now).finally(() => { this.playPromise = undefined; });
    return this.playPromise;
  }

  stop() { this.audio?.stop(); }
  cleanup() { this.stop(); this.audio?.dispose(); }
  getSettings() { return { enabled: this.enabled, volume: this.volume }; }

  private async performPlay(now: number) {
    try {
      if (!this.preloaded && !(await this.preload())) return false;
      this.audio?.stop();
      await this.audio?.play(this.volume / 100);
      this.lastPlayedAt = now;
      this.report("play", "success");
      return true;
    } catch (error) {
      this.report("play", "failure", errorName(error));
      return false;
    }
  }

  private report(event: AchievementSoundDiagnostic["event"], outcome: AchievementSoundDiagnostic["outcome"], reason?: string) {
    this.diagnostics({
      event,
      outcome,
      assetResolved: Boolean(this.audio),
      enabled: this.enabled,
      volume: this.volume,
      appState: appState(),
      ...(reason ? { reason } : {})
    });
  }
}

export function createHtmlAudioPort(assetUrl?: string): AchievementAudioPort | undefined {
  if (!assetUrl || typeof Audio === "undefined") return undefined;
  const audio = new Audio(assetUrl);
  audio.preload = "auto";
  return {
    preload: () => new Promise<void>((resolve, reject) => {
      if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) { resolve(); return; }
      const ready = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(namedError("MediaError")); };
      const cleanup = () => { audio.removeEventListener("canplaythrough", ready); audio.removeEventListener("error", failed); };
      audio.addEventListener("canplaythrough", ready, { once: true });
      audio.addEventListener("error", failed, { once: true });
      audio.load();
    }),
    unlock: async () => {
      const previousMuted = audio.muted;
      const previousVolume = audio.volume;
      audio.muted = true;
      audio.volume = 0;
      try {
        audio.currentTime = 0;
        await audio.play();
        audio.pause();
        audio.currentTime = 0;
      } finally {
        audio.muted = previousMuted;
        audio.volume = previousVolume;
      }
    },
    play: async (volume) => {
      audio.currentTime = 0;
      audio.muted = false;
      audio.volume = clampVolume(volume * 100) / 100;
      await audio.play();
    },
    stop: () => { audio.pause(); audio.currentTime = 0; },
    dispose: () => { audio.pause(); audio.removeAttribute("src"); audio.load(); }
  };
}

export function installAchievementAudioUnlock(service: AchievementSoundService, target: Window = window) {
  let started = false;
  const events = ["pointerdown", "keydown", "click"] as const;
  const cleanup = () => events.forEach((event) => target.removeEventListener(event, handleInteraction, true));
  const handleInteraction = () => {
    if (started) return;
    started = true;
    void service.unlock().then((unlocked) => {
      if (unlocked) cleanup();
      else started = false;
    });
  };
  events.forEach((event) => target.addEventListener(event, handleInteraction, { capture: true, passive: true }));
  return cleanup;
}

function clampVolume(value: number) { return Math.min(100, Math.max(0, Number.isFinite(value) ? Math.round(value) : 70)); }
function appState(): AchievementSoundDiagnostic["appState"] {
  return typeof document !== "undefined" && document.visibilityState === "hidden" ? "background" : "foreground";
}
function errorName(error: unknown) {
  const name = error instanceof Error ? error.name : "Unavailable";
  return /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name) ? name : "Unavailable";
}
function namedError(name: string) { const error = new Error(); error.name = name; return error; }
function logDevelopmentDiagnostic(diagnostic: AchievementSoundDiagnostic) {
  if (!import.meta.env?.DEV) return;
  const method = diagnostic.outcome === "failure" ? "warn" : "debug";
  console[method]("[achievement-sound]", JSON.stringify(diagnostic));
}
