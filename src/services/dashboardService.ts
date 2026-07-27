import { mockDashboardData } from "../data/mockData";
import type { DashboardData } from "../types";
import { repositories } from "./compositionRoot";
import type { AchievementJourneySource } from "./intelligence/achievementJourneyAdapter";

export async function getDashboardData(): Promise<DashboardData> {
  const [profile, games, recentAchievements] = await Promise.all([
    repositories.profile.getProfile(),
    repositories.games.getAllGames(),
    repositories.achievements.getAchievements()
  ]);
  return { ...mockDashboardData, profile: profile ?? mockDashboardData.profile, games, recentAchievements: recentAchievements.filter((item)=>item.unlockedAt).slice(0,3) };
}

export async function getAchievementJourneySource(): Promise<AchievementJourneySource> {
  const [profile, games, achievements, activity] = await Promise.all([
    repositories.profile.getProfile(),
    repositories.games.getAllGames(),
    repositories.achievements.getAchievements(),
    repositories.activities.getActivities()
  ]);
  return {
    profile: profile ?? mockDashboardData.profile,
    games,
    achievements,
    activity,
    analyzedAt: new Date().toISOString(),
    capabilities: {
      weeklyPlaytime: false,
      achievementProgress: false
    }
  };
}
