import type { AchievementToastCoordinator, AchievementToastSnapshot } from "./AchievementToastCoordinator";
import type { AchievementSoundService } from "./AchievementSoundService";

export class AchievementToastSoundController {
  private coordinator: AchievementToastCoordinator;
  private sound: AchievementSoundService;
  private activeEventId?: string;
  private suppressBurst = false;
  private disposed = false;
  private unsubscribe: () => void;

  constructor(coordinator: AchievementToastCoordinator, sound: AchievementSoundService) {
    this.coordinator = coordinator;
    this.sound = sound;
    this.unsubscribe = coordinator.subscribe((snapshot) => this.changed(snapshot));
  }

  configure(settings: { enabled: boolean; volume: number }) {
    this.sound.configure(settings);
    void this.sound.preload();
  }

  cleanup() { this.disposed = true; this.unsubscribe(); this.sound.cleanup(); }

  private changed(snapshot: AchievementToastSnapshot) {
    if (this.disposed) return;
    if (!snapshot.active) {
      this.activeEventId = undefined;
      if (snapshot.queued === 0) this.suppressBurst = false;
      return;
    }
    if (snapshot.active.eventId === this.activeEventId) return;
    this.activeEventId = snapshot.active.eventId;
    if (snapshot.active.sound === "silent" || this.suppressBurst) return;
    queueMicrotask(() => {
      if (this.disposed || this.coordinator.getSnapshot().active?.eventId !== snapshot.active?.eventId) return;
      const latest = this.coordinator.getSnapshot();
      if (latest.queued + latest.overflow >= 4) this.suppressBurst = true;
      void this.sound.play();
    });
  }
}
