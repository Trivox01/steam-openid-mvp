import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Clock3, Gem, Grid2X2, Heart, HelpCircle, List,
  LockKeyhole, RefreshCw, Sparkles, Trophy
} from "lucide-react";
import { AchievementExperienceCard } from "../components/achievements/AchievementExperienceCard";
import { EmptyView, ErrorView, LoadingView } from "../components/ui/StateViews";
import { GameArtwork } from "../components/ui/GameArtwork";
import { steamArtworkFallbacks } from "../services/platform/steamArtwork";
import { ProgressBar } from "../components/ui/ProgressBar";
import { SectionHeader } from "../components/ui/SectionHeader";
import { StatusBadge } from "../components/ui/StatusBadge";
import { Surface } from "../components/ui/Surface";
import { useAsyncData } from "../hooks/useAsyncData";
import { useLibraryRevision } from "../hooks/useLibraryRevision";
import { useTranslation } from "../i18n/TranslationContext";
import { publishLibraryChange } from "../services/dataEvents";
import {
  calculateAchievementSummary,
  filterAndSortAchievements,
  getGameAchievementInsight,
  isRareAchievement,
  selectRecentUnlocks,
  type AchievementDensity,
  type AchievementFilter,
  type AchievementSort,
  type AchievementView
} from "../services/gameDetailsExperience";
import { isAchievementUnlocked } from "../services/achievementData";
import { services } from "../services/compositionRoot";
import { SteamAchievementSyncError } from "../services/platform/SteamAchievementSyncService";
import type { Achievement, AchievementId, Game, GameId } from "../types";

const PAGE_SIZE = 120;

