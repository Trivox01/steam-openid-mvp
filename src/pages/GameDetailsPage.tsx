import { useMemo, useState } from "react";
import { ArrowLeft, Clock3, Gem, LockKeyhole, Medal, Sparkles } from "lucide-react";
import { AchievementListCard } from "../components/achievements/AchievementListCard";
import { EmptyView, ErrorView, LoadingView } from "../components/ui/StateViews";
import { FilterToolbar, SegmentedFilter, SelectControl } from "../components/ui/FilterBar";
import { GameArtwork } from "../components/ui/GameArtwork";
import { ProgressRing } from "../components/ui/ProgressRing";
import { useAsyncData } from "../hooks/useAsyncData";
import { services } from "../services/compositionRoot";
import type { Achievement, AchievementId, GameId } from "../types";

type Filter = "all" | "unlocked" | "locked" | "rare"; type Sort = "status" | "rarity" | "name";
export function GameDetailsPage({ gameId, onBack, onOpenAchievement }: { gameId: GameId; onBack: () => void; onOpenAchievement: (id: AchievementId) => void }) {
  const gameState = useAsyncData(() => services.games.details(gameId), [gameId]);
  const achievementsState = useAsyncData(() => services.achievements.byGame(gameId), [gameId]);
  const [filter, setFilter] = useState<Filter>("all"); const [sort, setSort] = useState<Sort>("status");
  const achievements = useMemo(() => achievementsState.status === "success" ? achievementsState.data.filter((item) => filter === "all" || (filter === "unlocked" ? item.unlockedAt : filter === "locked" ? !item.unlockedAt : item.rarityPercentage < 10)).sort((a, b) => sort === "rarity" ? a.rarityPercentage - b.rarityPercentage : sort === "name" ? a.title.localeCompare(b.title) : Number(Boolean(b.unlockedAt)) - Number(Boolean(a.unlockedAt))) : [], [achievementsState, filter, sort]);
  if (gameState.status === "loading") return <LoadingView size="md" label="Loading game details" delay={120} />;
  if (gameState.status === "error") return <ErrorView message={gameState.error} onRetry={() => location.reload()} />;
  if (gameState.status === "empty" || !gameState.data) return <EmptyView title="Game not found" description="This game is no longer available in the mock library." />;
  const game = gameState.data;
  return <section className="content-page game-details-page">
    <button className="back-button" onClick={onBack}><ArrowLeft size={16} /> Back</button>
    <article className="game-details-hero panel">
      <GameArtwork src={game.backgroundUrl} alt="" variant="background" className="game-details-background" eager />
      <div className="game-details-overlay" />
      <div className="game-details-content">
        <GameArtwork src={game.coverUrl} alt={`${game.name} cover`} variant="cover" className="game-details-cover" eager />
        <div className="game-details-copy">
          <span className="platform-badge">STEAM</span>
          <h1>{game.name}</h1>
          <p><Clock3 size={14} /> {game.playtimeHours} hours · Last played {new Date(game.lastPlayedAt).toLocaleDateString()}</p>
          <div className="game-detail-progress">
            <i><b style={{ width: `${game.completionPercentage}%` }} /></i>
            <span>{game.unlockedAchievements} of {game.totalAchievements} achievements</span>
          </div>
        </div>
        <div className="game-details-progress-ring">
          <ProgressRing value={game.completionPercentage} size={88} strokeWidth={7} label={`${game.name} completion: ${game.completionPercentage}%`} />
        </div>
      </div>
    </article>
    <div className="game-detail-stats"><DetailStat icon={Gem} label="Rare achievements" value={`${game.rareAchievements}`} /><DetailStat icon={LockKeyhole} label="Locked" value={`${game.lockedAchievements}`} /><DetailStat icon={Sparkles} label="Average rarity" value={`${game.averageRarity.toFixed(1)}%`} /><DetailStat icon={Medal} label="Latest unlock" value={game.latestAchievement?.title ?? "None yet"} /></div>
    <div className="details-section-header"><div><span>ACHIEVEMENTS</span><h2>Game collection</h2></div></div>
    <FilterToolbar><SegmentedFilter value={filter} onChange={setFilter} options={[{value:"all",label:"All"},{value:"unlocked",label:"Unlocked"},{value:"locked",label:"Locked"},{value:"rare",label:"Rare"}]} /><div className="toolbar-end"><SelectControl value={sort} onChange={setSort} label="Sort" options={[{value:"status",label:"Unlock status"},{value:"rarity",label:"Rarity"},{value:"name",label:"Name"}]} /></div></FilterToolbar>
    {achievements.length ? <div className="achievements-grid">{achievements.map((item) => <AchievementListCard key={item.id} achievement={item} game={game} onOpen={(achievement: Achievement) => onOpenAchievement(achievement.id)} />)}</div> : <EmptyView compact title="No achievements found" description="Choose another filter to view this game's achievements." />}
  </section>;
}
function DetailStat({ icon: Icon, label, value }: { icon: typeof Gem; label: string; value: string }) { return <article><Icon size={17} /><div><span>{label}</span><strong>{value}</strong></div></article>; }
