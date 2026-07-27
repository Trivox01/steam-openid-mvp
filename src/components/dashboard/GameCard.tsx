import { Clock3 } from "lucide-react";
import type { Game } from "../../types";
import { GameArtwork } from "../ui/GameArtwork";
import { ProgressRing } from "../ui/ProgressRing";

export function GameCard({ game, onOpen }: { game: Game; onOpen?: (game: Game) => void }) {
  return (
    <button className="game-card" onClick={() => onOpen?.(game)}>
      <GameArtwork src={game.coverUrl} alt={`${game.name} cover`} variant="cover" className="game-card-artwork" />
      <div className="game-card-copy">
        <h3>{game.name}</h3>
        <p><Clock3 size={13} /> {game.playtimeHours} hours played</p>
        <span>{game.unlockedAchievements} of {game.totalAchievements} achievements</span>
      </div>
      <ProgressRing value={game.completionPercentage} size={58} strokeWidth={5} />
    </button>
  );
}
