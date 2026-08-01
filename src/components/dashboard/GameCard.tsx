import { Clock3 } from "lucide-react";
import type { Game } from "../../types";
import { GameArtwork } from "../ui/GameArtwork";
import { steamArtworkSources } from "../../services/platform/steamArtwork";
import { ProgressRing } from "../ui/ProgressRing";

export function GameCard({ game, onOpen }: { game: Game; onOpen?: (game: Game) => void }) {
  return (
    <button className="game-card" onClick={() => onOpen?.(game)}>
      <GameArtwork src={game.coverUrl} sources={game.platform === "steam" ? steamArtworkSources({ appId: game.appId, kind: "cover", storedUrl: game.coverUrl, iconUrl: game.iconUrl }) : undefined} alt={`${game.name} cover`} variant="cover" className="game-card-artwork" appId={game.platform === "steam" ? game.appId : undefined} componentName="DashboardGameCard" />
      <div className="game-card-copy">
        <h3>{game.name}</h3>
        <p><Clock3 size={13} /> {game.playtimeHours} hours played</p>
        <span>{game.unlockedAchievements} of {game.totalAchievements} achievements</span>
      </div>
      <ProgressRing value={game.completionPercentage} size={58} strokeWidth={5} />
    </button>
  );
}
