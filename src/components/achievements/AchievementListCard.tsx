import { EyeOff, Gem, LockKeyhole, Trophy } from "lucide-react";
import type { Achievement, Game } from "../../types";

export function AchievementListCard({ achievement, game, onOpen }: { achievement: Achievement; game?: Game; onOpen: (achievement: Achievement) => void }) {
  const unlocked = Boolean(achievement.unlockedAt);
  const rare = achievement.rarityPercentage < 10;
  const hiddenLocked = achievement.isHidden && !unlocked;
  return (
    <button className={`full-achievement-card ${unlocked ? "unlocked" : "locked"} ${rare ? "rare" : ""}`} onClick={() => onOpen(achievement)}>
      <div className="full-achievement-icon"><img src={achievement.iconUrl} alt="" />{unlocked ? <Trophy size={15} /> : <LockKeyhole size={15} />}</div>
      <div className="full-achievement-copy">
        <div className="achievement-labels"><span>{game?.name}</span>{rare && <b><Gem size={11} /> Rare</b>}{achievement.isHidden && <b><EyeOff size={11} /> Hidden</b>}</div>
        <h2>{hiddenLocked ? "Hidden achievement" : achievement.title}</h2>
        <p>{hiddenLocked ? "This achievement remains hidden until it is unlocked." : achievement.description}</p>
        <footer><span>{unlocked ? `Unlocked ${formatDate(achievement.unlockedAt!)}` : "Locked"}</span><strong>{achievement.rarityPercentage}% of players</strong></footer>
      </div>
    </button>
  );
}
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en", { month: "short", day: "numeric" }); }
