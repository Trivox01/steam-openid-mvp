import type { AchievementToastEvent } from "./AchievementToastCoordinator.ts";

type LiveSessionState = {
  active: boolean;
  baselineReady: boolean;
  emitted: Set<string>;
  inFlight: number;
};

export type LiveAchievementSyncScope = LiveSessionState | undefined;

export class LiveAchievementTransitionGate {
  private readonly sessions = new Map<string, LiveSessionState>();

  begin(appId: string) {
    if (this.sessions.get(appId)?.active) return;
    this.sessions.set(appId, { active: true, baselineReady: false, emitted: new Set(), inFlight: 0 });
  }

  resetBaseline(appId: string) {
    const session = this.sessions.get(appId);
    if (session?.active) session.baselineReady = false;
  }

  end(appId: string) {
    const session = this.sessions.get(appId);
    if (!session) return;
    session.active = false;
    session.baselineReady = false;
    if (session.inFlight === 0) this.sessions.delete(appId);
  }

  acquire(appId: string, requireActiveSession = false): LiveAchievementSyncScope {
    const session = this.sessions.get(appId) ?? (requireActiveSession
      ? { active: false, baselineReady: false, emitted: new Set<string>(), inFlight: 0 }
      : undefined);
    if (session) session.inFlight += 1;
    return session;
  }

  release(appId: string, session: LiveAchievementSyncScope) {
    if (!session) return;
    session.inFlight = Math.max(0, session.inFlight - 1);
    if (!session.active && session.inFlight === 0 && this.sessions.get(appId) === session) {
      this.sessions.delete(appId);
    }
  }

  transitions(appId: string, events: AchievementToastEvent[], playerStatsAvailable: boolean, session: LiveAchievementSyncScope) {
    if (!session) return events;
    if (!session.active) return [];
    if (!session.baselineReady) {
      if (playerStatsAvailable) session.baselineReady = true;
      return [];
    }
    return events.flatMap((event) => {
      const transitionKey = `${appId}:${event.achievementId}`;
      if (session.emitted.has(transitionKey)) return [];
      session.emitted.add(transitionKey);
      return [{ ...event, source: "live_detection" as const }];
    });
  }
}
