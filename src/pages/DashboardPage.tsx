import { motion } from "framer-motion";
import { ArrowRight, Clock3, Gamepad2, Gem, Medal, Play, Sparkles, Target, TrendingUp } from "lucide-react";
import { ActivityChart } from "../components/dashboard/ActivityChart";
import { AchievementCard } from "../components/dashboard/AchievementCard";
import { GameCard } from "../components/dashboard/GameCard";
import { StatCard } from "../components/dashboard/StatCard";
import { ErrorView, LoadingView, EmptyView } from "../components/ui/StateViews";
import { useDashboardData } from "../hooks/useDashboardData";

export function DashboardPage({ search }: { search: string }) {
  const { state, retry } = useDashboardData();
  if (state.status === "loading") return <LoadingView />;
  if (state.status === "error") return <ErrorView message={state.error} onRetry={retry} />;
  if (state.status === "empty") return <EmptyView />;

  const { data } = state;
  const games = data.games.filter((game) => game.name.toLowerCase().includes(search.toLowerCase()));
  const totalUnlocked = data.games.reduce((sum, game) => sum + game.unlockedAchievements, 0);
  const totalAchievements = data.games.reduce((sum, game) => sum + game.totalAchievements, 0);
  const completion = Math.round((totalUnlocked / totalAchievements) * 100);
  const rareCount = data.recentAchievements.filter((item) => item.rarityPercentage < 10).length + 9;
  const lastGame = data.games[0];
  const playedHours = data.weeklyActivity.reduce((sum, day) => sum + day.hours, 0);
  const goalPercentage = Math.min(Math.round((playedHours / data.weeklyGoalHours) * 100), 100);

  return (
    <motion.div className="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <section className="welcome-row">
        <div>
          <div className="eyebrow"><Sparkles size={13} /> PLAYER OVERVIEW</div>
          <h1>Good evening, <span>{data.profile.displayName.split(" ")[0]}</span></h1>
          <p>Your next unlock is closer than you think.</p>
        </div>
        <div className="level-pill"><span>LVL</span><strong>{data.profile.level}</strong><div><b style={{ width: "72%" }} /></div></div>
      </section>

      <section className="stats-grid">
        <StatCard label="Total games" value={`${data.games.length}`} hint="+1 this month" icon={Gamepad2} />
        <StatCard label="Achievements" value={totalUnlocked.toLocaleString()} hint={`of ${totalAchievements} unlocked`} icon={Medal} accent="cyan" />
        <StatCard label="Completion" value={`${completion}%`} hint="+4.2% this month" icon={TrendingUp} accent="amber" />
        <StatCard label="Rare unlocks" value={`${rareCount}`} hint="Top 8% of players" icon={Gem} accent="rose" />
      </section>

      <section className="dashboard-grid">
        <article className="panel hero-card">
          <img src={lastGame.heroUrl} alt="" className="hero-bg" />
          <div className="hero-overlay" />
          <div className="hero-content">
            <span className="section-kicker"><span className="live-dot" /> LAST PLAYED</span>
            <h2>{lastGame.name}</h2>
            <p><Clock3 size={15} /> {lastGame.playtimeHours} hours played</p>
            <div className="hero-progress"><div><span>Achievement progress</span><strong>{lastGame.completionPercentage}%</strong></div><div><b style={{ width: `${lastGame.completionPercentage}%` }} /></div></div>
            <button className="primary-button"><Play size={15} fill="currentColor" /> Continue playing</button>
          </div>
        </article>

        <article className="panel recent-panel">
          <PanelHeader title="Recent achievements" action="View all" />
          <div className="achievement-list">
            {data.recentAchievements.map((achievement) => (
              <AchievementCard key={achievement.id} achievement={achievement} game={data.games.find((game) => game.id === achievement.gameId)} />
            ))}
          </div>
        </article>

        <article className="panel chart-panel">
          <PanelHeader title="Weekly activity" action="Last 7 days" />
          <div className="chart-total"><strong>{playedHours.toFixed(1)}h</strong><span>+12% from last week</span></div>
          <ActivityChart data={data.weeklyActivity} />
        </article>

        <article className="panel goal-panel">
          <div className="goal-icon"><Target size={22} /></div>
          <span className="section-kicker">WEEKLY GOAL</span>
          <h2>Keep the momentum</h2>
          <p>You're only <strong>{(data.weeklyGoalHours - playedHours).toFixed(1)} hours</strong> away from your target.</p>
          <div className="goal-progress"><div><b style={{ width: `${goalPercentage}%` }} /></div><span>{playedHours.toFixed(1)} / {data.weeklyGoalHours} hours</span></div>
        </article>

        <article className="panel games-panel">
          <PanelHeader title="Close to completion" action="View library" />
          <div className="games-list">
            {games.length ? games.slice(1).map((game) => <GameCard key={game.id} game={game} />) : <p className="no-results">No games match your search.</p>}
          </div>
        </article>
      </section>
    </motion.div>
  );
}

function PanelHeader({ title, action }: { title: string; action: string }) {
  return (
    <header className="panel-header"><h2>{title}</h2><button>{action} <ArrowRight size={14} /></button></header>
  );
}
