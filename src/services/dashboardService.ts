import { mockDashboardData } from "../data/mockData";
import type { DashboardData } from "../types";
import { repositories } from "./compositionRoot";

export async function getDashboardData(): Promise<DashboardData> {
  const [profile, games, recentAchievements] = await Promise.all([
    repositories.profile.getProfile(),
    repositories.games.getAllGames(),
    repositories.achievements.getAchievements()
  ]);
  return { ...mockDashboardData, profile: profile ?? mockDashboardData.profile, games, recentAchievements: recentAchievements.filter((item)=>item.unlockedAt).slice(0,3) };
}
