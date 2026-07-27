import type { AchievementDetails, GameDetails, GameId, AchievementId, UserPreferences } from "../types";
import type { AchievementRepository, ActivityRepository, GameRepository, ProfileRepository, SettingsRepository } from "../repositories/contracts";
import { defaultPreferences, normalizePreferences, preferencesEqual } from "./settingsPreferences";

export class GameService {
  constructor(private games: GameRepository, private achievements: AchievementRepository) {}
  list() { return this.games.getAllGames(); }
  async details(id: GameId): Promise<GameDetails | undefined> {
    const game = await this.games.getGameById(id); if (!game) return undefined;
    const items = await this.achievements.getAchievementsByGame(id);
    const unlocked = items.filter((item) => item.unlockedAt);
    return { ...game, rareAchievements: unlocked.filter((item) => item.rarityPercentage < 10).length, lockedAchievements: items.filter((item) => !item.unlockedAt).length, averageRarity: items.length ? items.reduce((sum, item) => sum + item.rarityPercentage, 0) / items.length : 0, latestAchievement: unlocked[0] };
  }
}
export class AchievementService {
  constructor(private achievements: AchievementRepository, private games: GameRepository) {}
  list() { return this.achievements.getAchievements(); }
  byGame(id: GameId) { return this.achievements.getAchievementsByGame(id); }
  async details(id: AchievementId): Promise<AchievementDetails | undefined> {
    const achievement = await this.achievements.getAchievementById(id); if (!achievement) return undefined;
    const game = await this.games.getGameById(achievement.gameId);
    const rarityTier = achievement.rarityPercentage <= 2 ? "ultra_rare" : achievement.rarityPercentage < 10 ? "rare" : achievement.rarityPercentage < 35 ? "uncommon" : "common";
    return { ...achievement, gameName: game?.name ?? "Unknown game", rarityTier };
  }
}
export class ActivityService { constructor(private repository: ActivityRepository) {} list() { return this.repository.getActivities(); } }
export class SettingsService {
  private cached?: UserPreferences;
  private pending?: UserPreferences;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(private repository: SettingsRepository) {}

  async get() {
    await this.saveQueue;
    if (this.cached) return structuredClone(this.cached);
    const stored = await this.repository.getPreferences();
    const normalized = normalizePreferences(stored);
    this.cached = normalized;
    if (!isCurrentSchema(stored, normalized)) {
      await this.repository.savePreferences(normalized);
    }
    return structuredClone(normalized);
  }

  save(value: UserPreferences) {
    const normalized = normalizePreferences(value);
    const latest = this.pending ?? this.cached;
    if (latest && preferencesEqual(latest, normalized)) {
      return Promise.resolve();
    }

    this.pending = normalized;
    const operation = this.saveQueue.then(async () => {
      await this.repository.savePreferences(normalized);
      this.cached = normalized;
    });
    this.saveQueue = operation
      .catch(() => undefined)
      .then(() => {
        if (this.pending && preferencesEqual(this.pending, normalized)) {
          this.pending = undefined;
        }
      });
    return operation;
  }

  async reset() {
    const current = await this.get();
    const defaults = {
      ...defaultPreferences,
      // Resetting preferences must not turn the first-run experience back on.
      onboardingCompleted: current.onboardingCompleted
    };
    await this.save(defaults);
    return structuredClone(defaults);
  }
}

function isCurrentSchema(stored: unknown, normalized: UserPreferences) {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return false;
  const value = stored as Partial<UserPreferences>;
  return (
    (value.theme === "system" || value.theme === "dark" || value.theme === "light") &&
    (value.language === "en" || value.language === "ar") &&
    typeof value.onboardingCompleted === "boolean" &&
    typeof value.launchAtStartup === "boolean" &&
    typeof value.minimizeToTray === "boolean" &&
    typeof value.notificationsEnabled === "boolean" &&
    typeof value.autoCheckForUpdates === "boolean" &&
    typeof value.hidePlaytime === "boolean" &&
    typeof value.hideHiddenGames === "boolean" &&
    preferencesEqual(value as UserPreferences, normalized)
  );
}
export class ProfileService {
  constructor(private repository: ProfileRepository) {}
  get() { return this.repository.getProfile(); }
  save(profile: import("../types").UserProfile) { return this.repository.saveProfile(profile); }
}
export class StatisticsService {
  constructor(private games: GameRepository, private achievements: AchievementRepository, private activities: ActivityRepository) {}
  async get() {
    const [games, achievements, activities] = await Promise.all([this.games.getAllGames(), this.achievements.getAchievements(), this.activities.getActivities()]);
    const weeklyActivity = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day,index)=>({day,hours:activities.filter((_,itemIndex)=>itemIndex%7===index).length*1.5}));
    return { games, achievements, weeklyActivity };
  }
}
