import { mockDashboardData } from "../data/mockData";
import type { DashboardData } from "../types";
import { platformProvider } from "./platform/MockPlatformProvider";

export async function getDashboardData(): Promise<DashboardData> {
  const [profile, games] = await Promise.all([
    platformProvider.getUserProfile(),
    platformProvider.getOwnedGames()
  ]);
  return { ...mockDashboardData, profile, games };
}
