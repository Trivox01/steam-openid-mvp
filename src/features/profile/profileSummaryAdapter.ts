import type { Achievement, Game, UserProfile } from "../../types";
import type { SteamOpenIdIdentity } from "../../types/steamOpenId";
import { isAchievementUnlocked, knownAchievementRarity } from "../../services/achievementData";
import { resolveProfileBadges } from "./badges/resolveProfileBadges";
import type { UserProfileSummary } from "./types";

type Translate = (key: string) => string;

export function createCurrentUserProfileSummary(input: {
  profile?: UserProfile;
  identity: SteamOpenIdIdentity;
  games: readonly Game[];
  achievements: readonly Achievement[];
  translate: Translate;
}): UserProfileSummary {
  const unlocked = input.achievements.filter(isAchievementUnlocked);
  const rareUnlocked = unlocked.filter((achievement) => (knownAchievementRarity(achievement) ?? 101) < 10).length;
  const perfectGames = input.games.filter((game) => game.completionPercentage >= 100).length;
  const completionRate = input.games.length
    ? input.games.reduce((sum, game) => sum + game.completionPercentage, 0) / input.games.length
    : 0;
  const displayName = input.profile?.id !== "local-player" && input.profile?.displayName.trim()
    ? input.profile.displayName.trim()
    : input.translate("profile.fallbackName");

  return {
    id: input.profile?.id || input.identity.steamId,
    steamId64: input.identity.steamId,
    displayName,
    avatarUrl: input.profile?.avatarUrl || undefined,
    isCurrentUser: true,
    isSteamVerified: true,
    authenticatedAt: input.identity.authenticatedAt,
    stats: {
      gamesOwned: input.games.length,
      achievementsUnlocked: unlocked.length,
      perfectGames,
      completionRate
    },
    badges: resolveProfileBadges({
      steamVerified: true,
      perfectGames,
      rareAchievementsUnlocked: rareUnlocked,
      // Role and event badges require trusted evidence that the Desktop does not own.
      trustedRoleIds: [],
      trustedEventIds: []
    }, input.translate)
  };
}
