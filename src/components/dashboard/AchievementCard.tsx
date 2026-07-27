import { Gem } from "lucide-react";
import type { Achievement, Game } from "../../types";

export function AchievementCard({ achievement, game }: { achievement: Achievement; game?: Game }) {
  return (
    <article className="achievement-card">
      <div className="achievement-icon-wrap">
        <img src={achievement.iconUrl} alt="" />
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
    </article>
  );
}
