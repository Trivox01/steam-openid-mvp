export type AchievementToastSource = "sync_delta" | "test_preview" | "future_live_detection";

export type AchievementToastEvent = {
  eventId: string;
  appId: string;
  achievementId: string;
  name: string;
  description?: string;
  iconUrl?: string;
  rarity?: number;
  unlockedAt?: string;
  source: AchievementToastSource;
  sound?: "default" | "silent";
};

export type AchievementToastSnapshot = {
  active?: AchievementToastEvent;
  queued: number;
  overflow: number;
  paused: boolean;
};

const DEFAULT_DURATION = 6_000;
const MAX_QUEUE = 8;
const MAX_RECENT = 160;

export class AchievementToastCoordinator {
  private readonly now: () => number;
  private queue: AchievementToastEvent[] = [];
  private recent = new Map<string, number>();
  private active?: AchievementToastEvent;
  private overflow = 0;
  private timer?: number;
  private remaining = DEFAULT_DURATION;
  private startedAt = 0;
  private pauses = new Set<string>();
  private listeners = new Set<(snapshot: AchievementToastSnapshot) => void>();
  private notificationsEnabled = true;
  private soundEnabled = false;
  private visible = typeof document === "undefined" || document.visibilityState === "visible";

  constructor(now = () => Date.now()) { this.now = now; }

  configure(settings: { notificationsEnabled: boolean; soundEnabled: boolean }) {
    this.notificationsEnabled = settings.notificationsEnabled;
    this.soundEnabled = settings.soundEnabled;
    if (!settings.notificationsEnabled) this.clear();
  }

  enqueue(event: AchievementToastEvent) {
    if (!this.notificationsEnabled || !validEvent(event)) return false;
    const key = eventKey(event);
    if (this.recent.has(key)) return false;
    this.remember(key);
    if (this.active || this.queue.length) {
      if (this.queue.length >= MAX_QUEUE) this.overflow += 1;
      else this.queue.push(event);
    } else if (this.visible) {
      this.activate(event);
    } else {
      this.queue.push(event);
    }
    this.emit();
    return true;
  }

  dismiss() {
    this.stopTimer();
    this.active = undefined;
    this.remaining = DEFAULT_DURATION;
    this.presentNext();
  }

  pause(reason: "hover" | "focus") {
    if (this.pauses.has(reason)) return;
    this.pauses.add(reason);
    if (this.active && this.timer) {
      this.remaining = Math.max(0, this.remaining - (this.now() - this.startedAt));
      this.stopTimer();
    }
    this.emit();
  }

  resume(reason: "hover" | "focus") {
    this.pauses.delete(reason);
    if (!this.pauses.size && this.active && this.visible) this.startTimer();
    this.emit();
  }

  setAppVisible(visible: boolean) {
    this.visible = visible;
    if (!visible) {
      if (this.active) {
        this.queue.unshift(this.active);
        this.active = undefined;
      }
      this.stopTimer();
    } else {
      this.presentNext();
    }
    this.emit();
  }

  subscribe(listener: (snapshot: AchievementToastSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => { this.listeners.delete(listener); };
  }

  getSnapshot(): AchievementToastSnapshot {
    return { active: this.active, queued: this.queue.length, overflow: this.overflow, paused: Boolean(this.pauses.size) };
  }

  isSoundEnabled() { return this.soundEnabled; }

  clear() {
    this.stopTimer();
    this.queue = [];
    this.active = undefined;
    this.overflow = 0;
    this.pauses.clear();
    this.emit();
  }

  private presentNext() {
    if (!this.visible || this.active) return;
    const next = this.queue.shift();
    if (!next) {
      this.overflow = 0;
      this.emit();
      return;
    }
    this.activate(next);
    this.emit();
  }

  private activate(event: AchievementToastEvent) {
    this.active = event;
    this.remaining = descriptionDuration(event.description);
    if (!this.pauses.size) this.startTimer();
  }

  private startTimer() {
    this.stopTimer();
    this.startedAt = this.now();
    this.timer = window.setTimeout(() => this.dismiss(), this.remaining);
  }

  private stopTimer() {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private remember(key: string) {
    this.recent.set(key, this.now());
    while (this.recent.size > MAX_RECENT) {
      const oldest = this.recent.keys().next().value;
      if (oldest === undefined) break;
      this.recent.delete(oldest);
    }
  }

  private emit() {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

export function eventKey(event: AchievementToastEvent) {
  return `${event.appId}:${event.achievementId}:${event.unlockedAt ?? "unlocked"}`;
}

function validEvent(event: AchievementToastEvent) {
  return Boolean(event.eventId.trim() && event.appId.trim() && event.achievementId.trim() && event.name.trim());
}

function descriptionDuration(description?: string) {
  return description && description.length > 120 ? 7_000 : DEFAULT_DURATION;
}
