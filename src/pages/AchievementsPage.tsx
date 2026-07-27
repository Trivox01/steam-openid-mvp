import { useMemo, useState } from "react";
import { EyeOff, Gem, LockKeyhole, Trophy } from "lucide-react";
import { mockAchievements, mockGames } from "../data/mockData";
import { EmptyView } from "../components/ui/StateViews";
import { FilterToolbar, SearchField, SegmentedFilter, SelectControl } from "../components/ui/FilterBar";
import { PageHeader } from "../components/ui/PageHeader";
import type { Achievement } from "../types";

type AchievementFilter = "all" | "unlocked" | "locked" | "rare" | "hidden";
type AchievementSort = "date" | "rarity" | "name";

export function AchievementsPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AchievementFilter>("all");
  const [sort, setSort] = useState<AchievementSort>("date");
  const achievements = useMemo(() => mockAchievements
    .filter((achievement) => {
      const game = mockGames.find((item) => item.id === achievement.gameId);
      return `${achievement.title} ${game?.name}`.toLowerCase().includes(query.toLowerCase());
    })
    .filter((achievement) => filter === "all" || (filter === "unlocked" ? !!achievement.unlockedAt : filter === "locked" ? !achievement.unlockedAt : filter === "rare" ? achievement.rarityPercentage < 10 : !!achievement.isHidden))
    .sort((a, b) => sortAchievements(a, b, sort)), [query, filter, sort]);

  return (
    <section className="content-page">
      <PageHeader eyebrow="COLLECTION" title="Achievements" description={`${mockAchievements.filter((item) => item.unlockedAt).length} unlocked achievements in your collection.`} />
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
      {achievements.length ? <div className="achievements-grid">{achievements.map((achievement) => <FullAchievementCard key={achievement.id} achievement={achievement} />)}</div> :
        <EmptyView compact title="No achievements found" description="Adjust your search or choose another filter." />}
    </section>
  );
}

function FullAchievementCard({ achievement }: { achievement: Achievement }) {
  const game = mockGames.find((item) => item.id === achievement.gameId);
  const unlocked = Boolean(achievement.unlockedAt);
  const rare = achievement.rarityPercentage < 10;
  return (
    <article className={`full-achievement-card ${unlocked ? "unlocked" : "locked"} ${rare ? "rare" : ""}`}>
      <div className="full-achievement-icon"><img src={achievement.iconUrl} alt="" />{unlocked ? <Trophy size={15} /> : <LockKeyhole size={15} />}</div>
      <div className="full-achievement-copy">
        <div className="achievement-labels"><span>{game?.name}</span>{rare && <b><Gem size={11} /> Rare</b>}{achievement.isHidden && <b><EyeOff size={11} /> Hidden</b>}</div>
        <h2>{achievement.title}</h2>
        <p>{achievement.isHidden && !unlocked ? "This achievement remains hidden until it is unlocked." : achievement.description}</p>
        <footer><span>{unlocked ? `Unlocked ${formatAchievementDate(achievement.unlockedAt!)}` : "Locked"}</span><strong>{achievement.rarityPercentage}% of players</strong></footer>
      </div>
    </article>
  );
}

function sortAchievements(a: Achievement, b: Achievement, sort: AchievementSort) {
  if (sort === "rarity") return a.rarityPercentage - b.rarityPercentage;
  if (sort === "name") return a.title.localeCompare(b.title);
  return achievementTime(b.unlockedAt) - achievementTime(a.unlockedAt);
}
function achievementTime(value?: string) { const time = value ? new Date(value).getTime() : 0; return Number.isNaN(time) ? 0 : time; }
function formatAchievementDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en", { month: "short", day: "numeric" }); }
