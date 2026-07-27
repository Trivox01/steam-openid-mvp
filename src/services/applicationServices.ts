import type { AchievementDetails, GameDetails, GameId, AchievementId, UserPreferences } from "../types";
import type { AchievementRepository, ActivityRepository, GameRepository, ProfileRepository, SettingsRepository } from "../repositories/contracts";

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
  constructor(private repository: SettingsRepository) {}
  get() { return this.repository.getPreferences(); }
  save(value: UserPreferences) { return this.repository.savePreferences(value); }
  reset() { return this.repository.resetPreferences(); }
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