export function GameDetailsPage({
  gameId,
  onBack,
  onOpenAchievement
}: {
  gameId: GameId;
  onBack: () => void;
  onOpenAchievement: (id: AchievementId) => void;
}) {
  const { language, t } = useTranslation();
  const revision = useLibraryRevision();
  const gameState = useAsyncData(() => services.games.details(gameId), [gameId, revision]);
  const achievementsState = useAsyncData(() => services.achievements.byGame(gameId), [gameId, revision]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AchievementFilter>("all");
  const [sort, setSort] = useState<AchievementSort>("default");
  const [view, setView] = useState<AchievementView>("grid");
  const [density, setDensity] = useState<AchievementDensity>("comfortable");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");

  useEffect(() => setVisibleCount(PAGE_SIZE), [query, filter, sort, view, density, gameId]);

  const game = gameState.status === "success" ? gameState.data : undefined;
  const allAchievements = achievementsState.status === "success" ? achievementsState.data : [];
  const experience = useMemo(() => {
    if (!game) return null;
    const filtered = filterAndSortAchievements(allAchievements, { query, filter, sort });
    const summary = calculateAchievementSummary(game, allAchievements);
    const recent = selectRecentUnlocks(allAchievements, 5);
    const rareUnlocked = allAchievements
      .filter((item) => item.unlockStateKnown !== false && isAchievementUnlocked(item) && isRareAchievement(item))
      .slice(0, 6);
    const rareOpportunities = allAchievements
      .filter((item) => item.unlockStateKnown !== false && !isAchievementUnlocked(item) && isRareAchievement(item))
      .slice(0, 6);
    const insight = getGameAchievementInsight(game, allAchievements, new Date().toISOString());
    return { filtered, summary, recent, rareUnlocked, rareOpportunities, insight };
  }, [game, allAchievements, query, filter, sort]);

  if (gameState.status === "loading" || achievementsState.status === "loading") {
    return <LoadingView size="md" label={t("gameDetails.allAchievements")} delay={120} />;
  }
  if (gameState.status === "error") return <ErrorView message={t("gameDetails.loadError")} onRetry={() => location.reload()} />;
  if (achievementsState.status === "error") return <ErrorView message={t("gameDetails.sync.error")} onRetry={() => location.reload()} />;
  if (!game || !experience) {
    return <EmptyView title={t("gameDetails.gameNotFound")} description={t("gameDetails.gameNotFoundDescription")} />;
  }

  const syncAchievements = async () => {
    if (syncing || game.platform !== "steam") return;
    setSyncing(true);
    setSyncMessage("");
    try {
      const result = await services.steamAchievementSync.syncGame(game.id);
      const item = result.games.find((entry) => entry.gameId === game.id) ?? result.games[0];
      setSyncMessage(syncResultMessage(item?.status, item?.errorCode, t));
      publishLibraryChange();
    } catch (error) {
      setSyncMessage(syncResultMessage(
        "failed",
        error instanceof SteamAchievementSyncError ? error.code : "unknown",
        t
      ));
    } finally {
      setSyncing(false);
    }
  };

  const { filtered, summary, recent, rareUnlocked, rareOpportunities, insight } = experience;
  const visibleAchievements = filtered.slice(0, visibleCount);
  const syncState = getSyncState(game);
  const completion = summary.completion;
  const recommendedAchievement = insight.nextAchievement
    ? allAchievements.find((item) => item.id === insight.nextAchievement?.achievementId)
    : undefined;

  return (
    <section className="content-page game-details-v2">
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowLeft size={16} />{t("gameDetails.back")}
      </button>

      <Surface className="game-v2-hero" elevation="elevated">
        <GameArtwork src={game.backgroundUrl} fallbackSources={game.platform === "steam" ? steamArtworkFallbacks(game.appId, "background") : undefined} alt="" variant="background" className="game-v2-hero__background" eager />
        <div className="game-v2-hero__overlay" aria-hidden="true" />
        <div className="game-v2-hero__content">
          <GameArtwork src={game.coverUrl} fallbackSources={game.platform === "steam" ? steamArtworkFallbacks(game.appId, "cover") : undefined} alt={game.name} variant="cover" className="game-v2-hero__cover" eager />
          <div className="game-v2-hero__copy">
            <div className="game-v2-hero__badges">
              <StatusBadge tone="accent"><span dir="ltr">{game.platform}</span></StatusBadge>
              {game.status && <StatusBadge tone={game.status === "completed" ? "success" : "neutral"}>{t(`gameCard.status.${game.status}`)}</StatusBadge>}
              {game.favorite && <StatusBadge tone="warning"><Heart />{t("gameDetails.favorite")}</StatusBadge>}
            </div>
            <h1 dir="auto">{game.name}</h1>
            <div className="game-v2-hero__metadata">
              <span><Clock3 />{t("gameDetails.playtime", { hours: formatNumber(game.playtimeHours, language) })}</span>
              <span>{formatLastPlayed(game.lastPlayedAt, language, t)}</span>
            </div>
            {completion !== null ? (
              <ProgressBar value={completion} label={t("gameDetails.completion")} showValue />
            ) : (
              <span className="game-v2-unknown-progress"><HelpCircle />{t("gameDetails.unavailable")}</span>
            )}
            <strong className="game-v2-hero__achievement-count">
              {summary.unlocked === null || summary.total === null
                ? t("gameDetails.unavailable")
                : `${formatNumber(summary.unlocked, language)} / ${formatNumber(summary.total, language)}`}
            </strong>
          </div>
        </div>
      </Surface>

      {insight.nextAchievement && recommendedAchievement && (
        <Surface className="game-v2-continue" elevation="subtle">
          <div className="game-v2-continue__heading">
            <Sparkles aria-hidden="true" />
            <div>
              <span>{t("gameDetails.continueJourney")}</span>
              <strong dir="auto">{recommendedAchievement.title}</strong>
            </div>
          </div>
          <p>{t(insight.nextAchievement.translationKey)}</p>
          <div className="game-v2-continue__meta">
            {typeof insight.nextAchievement.metadata.globalUnlockPercent === "number" && (
              <StatusBadge tone="accent">
                <Gem />{t("gameDetails.globalPercent", {
                  percent: formatNumber(insight.nextAchievement.metadata.globalUnlockPercent, language)
                })}
              </StatusBadge>
            )}
            {typeof insight.nextAchievement.metadata.progressPercent === "number" && (
              <ProgressBar
                value={insight.nextAchievement.metadata.progressPercent}
                label={t("gameDetails.recommendationProgress")}
                showValue
              />
            )}
          </div>
          <button type="button" className="secondary-button" onClick={() => onOpenAchievement(recommendedAchievement.id)}>
            {t("gameDetails.viewRecommended")}
          </button>
        </Surface>
      )}

      <section className="game-v2-section">
        <SectionHeader title={t("gameDetails.progressOverview")} description={t("gameDetails.progressDescription")} />
        <div className="game-v2-overview">
          <OverviewMetric icon={Sparkles} label={t("gameDetails.completion")} value={formatPercent(completion, language, t)} />
          <OverviewMetric icon={Trophy} label={t("gameDetails.unlocked")} value={formatOptional(summary.unlocked, language, t)} />
          <OverviewMetric icon={LockKeyhole} label={t("gameDetails.locked")} value={formatOptional(summary.locked, language, t)} />
          <OverviewMetric icon={Gem} label={t("gameDetails.rareUnlocked")} value={formatNumber(summary.rareUnlocked, language)} />
          <OverviewMetric icon={Trophy} label={t("gameDetails.lastUnlocked")} value={summary.lastUnlocked?.title ?? t("gameDetails.unavailable")} auto />
          <OverviewMetric icon={RefreshCw} label={t("gameDetails.lastSync")} value={formatDate(summary.lastSyncedAt, language, t)} />
        </div>
      </section>

      {insight.card && (
        <Surface className="game-v2-insight" elevation="subtle">
          <Sparkles aria-hidden="true" />
          <div>
            <strong>{t("gameDetails.insightTitle")}</strong>
            <p>{t(insight.card.translationKey, insight.card.translationParams)}</p>
          </div>
        </Surface>
      )}

      <SyncPanel
        game={game}
        state={syncState}
        syncing={syncing}
        message={syncMessage}
        unknownCount={summary.unknownUnlockStates}
        onSync={syncAchievements}
      />

      {recent.length > 0 && (
        <AchievementShelf
          title={t("gameDetails.recentTitle")}
          description={t("gameDetails.recentDescription")}
          achievements={recent}
          onOpen={onOpenAchievement}
        />
      )}

      {(rareUnlocked.length > 0 || rareOpportunities.length > 0) && (
        <section className="game-v2-section">
          <SectionHeader title={t("gameDetails.rareTitle")} description={t("gameDetails.rareDescription")} />
          <div className="game-v2-rare-columns">
            <AchievementMiniShelf title={t("gameDetails.rareCompleted")} achievements={rareUnlocked} onOpen={onOpenAchievement} />
            <AchievementMiniShelf title={t("gameDetails.rareOpportunities")} achievements={rareOpportunities} onOpen={onOpenAchievement} />
          </div>
        </section>
      )}

      <section className="game-v2-section">
        <SectionHeader
          title={t("gameDetails.allAchievements")}
          description={t("gameDetails.achievementCount", {
            shown: formatNumber(filtered.length, language),
            total: formatNumber(allAchievements.length, language)
          })}
        />
        <AchievementToolbar
          query={query} filter={filter} sort={sort} view={view} density={density}
          onQuery={setQuery} onFilter={setFilter} onSort={setSort} onView={setView} onDensity={setDensity}
        />
        {visibleAchievements.length > 0 ? (
          <>
            <div className={`achievement-x-collection achievement-x-collection--${view} achievement-x-collection--${density}`}>
              {visibleAchievements.map((achievement) => (
                <AchievementExperienceCard
                  key={achievement.id}
                  achievement={achievement}
                  view={view}
                  density={density}
                  onOpen={(item) => onOpenAchievement(item.id)}
                />
              ))}
            </div>
            {visibleCount < filtered.length && (
              <div className="game-v2-load-more">
                <span>{t("gameDetails.showing", {
                  shown: formatNumber(visibleAchievements.length, language),
                  total: formatNumber(filtered.length, language)
                })}</span>
                <button type="button" className="secondary-button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                  {t("gameDetails.loadMore")}
                </button>
              </div>
            )}
          </>
        ) : (
          <EmptyView
            compact
            title={allAchievements.length ? t("gameDetails.noResults") : emptyTitle(syncState, t)}
            description={allAchievements.length ? t("gameDetails.noResultsDescription") : emptyDescription(syncState, game.platform, t)}
          />
        )}
      </section>
    </section>
  );
}

function AchievementToolbar(props: {
  query: string; filter: AchievementFilter; sort: AchievementSort;
  view: AchievementView; density: AchievementDensity;
  onQuery: (value: string) => void; onFilter: (value: AchievementFilter) => void;
  onSort: (value: AchievementSort) => void; onView: (value: AchievementView) => void;
  onDensity: (value: AchievementDensity) => void;
}) {
  const { t } = useTranslation();
  const searchRef = useRef<HTMLInputElement>(null);
  const filters: AchievementFilter[] = ["all", "unlocked", "locked", "rare", "hidden", "recent"];
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);
  return (
    <div className="game-v2-toolbar" role="search">
      <label className="game-v2-search">
        <span className="sr-only">{t("gameDetails.search")}</span>
        <input ref={searchRef} value={props.query} onChange={(event) => props.onQuery(event.target.value)} placeholder={t("gameDetails.searchPlaceholder")} />
      </label>
      <div className="game-v2-filter-list" aria-label={t("gameDetails.allAchievements")}>
        {filters.map((item) => <button key={item} type="button" aria-pressed={props.filter === item} className={props.filter === item ? "active" : ""} onClick={() => props.onFilter(item)}>{t(`gameDetails.filter.${item}`)}</button>)}
      </div>
      <label><span>{t("gameDetails.sort")}</span><select value={props.sort} onChange={(event) => props.onSort(event.target.value as AchievementSort)}>
        {(["default", "name", "status", "rarity", "date"] as const).map((item) => <option value={item} key={item}>{t(`gameDetails.sort.${item}`)}</option>)}
      </select></label>
      <label><span>{t("gameDetails.density")}</span><select value={props.density} onChange={(event) => props.onDensity(event.target.value as AchievementDensity)}>
        {(["compact", "comfortable", "large"] as const).map((item) => <option value={item} key={item}>{t(`gameDetails.density.${item}`)}</option>)}
      </select></label>
      <div className="game-v2-view-toggle">
        <button type="button" aria-pressed={props.view === "grid"} className={props.view === "grid" ? "active" : ""} onClick={() => props.onView("grid")} aria-label={t("gameDetails.view.grid")}><Grid2X2 /></button>
        <button type="button" aria-pressed={props.view === "list"} className={props.view === "list" ? "active" : ""} onClick={() => props.onView("list")} aria-label={t("gameDetails.view.list")}><List /></button>
      </div>
    </div>
  );
}

