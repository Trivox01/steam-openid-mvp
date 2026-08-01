import { EyeOff, Gem, LockKeyhole, Trophy } from "lucide-react";
import type { Achievement, Game } from "../../types";
import { isAchievementUnlocked } from "../../services/achievementData";
import { AchievementIcon } from "../ui/AchievementIcon";
import { useTranslation } from "../../i18n/TranslationContext";

export function AchievementListCard({ achievement, game, onOpen }: { achievement: Achievement; game?: Game; onOpen: (achievement: Achievement) => void }) {
  const { language, t } = useTranslation();
  const unlocked = isAchievementUnlocked(achievement);
  const rarity = achievement.globalUnlockPercent ?? (achievement.source === "steam" ? undefined : achievement.rarityPercentage);
  const rare = typeof rarity === "number" && rarity < 10;
  const hiddenLocked = achievement.isHidden && !unlocked;
  return (
    <button className={`full-achievement-card ${unlocked ? "unlocked" : "locked"} ${rare ? "rare" : ""}`} onClick={() => onOpen(achievement)}>
      <div className="full-achievement-icon"><AchievementIcon src={unlocked ? achievement.iconUrl : achievement.lockedIconUrl || achievement.iconUrl} alt={t("achievements.iconAlt", { title: achievement.title })} />{unlocked ? <Trophy size={15} /> : <LockKeyhole size={15} />}</div>
      <div className="full-achievement-copy">
        <div className="achievement-labels"><span>{game?.name}</span>{rare && <b><Gem size={11} /> {t("gameDetails.rare")}</b>}{achievement.isHidden && <b><EyeOff size={11} /> {t("gameDetails.hidden")}</b>}</div>
        <h2>{hiddenLocked ? t("gameDetails.hiddenAchievement") : achievement.title}</h2>
        <p>{hiddenLocked ? t("achievements.hiddenDescription") : achievement.description}</p>
        <footer><span>{achievement.unlockStateKnown === false ? t("achievements.statusUnavailable") : unlocked ? achievement.unlockedAt ? t("achievements.unlockedOn", { date: formatDate(achievement.unlockedAt, language) }) : t("gameDetails.unlocked") : t("gameDetails.locked")}</span><strong>{typeof rarity === "number" ? t("achievements.players", { percent: rarity }) : t("achievements.rarityUnavailable")}</strong></footer>
      </div>
    </button>
  );
}
function formatDate(value: string, language: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(language, { month: "short", day: "numeric" }); }
