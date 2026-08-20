import { memo } from "react";
import { ChevronRight, HelpCircle, LockKeyhole, Trophy } from "lucide-react";
import { AchievementIcon } from "../ui/AchievementIcon";
import { useTranslation } from "../../i18n/TranslationContext";
import { isAchievementUnlocked, knownAchievementRarity } from "../../services/achievementData";
import type { Achievement } from "../../types";

/**
 * One achievement as a single desktop list row.
 *
 * Four rules keep this row honest and must survive future edits:
 * - Real button semantics. Tab reaches it, Enter and Space activate it, and the
 *   focus ring is visible. No roving tabindex, no synthetic key handling.
 * - State is never signalled by colour alone. Every row carries a state icon and
 *   the state as text inside its accessible label.
 * - Rarity is rendered only when a real global percentage exists.
 *   `knownAchievementRarity` is the source of truth, never `rarityPercentage`,
 *   because that field can be a stale or zero fallback for Steam. Missing rarity
 *   is missing data, not 0%.
 * - The column structure is fixed, so list virtualization stays possible later.
 */
export const AchievementRow = memo(function AchievementRow({
  achievement,
  onOpen
}: {
  achievement: Achievement;
  onOpen: (achievement: Achievement) => void;
}) {
  const { language, t } = useTranslation();
  const known = achievement.unlockStateKnown !== false;
  const unlocked = known && isAchievementUnlocked(achievement);
  const state = known ? (unlocked ? "unlocked" : "locked") : "unknown";
  const title = achievement.title ||
    t(achievement.isHidden ? "gameDetails.hiddenAchievement" : "gameDetails.unnamedAchievement");
  const rarity = knownAchievementRarity(achievement);
  const rarityText = typeof rarity === "number"
    ? new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 1 }).format(rarity / 100)
    : "";
  const unlockedAt = unlocked && achievement.unlockedAt && Number.isFinite(new Date(achievement.unlockedAt).getTime())
    ? new Date(achievement.unlockedAt)
    : undefined;
  const image = unlocked ? achievement.iconUrl : achievement.lockedIconUrl || achievement.iconUrl;

  return (
    <button
      type="button"
      className={`gd-achievement-row gd-achievement-row--${state}`}
      onClick={() => onOpen(achievement)}
      aria-label={`${title} \u2014 ${t(`gameDetails.${state}`)}`}
      title={t("gameDetails.achievementDetails")}
    >
      <AchievementIcon src={image} alt="" size={32} className="gd-achievement-row__icon" />
      <span className="gd-achievement-row__state" aria-hidden="true">
        {state === "unlocked" ? <Trophy size={16} /> : state === "locked" ? <LockKeyhole size={16} /> : <HelpCircle size={16} />}
      </span>
      <span className="gd-achievement-row__text">
        <span className="gd-achievement-row__title" dir="auto">{title}</span>
        {achievement.isHidden && <span className="sr-only">{t("gameDetails.hidden")}</span>}
        {achievement.description && (
          <span className="gd-achievement-row__description" dir="auto">{achievement.description}</span>
        )}
      </span>
      <span className="gd-achievement-row__rarity">
        {rarityText && (
          <span dir="ltr" title={t("gameDetails.rarityTooltip", { percent: rarityText })}>{rarityText}</span>
        )}
      </span>
      <span className="gd-achievement-row__date">
        {unlockedAt && (
          <time dateTime={unlockedAt.toISOString()}>
            {new Intl.DateTimeFormat(language, { dateStyle: "short" }).format(unlockedAt)}
          </time>
        )}
      </span>
      <ChevronRight className="gd-achievement-row__chevron" size={16} aria-hidden="true" />
    </button>
  );
});
