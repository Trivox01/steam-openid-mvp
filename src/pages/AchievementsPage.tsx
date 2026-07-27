import { useMemo, useState } from "react";
import { AchievementListCard } from "../components/achievements/AchievementListCard";
import { EmptyView, ErrorView, LoadingView } from "../components/ui/StateViews";
import { FilterToolbar, SearchField, SegmentedFilter, SelectControl } from "../components/ui/FilterBar";
import { PageHeader } from "../components/ui/PageHeader";
import type { AchievementId, GameId } from "../types";
import { useAsyncData } from "../hooks/useAsyncData";
import { services } from "../services/compositionRoot";

type AchievementFilter = "all" | "unlocked" | "locked" | "rare" | "hidden";
type AchievementSort = "date" | "rarity" | "name";

export function AchievementsPage({ onOpenAchievement }: { onOpenAchievement: (id: AchievementId, gameId: GameId) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AchievementFilter>("all");
  const [sort, setSort] = useState<AchievementSort>("date");
  const state = useAsyncData(() => services.achievements.list(), []);
  const gamesState = useAsyncData(() => services.games.list(), []);
  const source = state.status === "success" ? state.data : [];
  const games = gamesState.status === "success" ? gamesState.data : [];
  const achievements = useMemo(() => source
    .filter((achievement) => {
      const game = games.find((item) => item.id === achievement.gameId);
      return `${achievement.title} ${game?.name}`.toLowerCase().includes(query.toLowerCase());
    })
    .filter((achievement) => filter === "all" || (filter === "unlocked" ? !!achievement.unlockedAt : filter === "locked" ? !achievement.unlockedAt : filter === "rare" ? achievement.rarityPercentage < 10 : !!achievement.isHidden))
    .sort((a, b) => sortAchievements(a, b, sort)), [source, games, query, filter, sort]);
  if (state.status === "loading" || gamesState.status === "loading") return <LoadingView />;
  if (state.status === "error") return <ErrorView message={state.error} onRetry={() => location.reload()} />;
  if (gamesState.status === "error") return <ErrorView message={gamesState.error} onRetry={() => location.reload()} />;

  return (
    <section className="content-page">
      <PageHeader eyebrow="COLLECTION" title="Achievements" description={`${source.filter((item) => item.unlockedAt).length} unlocked achievements in your collection.`} />
      <FilterToolbar>
        <SearchField value={query} onChange={setQuery} placeholder="Search achievement or game..." />
        <SegmentedFilter value={filter} onChange={setFilter} options={[
          { value: "all", label: "All" }, { value: "unlocked", label: "Unlocked" }, { value: "locked", label: "Locked" },
          { value: "rare", label: "Rare" }, { value: "hidden", label: "Hidden" }
        ]} />
        <div className="toolbar-end"><SelectControl value={sort} onChange={setSort} label="Sort" options={[
          { value: "date", label: "Unlock date" }, { value: "rarity", label: "Rarity" }, { value: "name", label: "Name" }
        ]} /></div>
      </FilterToolbar>
      {achievements.length ? <div className="achievements-grid">{achievements.map((achievement) => <AchievementListCard key={achievement.id} achievement={achievement} game={games.find((game) => game.id === achievement.gameId)} onOpen={(item) => onOpenAchievement(item.id, item.gameId)} />)}</div> :
        <EmptyView compact title="No achievements found" description="Adjust your search or choose another filter." />}
    </section>
  );
}

function sortAchievements(a: import("../types").Achievement, b: import("../types").Achievement, sort: AchievementSort) {
  if (sort === "rarity") return a.rarityPercentage - b.rarityPercentage;
  if (sort === "name") return a.title.localeCompare(b.title);
  return achievementTime(b.unlockedAt) - achievementTime(a.unlockedAt);
}
function achievementTime(value?: string) { const time = value ? new Date(value).getTime() : 0; return Number.isNaN(time) ? 0 : time; }
