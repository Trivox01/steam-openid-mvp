import { Gem } from "lucide-react";
import type { Achievement, Game } from "../../types";
import { AchievementIcon } from "../ui/AchievementIcon";

export function AchievementCard({ achievement, game, onOpen }: { achievement: Achievement; game?: Game; onOpen?: (achievement: Achievement) => void }) {
  return (
    <button className="achievement-card" onClick={() => onOpen?.(achievement)}>
      <div className="achievement-icon-wrap">
        <AchievementIcon src={achievement.iconUrl} alt={`${achievement.title} achievement icon`} size="compact" />
        <span><Gem size={12} /></span>
      </div>
      <div className="achievement-copy">
        <h3>{achievement.title}</h3>
        <p>{game?.name} · {achievement.unlockedAt}</p>
      </div>
      <div className="rarity">
        <strong>{achievement.rarityPercentage}%</strong>
        <span>Rarity</span>
      </div>
    </button>
  );
}
