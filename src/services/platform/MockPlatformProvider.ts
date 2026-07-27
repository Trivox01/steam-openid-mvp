import { mockAchievements, mockDashboardData, mockGames } from "../../data/mockData";
import type { Achievement, Game, UserProfile } from "../../types";
import type { PlatformProvider } from "./PlatformProvider";

const simulateNetwork = <T>(data: T, delay = 450) =>
  new Promise<T>((resolve) => window.setTimeout(() => resolve(data), delay));

export class MockPlatformProvider implements PlatformProvider {
  async authenticate(): Promise<void> { await simulateNetwork(undefined, 180); }
  async getUserProfile(): Promise<UserProfile> { return simulateNetwork(mockDashboardData.profile); }
  async getOwnedGames(): Promise<Game[]> { return simulateNetwork(mockGames); }
  async getGameAchievements(appId: string): Promise<Achievement[]> {
    const game = mockGames.find((item) => item.appId === appId);
    return simulateNetwork(game ? mockAchievements.filter((item) => item.gameId === game.id) : []);
  }
  async syncData(): Promise<void> { await simulateNetwork(undefined, 600); }
}

export const platformProvider: PlatformProvider = new MockPlatformProvider();