function SyncPanel({ game, state, syncing, message, unknownCount, onSync }: {
  game: Game; state: ReturnType<typeof getSyncState>; syncing: boolean;
  message: string; unknownCount: number; onSync: () => Promise<void>;
}) {
  const { language, t } = useTranslation();
  const labels = {
    never: "gameDetails.sync.never", success: "gameDetails.sync.success",
    partial: "gameDetails.sync.partial", unsupported: "gameDetails.sync.unsupported",
    private: "gameDetails.sync.private", failed: "gameDetails.sync.failed"
  } as const;
  const descriptions = {
    never: "gameDetails.sync.never", success: "gameDetails.sync.success",
    partial: "gameDetails.partialDescription", unsupported: "gameDetails.noAchievementsDescription",
    private: "gameDetails.privateDescription", failed: "gameDetails.sync.error"
  } as const;
  return (
    <Surface className={`game-v2-sync game-v2-sync--${state}`} elevation="subtle">
      <div>
        <StatusBadge tone={state === "success" ? "success" : state === "failed" || state === "private" ? "error" : state === "partial" ? "warning" : "neutral"}>
          {t(labels[state])}
        </StatusBadge>
        <strong>{t("gameDetails.syncTitle")}</strong>
        <p>{game.platform !== "steam" ? t("gameDetails.localGame") : t(descriptions[state])}</p>
        {game.achievementsSyncedAt && <time dateTime={game.achievementsSyncedAt}>{formatDate(game.achievementsSyncedAt, language, t)}</time>}
        {unknownCount > 0 && <small>{t("gameDetails.sync.unknownStates", { count: new Intl.NumberFormat(language).format(unknownCount) })}</small>}
        {message && <small role={state === "failed" ? "alert" : "status"}>{message}</small>}
      </div>
      {game.platform === "steam" && (
        <button className="primary-button" type="button" onClick={() => void onSync()} disabled={syncing}>
          <RefreshCw className={syncing ? "steam-sync-spinning" : ""} />
          {syncing ? t("gameDetails.syncing") : state === "failed" ? t("gameDetails.retry") : t("gameDetails.sync")}
        </button>
      )}
    </Surface>
  );
}

