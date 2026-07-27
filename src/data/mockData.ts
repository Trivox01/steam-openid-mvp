import type { Achievement, DashboardData, Game, PlayerActivity } from "../types";

export const mockGames: Game[] = [
  {
    id: "game-1", appId: "mock-1086940", platform: "steam", name: "Aetherfall",
    coverUrl: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=700&q=85",
    heroUrl: "https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=1400&q=85",
    playtimeHours: 86.4, totalAchievements: 48, unlockedAchievements: 41,
    completionPercentage: 85, lastPlayedAt: "2026-07-27T18:30:00Z"
  },
  {
    id: "game-2", appId: "mock-2921140", platform: "steam", name: "Neon Circuit",
    coverUrl: "https://images.unsplash.com/photo-1531058020387-3be344556be6?auto=format&fit=crop&w=700&q=85",
    heroUrl: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=1400&q=85",
    playtimeHours: 42.8, totalAchievements: 36, unlockedAchievements: 34,
    completionPercentage: 94, lastPlayedAt: "2026-07-24T21:12:00Z"
  },
  {
    id: "game-3", appId: "mock-7734210", platform: "steam", name: "Emberwild",
    coverUrl: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=700&q=85",
    heroUrl: "https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&w=1400&q=85",
    playtimeHours: 118.2, totalAchievements: 62, unlockedAchievements: 47,
    completionPercentage: 76, lastPlayedAt: "2026-07-20T16:45:00Z"
  },
  {
    id: "game-4", appId: "mock-4458900", platform: "steam", name: "Silent Meridian",
    coverUrl: mockGamesImage(0), heroUrl: mockGamesImage(1),
    playtimeHours: 63.5, totalAchievements: 28, unlockedAchievements: 28,
    completionPercentage: 100, lastPlayedAt: "2026-07-18T20:10:00Z"
  },
  {
    id: "game-5", appId: "mock-9902210", platform: "steam", name: "Starbound Echoes",
    coverUrl: mockGamesImage(1), heroUrl: mockGamesImage(2),
    playtimeHours: 0, totalAchievements: 40, unlockedAchievements: 0,
    completionPercentage: 0, lastPlayedAt: "2026-07-10T12:00:00Z"
  },
  {
    id: "game-6", appId: "mock-3177420", platform: "steam", name: "Iron Hollow",
    coverUrl: mockGamesImage(2), heroUrl: mockGamesImage(0),
    playtimeHours: 31.2, totalAchievements: 45, unlockedAchievements: 18,
    completionPercentage: 40, lastPlayedAt: "2026-07-15T19:25:00Z"
  }
];

function mockGamesImage(index: number) {
  const images = [
    "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=700&q=85",
    "https://images.unsplash.com/photo-1531058020387-3be344556be6?auto=format&fit=crop&w=700&q=85",
    "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=700&q=85"
  ];
  return images[index];
}

export const mockAchievements: Achievement[] = [
  { id: "ach-1", gameId: "game-1", title: "Beyond the Veil", description: "Discover the forgotten sanctuary.", iconUrl: mockGames[0].coverUrl, unlockedAt: "12 min ago", rarityPercentage: 3.8, points: 50 },
  { id: "ach-2", gameId: "game-2", title: "Perfect Frequency", description: "Complete a flawless circuit.", iconUrl: mockGames[1].coverUrl, unlockedAt: "Yesterday", rarityPercentage: 8.2, points: 35 },
  { id: "ach-3", gameId: "game-3", title: "Keeper of Embers", description: "Restore the ancient flame.", iconUrl: mockGames[2].coverUrl, unlockedAt: "2026-07-24T16:20:00Z", rarityPercentage: 12.6, points: 25 },
  { id: "ach-4", gameId: "game-4", title: "No Stone Unturned", description: "Find every lost signal.", iconUrl: mockGames[3].coverUrl, unlockedAt: "2026-07-22T18:10:00Z", rarityPercentage: 2.4, points: 80 },
  { id: "ach-5", gameId: "game-1", title: "Skybreaker", description: "Defeat the guardian above the clouds.", iconUrl: mockGames[0].coverUrl, rarityPercentage: 18.7, points: 30 },
  { id: "ach-6", gameId: "game-2", title: "Ghost in the Grid", description: "Complete the hidden network challenge.", iconUrl: mockGames[1].coverUrl, rarityPercentage: 4.1, points: 60, isHidden: true },
  { id: "ach-7", gameId: "game-3", title: "Trailblazer", description: "Map every region of Emberwild.", iconUrl: mockGames[2].coverUrl, rarityPercentage: 24.3, points: 20 },
  { id: "ach-8", gameId: "game-4", title: "Perfect Silence", description: "Finish the campaign without detection.", iconUrl: mockGames[3].coverUrl, unlockedAt: "2026-07-20T11:45:00Z", rarityPercentage: 1.2, points: 100 },
  { id: "ach-9", gameId: "game-5", title: "First Contact", description: "Launch your first expedition.", iconUrl: mockGames[4].coverUrl, rarityPercentage: 72.8, points: 10 },
  { id: "ach-10", gameId: "game-6", title: "The Sealed Door", description: "Uncover what lies beneath Iron Hollow.", iconUrl: mockGames[5].coverUrl, rarityPercentage: 6.9, points: 50, isHidden: true }
];

export const mockActivities: PlayerActivity[] = [
  { id: "act-1", type: "achievement", title: "Unlocked “Beyond the Veil”", description: "A rare achievement added to your collection.", gameId: "game-1", occurredAt: "2026-07-27T18:42:00Z", metadata: "3.8% rarity" },
  { id: "act-2", type: "progress", title: "Reached 85% completion", description: "Only seven achievements remain.", gameId: "game-1", occurredAt: "2026-07-27T18:30:00Z", metadata: "+4%" },
  { id: "act-3", type: "weekly_goal", title: "Weekly goal achieved", description: "You completed 25 hours of play this week.", occurredAt: "2026-07-26T21:15:00Z", metadata: "25 hours" },
  { id: "act-4", type: "achievement", title: "Unlocked “Perfect Frequency”", description: "Completed a flawless circuit.", gameId: "game-2", occurredAt: "2026-07-26T19:05:00Z", metadata: "8.2% rarity" },
  { id: "act-5", type: "completed_game", title: "Completed Silent Meridian", description: "Every achievement has been unlocked.", gameId: "game-4", occurredAt: "2026-07-24T20:10:00Z", metadata: "100%" },
  { id: "act-6", type: "new_game", title: "Added Starbound Echoes", description: "A new adventure joined your library.", gameId: "game-5", occurredAt: "2026-07-23T12:00:00Z" },
  { id: "act-7", type: "progress", title: "Reached 40% completion", description: "Steady progress through Iron Hollow.", gameId: "game-6", occurredAt: "2026-07-22T19:25:00Z", metadata: "+10%" }
];

export const mockDashboardData: DashboardData = {
  profile: {
    id: "user-1", displayName: "Alex Morgan", level: 42,
    avatarUrl: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=160&q=85"
  },
  games: mockGames,
  recentAchievements: mockAchievements,
  weeklyActivity: [
    { day: "Mon", hours: 1.8 }, { day: "Tue", hours: 3.2 }, { day: "Wed", hours: 2.4 },
    { day: "Thu", hours: 4.6 }, { day: "Fri", hours: 3.4 }, { day: "Sat", hours: 5.7 }, { day: "Sun", hours: 2.8 }
  ],
  weeklyGoalHours: 25
};
