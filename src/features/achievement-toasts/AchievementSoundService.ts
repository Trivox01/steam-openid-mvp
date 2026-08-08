export type AchievementAudioPort = {
  preload: () => Promise<void>;
  play: (volume: number) => Promise<void>;
  stop: () => void;
  dispose: () => void;
};

export class AchievementSoundService {
  private readonly audio?: AchievementAudioPort;
  private readonly now: () => number;
  private readonly cooldownMs: number;
  private enabled = false;
  private volume = 70;
  private lastPlayedAt = -Infinity;
  private preloaded = false;
  private preloadAttempted = false;

  constructor(audio?: AchievementAudioPort, now = () => Date.now(), cooldownMs = 900) {
    this.audio = audio;
    this.now = now;
    this.cooldownMs = cooldownMs;
  }

  configure(settings: { enabled: boolean; volume: number }) {
    this.enabled = settings.enabled;
    this.volume = clampVolume(settings.volume);
    if (!settings.enabled || this.volume === 0) this.stop();
  }

  async preload() {
    if (!this.audio || this.preloaded || this.preloadAttempted) return this.preloaded;
    this.preloadAttempted = true;
    try {
      await this.audio.preload();
      this.preloaded = true;
    } catch (error) {
      logDevelopmentFailure("preload", error);
    }
    return this.preloaded;
  }

  async play() {
    if (!this.enabled || this.volume === 0 || !this.audio) return false;
    const now = this.now();
    if (now - this.lastPlayedAt < this.cooldownMs) return false;
    this.lastPlayedAt = now;
    this.audio.stop();
    try {
      if (!this.preloaded && !(await this.preload())) return false;
      await this.audio.play(this.volume / 100);
      return true;
    } catch (error) {
      logDevelopmentFailure("play", error);
      return false;
    }
  }

  stop() { this.audio?.stop(); }
  cleanup() { this.stop(); this.audio?.dispose(); }
  getSettings() { return { enabled: this.enabled, volume: this.volume }; }
}

export function createHtmlAudioPort(assetUrl?: string): AchievementAudioPort | undefined {
  if (!assetUrl || typeof Audio === "undefined") return undefined;
  const audio = new Audio(assetUrl);
  audio.preload = "auto";
  return {
    preload: () => new Promise<void>((resolve, reject) => {
      if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) { resolve(); return; }
      const ready = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error("achievement_audio_unavailable")); };
      const cleanup = () => { audio.removeEventListener("canplaythrough", ready); audio.removeEventListener("error", failed); };
      audio.addEventListener("canplaythrough", ready, { once: true });
      audio.addEventListener("error", failed, { once: true });
      audio.load();
    }),
    play: async (volume) => { audio.currentTime = 0; audio.volume = clampVolume(volume * 100) / 100; await audio.play(); },
    stop: () => { audio.pause(); audio.currentTime = 0; },
    dispose: () => { audio.pause(); audio.removeAttribute("src"); audio.load(); }
  };
}

function clampVolume(value: number) { return Math.min(100, Math.max(0, Number.isFinite(value) ? Math.round(value) : 70)); }
function logDevelopmentFailure(stage: "preload" | "play", error: unknown) {
  if (import.meta.env?.DEV) console.warn("[achievement-sound]", { stage, reason: error instanceof Error ? error.name : "unavailable" });
}
