import type { Game } from "../types";
import type { SmartSyncStatus } from "./SmartSyncCoordinator";

export type GameCardSyncState = "updated" | "updating" | "saved" | "needsUpdate" | "offline" | "unavailable";

export function deriveGameCardSyncState(game: Game, runtimeStatus: SmartSyncStatus, online: boolean): GameCardSyncState {
  const hasCachedAchievements = game.totalAchievements > 0 || Boolean(game.achievementsSyncedAt);
  if (!online) return hasCachedAchievements ? "saved" : "offline";
  if (runtimeStatus === "updating" || runtimeStatus === "queued") return "updating";
  if (runtimeStatus === "saved") return "saved";
  if (runtimeStatus === "unavailable" || game.achievementsSyncStatus === "error" || game.achievementsSyncStatus === "partial") return "needsUpdate";
  if (game.achievementsSyncStatus === "unsupported") return "unavailable";
  if (game.achievementsSyncStatus === "success" && game.achievementsSyncedAt) return "updated";
  if (hasCachedAchievements) return "saved";
  return "needsUpdate";
}

export function achievementCompletion(unlocked: number, total: number) {
  if (!Number.isInteger(unlocked) || !Number.isInteger(total) || total <= 0 || unlocked < 0 || unlocked > total) return undefined;
  return Math.round((unlocked / total) * 100);
}
