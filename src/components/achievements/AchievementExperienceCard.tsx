import { memo } from "react";
import { EyeOff, Gem, HelpCircle, LockKeyhole, Trophy } from "lucide-react";
import type { Achievement } from "../../types";
import type { AchievementDensity, AchievementView } from "../../services/gameDetailsExperience";
import { isRareAchievement } from "../../services/gameDetailsExperience";
import { isAchievementUnlocked, knownAchievementRarity } from "../../services/achievementData";
import { useTranslation } from "../../i18n/TranslationContext";
import { GameArtwork } from "../ui/GameArtwork";
import { StatusBadge } from "../ui/StatusBadge";

type Props = {
  achievement: Achievement;
  view: AchievementView;
  density: AchievementDensity;
  onOpen: (achievement: Achievement) => void;
};

export const AchievementExperienceCard = memo(function AchievementExperienceCard({
  achievement,
  view,
  density,
  onOpen
}: Props) {
  const { language, t } = useTranslation();
  const known = achievement.unlockStateKnown !== false;
  const unlocked = known && isAchievementUnlocked(achievement);
  const rare = isRareAchievement(achievement);
  const rarity = knownAchievementRarity(achievement);
  const title = achievement.title.trim() ||
    (achievement.isHidden ? t("gameDetails.hiddenAchievement") : t("gameDetails.unnamedAchievement"));
  const description = achievement.description.trim() ||
    (achievement.isHidden ? t("gameDetails.hiddenDescription") : t("gameDetails.noDescription"));
  const image = unlocked ? achievement.iconUrl : achievement.lockedIconUrl || achievement.iconUrl;
  const stateLabel = !known
    ? t("gameDetails.unknown")
    : unlocked
      ? t("gameDetails.unlocked")
      : t("gameDetails.locked");

  return (
    <button
      type="button"
      className={[
        "achievement-x-card",
        `achievement-x-card--${view}`,
        `achievement-x-card--${density}`,
        unlocked && "is-unlocked",
        !known && "is-unknown",
        rare && "is-rare"
      ].filter(Boolean).join(" ")}
      onClick={() => onOpen(achievement)}
      aria-label={`${t("gameDetails.achievementDetails")}: ${title}. ${stateLabel}`}
    >
      <GameArtwork src={image} alt="" variant="cover" className="achievement-x-card__art" />
      <span className="achievement-x-card__state-icon" aria-hidden="true">
        {!known ? <HelpCircle /> : unlocked ? <Trophy /> : <LockKeyhole />}
      </span>
      <span className="achievement-x-card__body">
        <span className="achievement-x-card__badges">
          <StatusBadge tone={!known ? "neutral" : unlocked ? "success" : "neutral"}>{stateLabel}</StatusBadge>
          {rare && <StatusBadge tone="accent"><Gem />{t("gameDetails.rare")}</StatusBadge>}
          {achievement.isHidden && <StatusBadge tone="warning"><EyeOff />{t("gameDetails.hidden")}</StatusBadge>}
        </span>
        <strong dir="auto">{title}</strong>
        <span className="achievement-x-card__description" dir="auto">{description}</span>
        <span className="achievement-x-card__meta">
          <span>{typeof rarity === "number"
            ? t("gameDetails.globalPercent", { percent: new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(rarity) })
            : t("gameDetails.rarityUnknown")}</span>
          {unlocked && achievement.unlockedAt && Number.isFinite(new Date(achievement.unlockedAt).getTime()) && (
            <time dateTime={achievement.unlockedAt}>
              {new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(achievement.unlockedAt))}
            </time>
          )}
        </span>
      </span>
    </button>
  );
});
