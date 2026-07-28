import type { DashboardData } from "../types";
import { repositories } from "./compositionRoot";
import type { AchievementJourneySource } from "./intelligence/achievementJourneyAdapter";

export async function getDashboardData(): Promise<DashboardData> {
  const [profile, games, recentAchievements] = await Promise.all([
    repositories.profile.getProfile(),
    repositories.games.getAllGames(),
    repositories.achievements.getAchievements()
  ]);
  return {
    profile: profile ?? localProfile,
    games,
    recentAchievements: recentAchievements.filter((item) => item.unlockedAt).slice(0, 3),
    weeklyActivity: [],
    weeklyGoalHours: 0
  };
}

export async function getAchievementJourneySource(): Promise<AchievementJourneySource> {
  const [profile, games, achievements, activity] = await Promise.all([
    repositories.profile.getProfile(),
    repositories.games.getAllGames(),
    repositories.achievements.getAchievements(),
    repositories.activities.getActivities()
  ]);
  return {
    profile: profile ?? localProfile,
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

const localProfile = {
  id: "local-player",
  displayName: "Player",
  avatarUrl: "",
  level: 0
};
