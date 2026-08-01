import { EyeOff, Gem, LockKeyhole, Trophy } from "lucide-react";
import type { Achievement, Game } from "../../types";
import { isAchievementUnlocked } from "../../services/achievementData";
import { AchievementIcon } from "../ui/AchievementIcon";

export function AchievementListCard({ achievement, game, onOpen }: { achievement: Achievement; game?: Game; onOpen: (achievement: Achievement) => void }) {
  const unlocked = isAchievementUnlocked(achievement);
  const rarity = achievement.globalUnlockPercent ?? (achievement.source === "steam" ? undefined : achievement.rarityPercentage);
  const rare = typeof rarity === "number" && rarity < 10;
  const hiddenLocked = achievement.isHidden && !unlocked;
  return (
    <button className={`full-achievement-card ${unlocked ? "unlocked" : "locked"} ${rare ? "rare" : ""}`} onClick={() => onOpen(achievement)}>
      <div className="full-achievement-icon"><AchievementIcon src={unlocked ? achievement.iconUrl : achievement.lockedIconUrl || achievement.iconUrl} alt={`${achievement.title} achievement icon`} />{unlocked ? <Trophy size={15} /> : <LockKeyhole size={15} />}</div>
      <div className="full-achievement-copy">
        <div className="achievement-labels"><span>{game?.name}</span>{rare && <b><Gem size={11} /> Rare</b>}{achievement.isHidden && <b><EyeOff size={11} /> Hidden</b>}</div>
        <h2>{hiddenLocked ? "Hidden achievement" : achievement.title}</h2>
        <p>{hiddenLocked ? "This achievement remains hidden until it is unlocked." : achievement.description}</p>
        <footer><span>{achievement.unlockStateKnown === false ? "Status unavailable" : unlocked ? achievement.unlockedAt ? `Unlocked ${formatDate(achievement.unlockedAt)}` : "Unlocked" : "Locked"}</span><strong>{typeof rarity === "number" ? `${rarity}% of players` : "Global rarity unavailable"}</strong></footer>
      </div>
    </button>
  );
}
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en", { month: "short", day: "numeric" }); }
