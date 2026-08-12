import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Clock3, Gem, Grid2X2, Heart, HelpCircle, List,
  History, LockKeyhole, RefreshCw, Sparkles, Trophy
} from "lucide-react";
import { AchievementExperienceCard } from "../components/achievements/AchievementExperienceCard";
import { EmptyView, ErrorView, LoadingView } from "../components/ui/StateViews";
import { GameArtwork } from "../components/ui/GameArtwork";
import { steamArtworkSources } from "../services/platform/steamArtwork";
import { ProgressBar } from "../components/ui/ProgressBar";
import { SectionHeader } from "../components/ui/SectionHeader";
import { StatusBadge } from "../components/ui/StatusBadge";
import { Surface } from "../components/ui/Surface";
import { useAsyncData } from "../hooks/useAsyncData";
import { useLibraryRevision } from "../hooks/useLibraryRevision";
import { useTranslation } from "../i18n/TranslationContext";
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
import { gameSessionSummaryStore, services, smartSync } from "../services/compositionRoot";
import type { Achievement, AchievementId, Game, GameId } from "../types";
import { GameActionButton } from "../components/games/GameActionButton";
import { GameSessionIndicator } from "../components/games/GameSessionIndicator";
import { AchievementIcon } from "../components/ui/AchievementIcon";
import { formatSessionSummaryDuration, sessionSummaryPluralKey } from "../features/session-summaries/sessionSummaryFormatting";

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
  const [, setSyncRevision] = useState(0);

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

  useEffect(() => smartSync.subscribe(() => setSyncRevision((value) => value + 1)), []);
  useEffect(() => {
    if (game?.platform === "steam") void smartSync.syncGame(game.id, "page-open").catch(() => undefined);
  }, [game?.id, game?.platform]);

  if (gameState.status === "loading" || achievementsState.status === "loading") {
    return <LoadingView size="md" label={t("gameDetails.allAchievements")} delay={120} />;
  }
  if (gameState.status === "error") return <ErrorView message={t("gameDetails.loadError")} onRetry={gameState.retry} />;
  if (achievementsState.status === "error") return <ErrorView message={t("gameDetails.sync.error")} onRetry={achievementsState.retry} />;
  if (!game || !experience) {
    return <EmptyView title={t("gameDetails.gameNotFound")} description={t("gameDetails.gameNotFoundDescription")} />;
  }

  const syncAchievements = async () => {
    if (syncing || game.platform !== "steam") return;
    if (!navigator.onLine) {
      setSyncMessage(t("gameDetails.smartSync.saved"));
      return;
    }
    setSyncing(true);
    setSyncMessage("");
    try {
      await smartSync.syncGame(game.id, "manual", true);
      setSyncMessage(t("gameDetails.sync.success"));
    } catch {
      setSyncMessage(navigator.onLine ? t("gameDetails.sync.error") : t("gameDetails.smartSync.saved"));
    } finally {
      setSyncing(false);
    }
  };

  const { filtered, summary, recent, rareUnlocked, rareOpportunities, insight } = experience;
  const visibleAchievements = filtered.slice(0, visibleCount);
  const hasAchievementData = allAchievements.length > 0 || game.totalAchievements > 0;
  const syncState = getSyncState(game, hasAchievementData);
  const smartStatus = smartSync.getStatus(`achievements:${game.id}`);
  const smartMessage = smartStatus === "updating" || smartStatus === "queued"
    ? t("gameDetails.smartSync.updating")
    : smartStatus === "saved" ? t("gameDetails.smartSync.saved")
      : smartStatus === "unavailable" ? t("gameDetails.smartSync.unavailable")
        : smartStatus === "success" ? t("gameDetails.smartSync.updated") : "";
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
        <GameArtwork src={game.backgroundUrl} sources={game.platform === "steam" ? steamArtworkSources({ appId: game.appId, kind: "hero", storedUrl: game.backgroundUrl, iconUrl: game.iconUrl }) : undefined} alt="" variant="background" className="game-v2-hero__background" eager appId={game.platform === "steam" ? game.appId : undefined} componentName="GameDetailsHero" />
        <div className="game-v2-hero__overlay" aria-hidden="true" />
        <div className="game-v2-hero__content">
          <GameArtwork src={game.coverUrl} sources={game.platform === "steam" ? steamArtworkSources({ appId: game.appId, kind: "cover", storedUrl: game.coverUrl, iconUrl: game.iconUrl }) : undefined} alt={t("gameDetails.coverAlt", { title: game.name })} variant="cover" className="game-v2-hero__cover" eager appId={game.platform === "steam" ? game.appId : undefined} componentName="GameDetailsCover" />
          <div className="game-v2-hero__copy">
            <div className="game-v2-hero__badges">
              <StatusBadge tone="accent"><span dir="ltr">{game.platform}</span></StatusBadge>
              {game.status && <StatusBadge tone={game.status === "completed" ? "success" : "neutral"}>{t(`gameCard.status.${game.status}`)}</StatusBadge>}
              {game.favorite && <StatusBadge tone="warning"><Heart />{t("gameDetails.favorite")}</StatusBadge>}
            </div>
            <h1 dir="auto">{game.name}</h1>
            <div className="game-v2-hero__metadata">
              <span title={t("gameSession.steamPlaytime")}><Clock3 />{formatPlaytime(game.playtimeHours, language, t)}</span>
              {isValidDate(game.lastPlayedAt) && <span>{formatLastPlayed(game.lastPlayedAt, language, t)}</span>}
            </div>
            {completion !== null ? (
              <ProgressBar value={completion} label={t("gameDetails.completion")} showValue />
            ) : (
              <span className="game-v2-unknown-progress"><HelpCircle />{t("gameDetails.achievementDataUnavailable")}</span>
            )}
            <strong className="game-v2-hero__achievement-count">
              {summary.unlocked === null || summary.total === null
                ? t("gameDetails.achievementDataUnavailable")
                : `${formatNumber(summary.unlocked, language)} / ${formatNumber(summary.total, language)}`}
            </strong>
            {game.platform === "steam" && <>
              <GameActionButton appId={game.appId} title={game.name} owned />
              <GameSessionIndicator appId={game.appId} className="game-v2-hero__session" />
            </>}
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
        </div>
        <div className="game-v2-overview-secondary">
          <OverviewMetric icon={Trophy} label={t("gameDetails.lastUnlocked")} value={summary.lastUnlocked?.title ?? t("gameDetails.achievementDataUnavailable")} auto />
          <OverviewMetric icon={RefreshCw} label={t("gameDetails.lastSync")} value={summary.lastSyncedAt
            ? formatDate(summary.lastSyncedAt, language, t)
            : t(hasAchievementData ? "gameDetails.achievementDataAvailable" : "gameDetails.achievementDataUnavailable")} />
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
        syncing={syncing || smartSync.getStatus(`achievements:${game.id}`) === "updating"}
        message={syncMessage || smartMessage}
        unknownCount={summary.unknownUnlockStates}
        onSync={syncAchievements}
      />

      <RecentGameSessions appId={game.appId} />

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

