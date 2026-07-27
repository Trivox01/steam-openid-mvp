import { useMemo, useState } from "react";
import { Clock3, Grid2X2, List, Trophy } from "lucide-react";
import { motion } from "framer-motion";
import { mockGames } from "../data/mockData";
import { EmptyView } from "../components/ui/StateViews";
import { FilterToolbar, SearchField, SegmentedFilter, SelectControl } from "../components/ui/FilterBar";
import { PageHeader } from "../components/ui/PageHeader";
import type { Game } from "../types";

type GameFilter = "all" | "completed" | "progress" | "not_started";
type GameSort = "recent" | "completion" | "playtime" | "name";
type ViewMode = "grid" | "list";

export function GamesPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<GameFilter>("all");
  const [sort, setSort] = useState<GameSort>("recent");
  const [view, setView] = useState<ViewMode>("grid");
  const games = useMemo(() => mockGames
    .filter((game) => game.name.toLowerCase().includes(query.toLowerCase()))
    .filter((game) => filter === "all" || (filter === "completed" ? game.completionPercentage === 100 : filter === "progress" ? game.completionPercentage > 0 && game.completionPercentage < 100 : game.completionPercentage === 0))
    .sort((a, b) => sortGames(a, b, sort)), [query, filter, sort]);

  return (
    <section className="content-page">
      <PageHeader eyebrow="GAME LIBRARY" title="My Games" description={`${mockGames.length} games connected across your platforms.`} />
      <FilterToolbar>
        <SearchField value={query} onChange={setQuery} placeholder="Search your library..." />
        <SegmentedFilter value={filter} onChange={setFilter} options={[
          { value: "all", label: "All games" }, { value: "completed", label: "100% complete" },
          { value: "progress", label: "In progress" }, { value: "not_started", label: "Not started" }
        ]} />
        <div className="toolbar-end">
          <SelectControl value={sort} onChange={setSort} label="Sort" options={[
            { value: "recent", label: "Last played" }, { value: "completion", label: "Completion" },
            { value: "playtime", label: "Playtime" }, { value: "name", label: "Name" }
          ]} />
          <div className="view-toggle"><button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} aria-label="Grid view"><Grid2X2 size={16} /></button><button className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-label="List view"><List size={17} /></button></div>
        </div>
      </FilterToolbar>
      {games.length ? <div className={`library-${view}`}>{games.map((game) => <LibraryGame key={game.id} game={game} view={view} />)}</div> :
        <EmptyView compact title="No games found" description="Try a different search term or completion filter." />}
    </section>
  );
}

function LibraryGame({ game, view }: { game: Game; view: ViewMode }) {
  return (
    <motion.article className={`library-game ${view}`} whileHover={{ y: view === "grid" ? -3 : 0 }}>
      <img src={game.coverUrl} alt={`${game.name} cover`} />
      <div className="library-game-body">
        <div className="game-title-row"><div><span className="platform-badge">STEAM</span><h2>{game.name}</h2></div><strong>{game.completionPercentage}%</strong></div>
        <div className="game-meta"><span><Clock3 size={13} /> {game.playtimeHours}h</span><span><Trophy size={13} /> {game.unlockedAchievements}/{game.totalAchievements}</span></div>
        <div className="game-progress"><div><b style={{ width: `${game.completionPercentage}%` }} /></div></div>
        <p>Last played {formatRelativeDate(game.lastPlayedAt)}</p>
      </div>
    </motion.article>
  );
}

function sortGames(a: Game, b: Game, sort: GameSort) {
  if (sort === "completion") return b.completionPercentage - a.completionPercentage;
  if (sort === "playtime") return b.playtimeHours - a.playtimeHours;
  if (sort === "name") return a.name.localeCompare(b.name);
  return new Date(b.lastPlayedAt).getTime() - new Date(a.lastPlayedAt).getTime();
}

function formatRelativeDate(date: string) {
  const days = Math.max(0, Math.round((new Date("2026-07-27T23:00:00Z").getTime() - new Date(date).getTime()) / 86400000));
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}
