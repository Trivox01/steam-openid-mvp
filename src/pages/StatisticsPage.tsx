import { Clock3, Gem, Medal, TrendingUp } from "lucide-react";
import { ActivityChart } from "../components/dashboard/ActivityChart";
import { StatCard } from "../components/dashboard/StatCard";
import { PageHeader } from "../components/ui/PageHeader";
import { ProgressRing } from "../components/ui/ProgressRing";
import type { GameId } from "../types";
import { useAsyncData } from "../hooks/useAsyncData";
import { services } from "../services/compositionRoot";
import { ErrorView, LoadingView } from "../components/ui/StateViews";

export function StatisticsPage({ onOpenGame }: { onOpenGame: (id: GameId) => void }) {
  const state = useAsyncData(() => services.statistics.get(), []);
  if (state.status === "loading") return <LoadingView />;
  if (state.status === "error") return <ErrorView message={state.error} onRetry={() => location.reload()} />;
  if (state.status !== "success" || state.data.games.length === 0) return null;
  const {games,achievements,weeklyActivity}=state.data;
  const totalHours = games.reduce((sum, game) => sum + game.playtimeHours, 0);
  const averageCompletion = Math.round(games.reduce((sum, game) => sum + game.completionPercentage, 0) / games.length);
  const completed = games.filter((game) => game.completionPercentage === 100).length;
  const rare = achievements.filter((item) => item.unlockedAt && item.rarityPercentage < 10).length;
  const mostPlayed = [...games].sort((a, b) => b.playtimeHours - a.playtimeHours)[0];
  const topGames = [...games].sort((a, b) => b.completionPercentage - a.completionPercentage).slice(0, 5);
  const distribution = [
    { label: "Complete", value: completed, color: "#8b5cf6" },
    { label: "75–99%", value: games.filter((g) => g.completionPercentage >= 75 && g.completionPercentage < 100).length, color: "#60a5fa" },
    { label: "25–74%", value: games.filter((g) => g.completionPercentage >= 25 && g.completionPercentage < 75).length, color: "#fbbf24" },
    { label: "0–24%", value: games.filter((g) => g.completionPercentage < 25).length, color: "#71717a" }
  ];

  return (
    <section className="content-page">
      <PageHeader eyebrow="PERFORMANCE" title="Statistics" description="A clear view of your play habits and completion progress." />
      <div className="stats-grid page-stats">
        <StatCard label="Total playtime" value={`${totalHours.toFixed(1)}h`} hint="Across all games" icon={Clock3} />
        <StatCard label="Avg. completion" value={`${averageCompletion}%`} hint="+4.2% this month" icon={TrendingUp} accent="cyan" />
        <StatCard label="Perfect games" value={`${completed}`} hint="100% completed" icon={Medal} accent="amber" />
        <StatCard label="Rare unlocks" value={`${rare}`} hint="Below 10% rarity" icon={Gem} accent="rose" />
      </div>
      <div className="statistics-grid">
        <article className="panel statistics-chart"><header><div><span>WEEKLY ACTIVITY</span><h2>Playtime this week</h2></div><strong>{weeklyActivity.reduce((s, d) => s + d.hours, 0).toFixed(1)}h</strong></header><ActivityChart data={weeklyActivity} /></article>
        <button className="panel most-played-card clickable" onClick={() => onOpenGame(mostPlayed.id)}><span>MOST PLAYED</span><div><img src={mostPlayed.coverUrl} alt="" /><div><h2>{mostPlayed.name}</h2><p>{mostPlayed.playtimeHours} hours played</p><ProgressRing value={mostPlayed.completionPercentage} size={62} /></div></div></button>
        <article className="panel distribution-card"><header><span>LIBRARY BREAKDOWN</span><h2>Completion distribution</h2></header><div className="distribution-bar">{distribution.map((item) => <b key={item.label} style={{ width: `${(item.value / games.length) * 100}%`, background: item.color }} />)}</div><div className="distribution-legend">{distribution.map((item) => <div key={item.label}><i style={{ background: item.color }} /><span>{item.label}</span><strong>{item.value}</strong></div>)}</div></article>
        <article className="panel top-games-card"><header><span>LEADERBOARD</span><h2>Top games by progress</h2></header><div>{topGames.map((game, index) => <button className="top-game-row" key={game.id} onClick={() => onOpenGame(game.id)}><b>0{index + 1}</b><img src={game.coverUrl} alt="" /><div><strong>{game.name}</strong><span>{game.unlockedAchievements}/{game.totalAchievements} unlocked</span></div><div className="mini-progress"><i style={{ width: `${game.completionPercentage}%` }} /></div><em>{game.completionPercentage}%</em></button>)}</div></article>
      </div>
    </section>
  );
}
