import type { Achievement, SteamGameAchievementsDto } from "../../types";

export function mergeSteamAchievements(
  gameId: string,
  existing: Achievement[],
  remote: SteamGameAchievementsDto
) {
  const byExternalId = new Map<string, Achievement>();
  for (const item of existing) {
    const externalId = item.externalId ?? item.id;
    const current = byExternalId.get(externalId);
    if (!current || item.source === "steam") byExternalId.set(externalId, item);
  }
  const playerPartial = remote.warnings.includes("player_stats_unavailable");
  const globalPartial = remote.warnings.includes("global_percentages_unavailable");
  const seen = new Set<string>();
  const changed: Achievement[] = [];
  const complete: Achievement[] = [];
  let inserted = 0, updated = 0, unchanged = 0, skipped = 0;

  for (const dto of remote.achievements) {
    const externalId = dto.apiName.trim();
    if (!externalId || seen.has(externalId)) { skipped += 1; continue; }
    seen.add(externalId);
    const current = byExternalId.get(externalId);
    const next: Achievement = {
      ...current,
      id: current?.id ?? `steam:${gameId}:${encodeURIComponent(externalId)}`,
      gameId,
      externalId,
      source: "steam",
      title: dto.displayName || externalId,
      description: dto.description,
      iconUrl: dto.iconUrl,
      lockedIconUrl: dto.lockedIconUrl,
      isHidden: dto.hidden,
      points: current?.points ?? 0,
      unlocked: playerPartial ? current?.unlocked ?? Boolean(current?.unlockedAt) : dto.unlocked,
      unlockedAt: playerPartial ? current?.unlockedAt : dto.unlocked ? dto.unlockedAt : undefined,
      globalUnlockPercent: globalPartial
        ? current?.globalUnlockPercent
        : sanitizePercent(dto.globalUnlockPercent),
      rarityPercentage: globalPartial
        ? current?.rarityPercentage ?? 0
        : sanitizePercent(dto.globalUnlockPercent) ?? 0,
      syncedAt: remote.fetchedAt,
      unlockStateKnown: playerPartial ? current?.unlockStateKnown ?? false : true
    };
    complete.push(next);
    if (!current) { inserted += 1; changed.push(next); }
    else if (steamFieldsEqual(current, next)) unchanged += 1;
    else { updated += 1; changed.push(next); }
  }
  return { changed, complete, inserted, updated, unchanged, skipped };
}

function sanitizePercent(value?: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : undefined;
}

function steamFieldsEqual(a: Achievement, b: Achievement) {
  return a.externalId === b.externalId && a.source === b.source && a.title === b.title &&
    a.description === b.description && a.iconUrl === b.iconUrl &&
    a.lockedIconUrl === b.lockedIconUrl && a.isHidden === b.isHidden &&
    a.unlocked === b.unlocked && a.unlockedAt === b.unlockedAt && a.globalUnlockPercent === b.globalUnlockPercent &&
    a.unlockStateKnown === b.unlockStateKnown;
}
