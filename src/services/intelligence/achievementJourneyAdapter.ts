import type { Achievement, Game, PlayerActivity, UserProfile } from "../../types";
import type {
  AchievementJourneyInput,
  GameIntelligenceInput,
  IntelligenceGameStatus
} from "../../intelligence/index.ts";
import type { GameCardData } from "../../types/gameCard";

export type AchievementJourneySource = {
  profile: UserProfile;
  games: Game[];
  achievements: Achievement[];
  activity: PlayerActivity[];
  analyzedAt: string;
  capabilities: {
    weeklyPlaytime: boolean;
    achievementProgress: boolean;
  };
};

export type LibrarySnapshot = {
  totalGames: number;
  completedGames: number;
  averageCompletion: number;
  totalPlaytimeMinutes: number;
  unstartedGames: number;
};

export function toAchievementJourneyInput(
  source: AchievementJourneySource
): AchievementJourneyInput {
  const achievementsByGame = new Map<string, Achievement[]>();
  for (const achievement of source.achievements) {
    const items = achievementsByGame.get(achievement.gameId) ?? [];
    items.push(achievement);
    achievementsByGame.set(achievement.gameId, items);
  }
  return {
    now: source.analyzedAt,
    games: source.games.map((game) => toGameInput(game, achievementsByGame.get(game.id) ?? [], source.analyzedAt)),
    achievements: source.achievements.filter((achievement) => achievement.unlockStateKnown !== false).map((achievement) => ({
      achievementId: achievement.id,
      gameId: achievement.gameId,
      title: achievement.title,
      unlocked: achievement.unlocked ?? Boolean(achievement.unlockedAt),
      unlockDate: achievement.unlockedAt,
      globalUnlockPercent: achievement.globalUnlockPercent ?? (achievement.source === "steam" ? null : achievement.rarityPercentage),
      progressCurrent: null,
      progressTarget: null,
      hidden: achievement.isHidden
    })),
    activity: source.activity.map((item) => ({
      date: item.occurredAt,
      playtimeMinutes: null,
      achievementsUnlocked: item.type === "achievement" ? 1 : 0,
      gamesPlayed: item.gameId ? [item.gameId] : []
    }))
  };
}

export function toJourneyGameCard(game: Game): GameCardData {
  return {
    id: game.id,
    platformGameId: game.appId,
    title: game.name,
    coverUrl: game.coverUrl,
    backgroundUrl: game.backgroundUrl,
    platform: game.platform,
    playtimeMinutes: Math.round(Math.max(0, game.playtimeHours) * 60),
    unlockedAchievements: game.unlockedAchievements,
    totalAchievements: game.totalAchievements,
    completionPercent: game.completionPercentage,
    lastPlayedAt: game.lastPlayedAt,
    favorite: game.favorite ?? false,
    hidden: game.hidden ?? false,
    status: game.status ?? inferStatus(game)
  };
}

export function createLibrarySnapshot(games: Game[]): LibrarySnapshot {
  if (games.length === 0) {
    return {
      totalGames: 0,
      completedGames: 0,
      averageCompletion: 0,
      totalPlaytimeMinutes: 0,
      unstartedGames: 0
    };
  }
  return {
    totalGames: games.length,
    completedGames: games.filter((game) => game.completionPercentage >= 100).length,
    averageCompletion: games.reduce((sum, game) => sum + game.completionPercentage, 0) / games.length,
    totalPlaytimeMinutes: games.reduce(
      (sum, game) => sum + Math.round(Math.max(0, game.playtimeHours) * 60),
      0
    ),
    unstartedGames: games.filter((game) => game.playtimeHours <= 0).length
  };
}

function toGameInput(
  game: Game,
  achievements: Achievement[],
  now: string
): GameIntelligenceInput {
  const rare = achievements.filter((achievement) => {
    const rarity = achievement.globalUnlockPercent ?? (achievement.source === "steam" ? undefined : achievement.rarityPercentage);
    return typeof rarity === "number" && rarity < 10;
  });
  const recentlyUnlocked = achievements.filter((achievement) => {
    if (!achievement.unlockedAt) return false;
    const unlockedAt = new Date(achievement.unlockedAt).getTime();
    const reference = new Date(now).getTime();
    return Number.isFinite(unlockedAt) && Number.isFinite(reference) &&
      reference >= unlockedAt && reference - unlockedAt <= 14 * 86_400_000;
  });
  return {
    gameId: game.id,
    title: game.name,
    platform: game.platform,
    playtimeMinutes: Math.round(Math.max(0, game.playtimeHours) * 60),
    unlockedAchievements: game.unlockedAchievements,
    totalAchievements: game.totalAchievements,
    completionPercent: game.completionPercentage,
    lastPlayedAt: game.lastPlayedAt,
    favorite: game.favorite ?? false,
    hidden: game.hidden ?? false,
    status: game.status ?? inferStatus(game),
    rareAchievementsUnlocked: rare.filter((achievement) => achievement.unlocked ?? Boolean(achievement.unlockedAt)).length,
    rareAchievementsAvailable: rare.length,
    recentlyUnlockedAchievements: recentlyUnlocked.length
  };
}

function inferStatus(game: Game): IntelligenceGameStatus {
  if (game.completionPercentage >= 100) return "completed";
  if (game.playtimeHours > 0) return "playing";
  return "notStarted";
}
