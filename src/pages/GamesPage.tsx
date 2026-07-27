import { useMemo, useState } from "react";
import { Grid2X2, List } from "lucide-react";
import { EmptyView, ErrorView, LoadingView } from "../components/ui/StateViews";
import { FilterToolbar, SearchField, SegmentedFilter, SelectControl } from "../components/ui/FilterBar";
import { PageHeader } from "../components/ui/PageHeader";
import type { Game, GameId } from "../types";
import type { GameCardData } from "../types/gameCard";
import { useAsyncData } from "../hooks/useAsyncData";
import { services } from "../services/compositionRoot";
import { GameCard, GameCardCompact } from "../components/games/GameCard";
import { useTranslation } from "../i18n/TranslationContext";

type GameFilter = "all" | "completed" | "progress" | "not_started";
type GameSort = "recent" | "completion" | "playtime" | "name";
type ViewMode = "grid" | "list";
type LibraryDensity = "compact" | "comfortable" | "large";

export function GamesPage({ onOpenGame }: { onOpenGame: (id: GameId) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<GameFilter>("all");
  const [sort, setSort] = useState<GameSort>("recent");
  const [view, setView] = useState<ViewMode>("grid");
  const [density, setDensity] = useState<LibraryDensity>("comfortable");
  const state = useAsyncData(() => services.games.list(), []);
  const source = state.status === "success" ? state.data : [];
  const games = useMemo(() => source
    .filter((game) => game.name.toLowerCase().includes(query.toLowerCase()))
    .filter((game) => filter === "all" || (filter === "completed" ? game.completionPercentage === 100 : filter === "progress" ? game.completionPercentage > 0 && game.completionPercentage < 100 : game.completionPercentage === 0))
    .sort((a, b) => sortGames(a, b, sort)), [source, query, filter, sort]);
  const cardGames = useMemo(() => games.map(toGameCardData), [games]);
  if (state.status === "loading") return <LoadingView />;
  if (state.status === "error") return <ErrorView message={state.error} onRetry={() => location.reload()} />;

  return (
    <section className="content-page">
      <PageHeader eyebrow="GAME LIBRARY" title="My Games" description={`${source.length} games connected across your platforms.`} />
      <FilterToolbar>
        <SearchField value={query} onChange={setQuery} placeholder="Search your library..." />
        <SegmentedFilter value={filter} onChange={setFilter} options={[
          { value: "all", label: "All games" }, { value: "completed", label: "100% complete" },
          { value: "progress", label: "In progress" }, { value: "not_started", label: "Not started" }
        ]} />
        <div className="toolbar-end">
          {view === "grid" && <SelectControl value={density} onChange={setDensity} label={t("gameCard.density")} options={[
            { value: "compact", label: t("gameCard.density.compact") },
            { value: "comfortable", label: t("gameCard.density.comfortable") },
            { value: "large", label: t("gameCard.density.large") }
          ]} />}
          <SelectControl value={sort} onChange={setSort} label="Sort" options={[
            { value: "recent", label: "Last played" }, { value: "completion", label: "Completion" },
            { value: "playtime", label: "Playtime" }, { value: "name", label: "Name" }
          ]} />
          <div className="view-toggle"><button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} aria-label="Grid view"><Grid2X2 size={16} /></button><button className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-label="List view"><List size={17} /></button></div>
        </div>
      </FilterToolbar>
      {cardGames.length ? <div className={`library-${view} library-density-${density}`}>{cardGames.map((card) => {
        const Card = view === "grid" ? GameCard : GameCardCompact;
        return <Card key={card.id} game={card} onOpen={onOpenGame} onViewAchievements={onOpenGame} onViewDetails={onOpenGame} />;
      })}</div> :
        <EmptyView compact title="No games found" description="Try a different search term or completion filter." />}
    </section>
  );
}

function toGameCardData(game: Game): GameCardData {
  return {
    id: game.id,
    title: game.name,
    coverUrl: game.coverUrl,
    backgroundUrl: game.backgroundUrl,
    platform: game.platform,
    playtimeMinutes: Math.round(game.playtimeHours * 60),
    unlockedAchievements: game.unlockedAchievements,
    totalAchievements: game.totalAchievements,
    completionPercent: game.completionPercentage,
    lastPlayedAt: game.lastPlayedAt,
    favorite: false,
    hidden: false,
    status: game.completionPercentage === 100
      ? "completed"
      : game.playtimeHours <= 0
        ? "notStarted"
        : "playing"
  };
}

function sortGames(a: Game, b: Game, sort: GameSort) {
  if (sort === "completion") return b.completionPercentage - a.completionPercentage;
  if (sort === "playtime") return b.playtimeHours - a.playtimeHours;
  if (sort === "name") return a.name.localeCompare(b.name);
  return new Date(b.lastPlayedAt).getTime() - new Date(a.lastPlayedAt).getTime();
}