function AchievementShelf({ title, description, achievements, onOpen }: {
  title: string; description: string; achievements: Achievement[]; onOpen: (id: AchievementId) => void;
}) {
  return <section className="game-v2-section"><SectionHeader title={title} description={description} />
    <div className="game-v2-shelf">{achievements.map((item) => <AchievementExperienceCard key={item.id} achievement={item} view="list" density="compact" onOpen={() => onOpen(item.id)} />)}</div>
  </section>;
}

function AchievementMiniShelf({ title, achievements, onOpen }: {
  title: string; achievements: Achievement[]; onOpen: (id: AchievementId) => void;
}) {
  return <Surface elevation="subtle"><h3>{title}</h3>{achievements.length
    ? <div>{achievements.map((item) => <AchievementExperienceCard key={item.id} achievement={item} view="list" density="compact" onOpen={() => onOpen(item.id)} />)}</div>
    : <span>—</span>}</Surface>;
}

function OverviewMetric({ icon: Icon, label, value, auto = false }: {
  icon: typeof Trophy; label: string; value: string; auto?: boolean;
}) {
  return <Surface as="article" className="game-v2-metric" elevation="subtle"><Icon /><span>{label}</span><strong dir={auto ? "auto" : undefined}>{value}</strong></Surface>;
}