function RecentGameSessions({ appId }: { appId: string }) {
  const { language, t } = useTranslation();
  const [revision, setRevision] = useState(0);
  useEffect(() => gameSessionSummaryStore.subscribe(() => setRevision((value) => value + 1)), []);
  const state = useAsyncData(() => gameSessionSummaryStore.forGame(appId, 5), [appId, revision]);
  if (state.status !== "success" || state.data.length === 0) return null;
  const date = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
  const number = new Intl.NumberFormat(language);
  return <section className="game-v2-section game-session-history" aria-labelledby="game-session-history-title">
    <SectionHeader title={t("sessionSummary.recentTitle")} description={t("sessionSummary.recentDescription")} />
    <ol>{state.data.map((summary) => <li key={summary.sessionId}>
      <span className="game-session-history__icon"><History aria-hidden="true" /></span>
      <span>
        <strong>{formatSessionSummaryDuration(summary.durationSeconds, language, t)}</strong>
        <time dateTime={new Date(summary.endedAtMs).toISOString()}>{date.format(new Date(summary.endedAtMs))}</time>
      </span>
      {summary.achievementsUnlocked[0] && <AchievementIcon src={summary.achievementsUnlocked[0].iconUrl} alt={t("achievements.iconAlt", { title: summary.achievementsUnlocked[0].name })} size="compact" />}
      {summary.unlockedCount > 0 && <b>{t(sessionSummaryPluralKey("sessionSummary.historyUnlocks", summary.unlockedCount, language), { count: number.format(summary.unlockedCount) })}</b>}
    </li>)}</ol>
  </section>;
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
        <button className="secondary-button" type="button" onClick={() => void onSync()} disabled={syncing}>
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

function getSyncState(game: Game, hasAchievementData = game.totalAchievements > 0): "never" | "success" | "partial" | "unsupported" | "private" | "failed" {
  if (game.achievementsSyncError === "private_library") return "private";
  if (game.achievementsSyncStatus === "success") return "success";
  if (game.achievementsSyncStatus === "partial") return "partial";
  if (game.achievementsSyncStatus === "unsupported") return "unsupported";
  if (hasAchievementData) return "success";
  if (!game.achievementsSyncedAt || !game.achievementsSyncStatus || game.achievementsSyncStatus === "idle") return "never";
  return "failed";
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

function isValidDate(value?: string) {
  return Boolean(value && Number.isFinite(new Date(value).getTime()));
}

function formatPlaytime(value: number, language: string, t: (key: string, values?: Record<string, string | number>) => string) {
  return Number.isFinite(value) && value >= 0
    ? t("gameDetails.playtime", { hours: formatNumber(value, language) })
    : t("gameDetails.playtimeUnavailable");
}

function formatDate(value: string | undefined, language: string, t: (key: string) => string) {
  if (!value) return t("gameDetails.achievementDataUnavailable");
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(date)
    : t("gameDetails.achievementDataUnavailable");
}

function formatOptional(value: number | null, language: string, t: (key: string) => string) {
  return value === null ? t("gameDetails.achievementDataUnavailable") : formatNumber(value, language);
}

function formatPercent(value: number | null, language: string, t: (key: string) => string) {
  return value === null ? t("gameDetails.achievementDataUnavailable") : `${formatNumber(value, language)}%`;
}

function formatNumber(value: number, language: string) {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value);
}