function getSyncState(game: Game): "never" | "success" | "partial" | "unsupported" | "private" | "failed" {
  if (!game.achievementsSyncedAt || !game.achievementsSyncStatus || game.achievementsSyncStatus === "idle") return "never";
  if (game.achievementsSyncError === "private_library") return "private";
  if (game.achievementsSyncStatus === "success") return "success";
  if (game.achievementsSyncStatus === "partial") return "partial";
  if (game.achievementsSyncStatus === "unsupported") return "unsupported";
  return "failed";
}

function syncResultMessage(status: string | undefined, code: string | undefined, t: (key: string) => string) {
  const codeMessages: Record<string, string> = {
    steam_api_unavailable: "gameDetails.sync.apiUnavailable",
    no_internet: "gameDetails.sync.apiUnavailable",
    invalid_response: "gameDetails.sync.apiUnavailable",
    api_key_unavailable: "gameDetails.sync.apiKeyMissing",
    empty_api_key: "gameDetails.sync.apiKeyMissing",
    invalid_api_key: "gameDetails.sync.apiKeyMissing",
    no_achievements: "gameDetails.sync.noAchievements",
    game_unsupported: "gameDetails.sync.noAchievements",
    game_not_owned: "gameDetails.sync.notOwned",
    no_player_stats: "gameDetails.sync.noPlayerStats",
    schema_unavailable: "gameDetails.sync.schemaUnavailable",
    invalid_app_id: "gameDetails.sync.invalidAppId",
    timeout: "gameDetails.sync.timeout",
    rate_limited: "gameDetails.sync.rateLimited",
    steam_not_connected: "gameDetails.sync.sessionExpired",
    session_expired: "gameDetails.sync.sessionExpired",
    local_storage_failed: "gameDetails.sync.storageFailed"
  };
  if (code && codeMessages[code]) return t(codeMessages[code]);
  if (code === "private_library") return t("gameDetails.privateDescription");
  if (status === "unsupported") return t("gameDetails.noAchievementsDescription");
  if (status === "partial") return t("gameDetails.partialDescription");
  if (status === "success") return t("gameDetails.sync.success");
  return t("gameDetails.sync.error");
}

function emptyTitle(state: ReturnType<typeof getSyncState>, t: (key: string) => string) {
  return state === "unsupported" ? t("gameDetails.noAchievements") :
    state === "private" ? t("gameDetails.sync.private") : t("gameDetails.noAchievements");
}

function emptyDescription(state: ReturnType<typeof getSyncState>, platform: string, t: (key: string) => string) {
  if (platform !== "steam") return t("gameDetails.localGame");
  if (state === "unsupported") return t("gameDetails.noAchievementsDescription");
  if (state === "private") return t("gameDetails.privateDescription");
  if (state === "partial") return t("gameDetails.partialDescription");
  return t("gameDetails.sync.never");
}

function formatLastPlayed(value: string, language: string, t: (key: string, values?: Record<string, string | number>) => string) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime())
    ? t("gameDetails.lastPlayed", { date: new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(date) })
    : t("gameDetails.neverPlayed");
}

function formatDate(value: string | undefined, language: string, t: (key: string) => string) {
  if (!value) return t("gameDetails.neverSynced");
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(date)
    : t("gameDetails.unavailable");
}

function formatOptional(value: number | null, language: string, t: (key: string) => string) {
  return value === null ? t("gameDetails.unavailable") : formatNumber(value, language);
}

function formatPercent(value: number | null, language: string, t: (key: string) => string) {
  return value === null ? t("gameDetails.unavailable") : `${formatNumber(value, language)}%`;
}

function formatNumber(value: number, language: string) {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value);
}
