import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Gem, HelpCircle, History, RefreshCw, WifiOff } from "lucide-react";
import { AchievementRow } from "../components/achievements/AchievementRow";
import { AchievementIcon } from "../components/ui/AchievementIcon";
import { EmptyView, ErrorView, LoadingView } from "../components/ui/StateViews";
import { FilterToolbar, SearchField, SegmentedFilter, SelectControl } from "../components/ui/FilterBar";
import { GameArtwork } from "../components/ui/GameArtwork";
import { PlatformStrip, type PlatformKey } from "../components/ui/PlatformStrip";
import { GameActionButton } from "../components/games/GameActionButton";
import { GameSessionIndicator } from "../components/games/GameSessionIndicator";
import { formatSessionSummaryDuration, sessionSummaryPluralKey } from "../features/session-summaries/sessionSummaryFormatting";
import { useAsyncData } from "../hooks/useAsyncData";
import { gameInstallStateKey, useGameInstallState } from "../hooks/useGameInstallState";
import { useLibraryRevision } from "../hooks/useLibraryRevision";
import { useTranslation } from "../i18n/TranslationContext";
import { steamArtworkSources } from "../services/platform/steamArtwork";
import { gameSessionSummaryStore, services, smartSync } from "../services/compositionRoot";
import {
  calculateAchievementSummary,
  filterAndSortAchievements,
  getGameAchievementInsight,
  type AchievementFilter,
  type AchievementSort
} from "../services/gameDetailsExperience";
import type { Achievement, AchievementId, Game, GameId, SteamAchievementSyncResult } from "../types";

/**
 * Game Details v2.
 *
 * Two regions, not five cards: one identity panel that carries the cover, the
 * title, the metadata line, the integrated progress and the data-state line,
 * then the achievement list as the primary content. The cover anchors the panel
 * at a real 112x168 portrait size inside its mount, so entering the page reads
 * as entering this game rather than opening a settings screen.
 *
 * Two state rules the page must keep:
 * - The two queries fail independently. A failed achievement load stays inside
 *   the achievement region so the identity panel and Play/Install survive it.
 * - Nothing is presented as more certain than it is. Completion is exact only
 *   when every unlock state is known, rarity appears only when a real global
 *   percentage exists, and offline says it is showing the last synchronized
 *   data instead of claiming the data is current.
 *
 * One copy rule: a locale value that carries a {{variable}} is a sentence, not a
 * label, and may only be rendered together with its variables. The translator
 * re-emits the raw placeholder when a variable is missing, so a bare t() call on
 * such a key leaks template syntax into the UI. Labels get their own keys.
 *
 * One status rule: the data-state line says a thing once. The persisted sync
 * state and the stored timestamp are the truth, the action shows whether an
 * update can run, and a transient phrase appears only when it adds something
 * neither of them can say.
 *
 * One identity rule: a platform glyph is shown only for a platform this app's
 * data can actually prove, so the strip is derived from the game itself and
 * never from what would look good in the layout.
 *
 * Steam sync state, the sync action and the installation state belong to Steam
 * games only. A local game states the local game text instead of borrowing
 * Steam semantics it cannot have.
 */

const PAGE_SIZE = 60;
const SESSION_LIMIT = 3;
// Bounded on purpose. "Rare" is deliberately absent: the two rare thresholds in
// the codebase still disagree, so a Rare filter would be a guess.
const PAGE_FILTERS: AchievementFilter[] = ["all", "unlocked", "locked", "hidden"];
const PAGE_SORTS: AchievementSort[] = ["default", "name", "status", "rarity", "date"];

type SyncState = "never" | "success" | "partial" | "unsupported" | "private" | "failed";

const SYNC_STATE_LABELS: Record<SyncState, string> = {
  never: "gameDetails.neverSynced",
  success: "gameDetails.sync.success",
  partial: "gameDetails.sync.partial",
  unsupported: "gameDetails.sync.unsupported",
  private: "gameDetails.sync.private",
  failed: "gameDetails.sync.failed"
};

export function GameDetailsPage({ gameId, onBack, onOpenAchievement }: {
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
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  // The coordinator owns the sync status; this only re-renders the page when it
  // changes, so queued/updating/unavailable are never stale on screen.
  const [, bumpSyncRevision] = useState(0);
  // Advisory only. The browser can report online while the network is useless,
  // so this never upgrades cached data to "current", it only stops the page from
  // offering an action that cannot work.
  const [online, setOnline] = useState(() => navigator.onLine !== false);

  const game = gameState.status === "success" ? gameState.data : undefined;
  const allAchievements = achievementsState.status === "success" ? achievementsState.data : [];
  const installState = useGameInstallState(game?.platform === "steam" ? game.appId : undefined, "owned");

  useEffect(() => setVisibleCount(PAGE_SIZE), [query, filter, sort, gameId]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // One subscription for the lifetime of the page, torn down by the unsubscribe
  // the coordinator returns. No polling and no timers.
  useEffect(() => smartSync.subscribe(() => bumpSyncRevision((value) => value + 1)), []);

  const steamGameId = game?.platform === "steam" ? game.id : undefined;
  useEffect(() => {
    if (!steamGameId || !online) return;
    // Background attempt. The coordinator records the real outcome and the status
    // line reads it, so a rejection is reported there instead of escaping as an
    // unhandled rejection. The catch changes nothing on screen and never turns a
    // failure into a success.
    smartSync.syncGame(steamGameId, "page-open").catch(() => undefined);
  }, [steamGameId, online]);

  const experience = useMemo(() => {
    if (!game) return undefined;
    return {
      summary: calculateAchievementSummary(game, allAchievements),
      filtered: filterAndSortAchievements(allAchievements, { query, filter, sort }),
      insight: getGameAchievementInsight(game, allAchievements, new Date().toISOString())
    };
  }, [game, allAchievements, query, filter, sort]);

  // Stable so the memoized rows do not re-render on every parent render.
  const openAchievement = useCallback(
    (achievement: Achievement) => onOpenAchievement(achievement.id),
    [onOpenAchievement]
  );

  if (gameState.status === "loading") return <GameDetailsShell onBack={onBack} />;
  if (gameState.status === "error") {
    return <ErrorView message={t("gameDetails.loadError")} onRetry={gameState.retry} />;
  }
  if (!game || !experience) {
    return <EmptyView title={t("gameDetails.gameNotFound")} description={t("gameDetails.gameNotFoundDescription")} />;
  }

  const { summary, filtered, insight } = experience;
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const isSteam = game.platform === "steam";
  const hasAchievementData = allAchievements.length > 0 || game.totalAchievements > 0;
  // Steam sync state, the sync status and the last sync time only mean something
  // for a Steam game. A local game is not "never synced": it has no Steam
  // achievement sync to be behind on.
  const syncState = isSteam ? getSyncState(game, hasAchievementData) : undefined;
  const smartStatus = isSteam ? smartSync.getStatus(`achievements:${game.id}`) : "idle";
  const updating = syncing || smartStatus === "updating" || smartStatus === "queued";
  const completionExact = summary.completion !== null && summary.unknownUnlockStates === 0;
  const lastPlayed = game.lastPlayedAt && isValidDate(game.lastPlayedAt) ? new Date(game.lastPlayedAt) : undefined;
  const lastSynced = isSteam && game.achievementsSyncedAt && isValidDate(game.achievementsSyncedAt)
    ? new Date(game.achievementsSyncedAt)
    : undefined;
  const installKey = isSteam ? gameInstallStateKey(installState) : undefined;
  // Provable platforms only: this is a Windows desktop client, and a Steam game
  // is owned on Steam by definition of where the library came from. Anything
  // else would be an icon the data cannot back.
  const platforms: PlatformKey[] = isSteam ? ["pc", "steam"] : ["pc"];
  const visible = filtered.slice(0, visibleCount);
  const filtersActive = query.trim().length > 0 || filter !== "all";
  const listReady = achievementsState.status === "success" && allAchievements.length > 0;
  const recommended = insight.nextAchievement
    ? allAchievements.find((item) => item.id === insight.nextAchievement?.achievementId)
    : undefined;
  const recommendedTitle = recommended ? recommended.title || t("gameDetails.hiddenAchievement") : "";
  const recommendationReason = insight.nextAchievement && recommended
    ? t(insight.nextAchievement.translationKey, { name: recommended.title })
    : "";
  const recommendedRarity = insight.nextAchievement?.metadata?.globalUnlockPercent;
  // One hierarchy on the data-state line. The state text and the stored
  // timestamp next to it are the persisted truth, and the action itself already
  // shows whether an update can run, so a transient phrase is rendered only when
  // it says something neither of them can: there is no connection, work is in
  // progress, or this user just asked for a sync and this is its real outcome.
  //
  // The coordinator's own success, unavailable and saved statuses are
  // deliberately not rendered. A resolved coordinator job was never proof that
  // Steam achievement data synced, so it may not speak about freshness at all,
  // and a second phrase meaning "the update cannot run now" would only repeat
  // the state text and the disabled action. That is stricter than gating a
  // freshness claim on the persisted data, so the old contradiction of a success
  // message beside a failed sync cannot come back.
  const statusMessage = !isSteam
    ? ""
    : !online
    ? t("gameDetails.offlineCached")
    : updating
    ? t("gameDetails.smartSync.updating")
    : syncMessage;
  // The state marker reads the same persisted truth as the text beside it, so it
  // can never show success while the words report a failure. Green is only a real
  // full success; partial, failed, private and unsupported are all a real
  // problem; before the first sync there is nothing to report.
  const statusTone = !isSteam || syncState === "never"
    ? ""
    : syncState === "success" ? " gd-status--ok" : " gd-status--warn";

  const syncAchievements = async () => {
    if (updating || !isSteam || !online) return;
    setSyncing(true);
    setSyncMessage("");
    try {
      // The coordinator resolves with the per-game result summary; a resolved
      // promise is not proof of achievement sync success, so read the real
      // outcome for this game before claiming it.
      const result = await smartSync.syncGame(game.id, "manual", true) as SteamAchievementSyncResult;
      const gameResult = result?.games?.find((item) => item.gameId === game.id);
      if (gameResult?.status === "success" || gameResult?.status === "partial") {
        setSyncMessage(t("gameDetails.sync.success"));
      } else if (gameResult?.status === "unsupported") {
        setSyncMessage(t("gameDetails.sync.unsupported"));
      } else {
        setSyncMessage(t("gameDetails.sync.error"));
      }
    } catch {
      setSyncMessage(navigator.onLine === false
        ? t("gameDetails.offlineCached")
        : t("gameDetails.sync.error"));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section className="game-details-v1">
      {/* One panel: identity, progress and data state. The cover anchors it. */}
      <header className="gd-identity">
        <button
          type="button"
          className="gd-identity__back"
          onClick={onBack}
          aria-label={t("gameDetails.back")}
          title={t("gameDetails.back")}
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        {/* The mount frames the artwork as this game's identity: a recessed
            technical surface and two corner brackets, drawn in CSS. */}
        <div className="gd-identity__mount">
          <GameArtwork
            src={game.coverUrl}
            sources={isSteam
              ? steamArtworkSources({ appId: game.appId, kind: "cover", storedUrl: game.coverUrl, iconUrl: game.iconUrl })
              : undefined}
            alt={t("gameDetails.coverAlt", { title: game.name })}
            variant="cover"
            className="gd-identity__cover"
            eager
            appId={isSteam ? game.appId : undefined}
            componentName="GameDetailsIdentity"
          />
        </div>
        <div className="gd-identity__main">
          <div className="gd-identity__head">
            <h1 className="gd-identity__title" dir="auto">{game.name}</h1>
            <div className="gd-identity__actions">
              {isSteam && <GameSessionIndicator appId={game.appId} />}
              {isSteam && <GameActionButton appId={game.appId} title={game.name} owned compact />}
            </div>
          </div>
          {/* Secondary line: platform glyphs first, then the real metadata this
              game actually has. */}
          <div className="gd-identity__meta">
            <PlatformStrip platforms={platforms} />
            {isSteam && <span dir="ltr">{t("gameDetails.appId", { id: game.appId })}</span>}
            {game.playtimeHours > 0 && <span>{t("gameDetails.playtime", { hours: number.format(game.playtimeHours) })}</span>}
            {lastPlayed && (
              <span>
                {t("gameDetails.lastPlayed", {
                  date: new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(lastPlayed)
                })}
              </span>
            )}
            {installKey && <span>{t(installKey)}</span>}
          </div>

          {/* Progress belongs to the identity, not to a metric card of its own. */}
          <div className="gd-progress" role="group" aria-label={t("gameDetails.completion")}>
            {summary.total === null ? (
              <span className="gd-progress__item gd-progress__item--unknown">
                <HelpCircle size={14} aria-hidden="true" />
                {t("gameDetails.achievementDataUnavailable")}
              </span>
            ) : (
              <>
                {completionExact ? (
                  <>
                    <strong className="gd-progress__value">
                      {t("gameDetails.completionValue", { percent: number.format(summary.completion ?? 0) })}
                    </strong>
                    <span
                      className="gd-progress__track"
                      role="progressbar"
                      aria-label={t("gameDetails.completion")}
                      aria-valuenow={summary.completion ?? 0}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <span className="gd-progress__fill" style={{ inlineSize: `${summary.completion ?? 0}%` }} />
                    </span>
                  </>
                ) : (
                  <strong className="gd-progress__value">{t("gameDetails.completionPartial")}</strong>
                )}
                <span className="gd-progress__item">
                  {t("gameDetails.unlockedOfTotal", {
                    unlocked: number.format(summary.unlocked ?? 0),
                    total: number.format(summary.total)
                  })}
                </span>
                <span className="gd-progress__item">
                  {t("gameDetails.lockedCount", { count: number.format(summary.locked ?? 0) })}
                </span>
                {summary.unknownUnlockStates > 0 && (
                  <span className="gd-progress__item gd-progress__item--unknown">
                    <HelpCircle size={14} aria-hidden="true" />
                    {t("gameDetails.unknownCount", { count: number.format(summary.unknownUnlockStates) })}
                  </span>
                )}
              </>
            )}
          </div>

          {/* Sync is metadata on one line: state, timestamp, at most one
              transient phrase, then the action. */}
          <div className={`gd-status${statusTone}`}>
            <span className="gd-status__state">
              {syncState ? t(SYNC_STATE_LABELS[syncState]) : t("gameDetails.localGame")}
            </span>
            {lastSynced && (
              <time className="gd-status__time" dateTime={lastSynced.toISOString()}>
                {t("gameDetails.lastSyncValue", {
                  date: new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(lastSynced)
                })}
              </time>
            )}
            {statusMessage && (
              <span className="gd-status__message" role="status">
                {!online && <WifiOff size={14} aria-hidden="true" />}
                {statusMessage}
              </span>
            )}
            {isSteam && (
              <button
                type="button"
                className="secondary-button gd-textbutton gd-status__action"
                onClick={() => void syncAchievements()}
                disabled={updating || !online}
                title={online ? undefined : t("gameDetails.offlineSyncDisabled")}
              >
                <RefreshCw size={14} className={updating ? "steam-sync-spinning" : ""} aria-hidden="true" />
                {updating ? t("gameDetails.syncing") : t("gameDetails.sync")}
              </button>
            )}
          </div>
        </div>
      </header>

      <section className="gd-achievements" aria-label={t("gameDetails.allAchievements")}>
        <div className="gd-achievements__head">
          <h2 className="gd-achievements__title">{t("gameDetails.allAchievements")}</h2>
          {listReady && (
            <span className="gd-achievements__count">
              {t("gameDetails.achievementCount", {
                shown: number.format(filtered.length),
                total: number.format(allAchievements.length)
              })}
            </span>
          )}
          {filtersActive && visible.length > 0 && (
            <button
              type="button"
              className="secondary-button gd-textbutton"
              onClick={() => { setQuery(""); setFilter("all"); }}
            >
              {t("gameDetails.clearFilters")}
            </button>
          )}
        </div>

        {/* A thin tactical row, not a recommendation card. Real rarity only. The
            label carries no variables; the name is the element next to it. */}
        {insight.nextAchievement && recommended && (
          <button type="button" className="gd-next" onClick={() => openAchievement(recommended)}>
            <span className="gd-next__label">{t("gameDetails.nextTarget")}</span>
            <AchievementIcon src={recommended.iconUrl} alt="" size={32} />
            <span className="gd-next__text">
              <span className="gd-next__title" dir="auto">{recommendedTitle}</span>
              {recommendationReason && !recommendationReason.includes(recommended.title) && (
                <span className="gd-next__reason">{recommendationReason}</span>
              )}
            </span>
            <span className="gd-next__meta">
              {typeof recommendedRarity === "number" && (
                <span dir="ltr">
                  <Gem size={13} aria-hidden="true" />
                  {t("gameDetails.globalPercent", { percent: number.format(recommendedRarity) })}
                </span>
              )}
            </span>
            <ChevronRight className="gd-achievement-row__chevron" size={16} aria-hidden="true" />
          </button>
        )}

        <FilterToolbar>
          <SearchField value={query} onChange={setQuery} placeholder={t("gameDetails.searchPlaceholder")} />
          <SegmentedFilter
            value={filter}
            options={PAGE_FILTERS.map((item) => ({ value: item, label: t(`gameDetails.filter.${item}`) }))}
            onChange={setFilter}
          />
          <SelectControl
            value={sort}
            label={t("gameDetails.sort")}
            options={PAGE_SORTS.map((item) => ({ value: item, label: t(`gameDetails.sort.${item}`) }))}
            onChange={setSort}
          />
        </FilterToolbar>
        {achievementsState.status === "loading" ? (
          <LoadingView size="md" label={t("gameDetails.loadingAchievements")} />
        ) : achievementsState.status === "error" ? (
          <div className="gd-achievements__error" role="alert">
            <span>{t("gameDetails.achievementsError")}</span>
            <button type="button" className="secondary-button gd-textbutton" onClick={achievementsState.retry}>
              {t("gameDetails.retry")}
            </button>
          </div>
        ) : allAchievements.length === 0 ? (
          <EmptyView
            compact
            title={t(emptyTitleKey(syncState, isSteam))}
            description={t(emptyDescriptionKey(syncState, isSteam))}
          />
        ) : visible.length === 0 ? (
          <div className="gd-achievements__empty">
            <EmptyView compact title={t("gameDetails.noResults")} description={t("gameDetails.noResultsDescription")} />
            <button
              type="button"
              className="secondary-button gd-textbutton"
              onClick={() => { setQuery(""); setFilter("all"); }}
            >
              {t("gameDetails.clearFilters")}
            </button>
          </div>
        ) : (
          <>
            <div className="gd-achievement-list">
              {visible.map((achievement) => (
                <AchievementRow key={achievement.id} achievement={achievement} onOpen={openAchievement} />
              ))}
            </div>
            {visibleCount < filtered.length && (
              <div className="gd-achievements__more">
                <span>
                  {t("gameDetails.showing", {
                    shown: number.format(visible.length),
                    total: number.format(filtered.length)
                  })}
                </span>
                <button
                  type="button"
                  className="secondary-button gd-textbutton"
                  onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                >
                  {t("gameDetails.loadMore")}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <RecentGameSessions appId={game.appId} />
    </section>
  );
}

/**
 * Page shell while the game itself is loading. It keeps the back control usable
 * and reserves the identity geometry, including the cover mount, instead of
 * inventing placeholder content.
 */
function GameDetailsShell({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="game-details-v1">
      <header className="gd-identity gd-identity--skeleton">
        <button
          type="button"
          className="gd-identity__back"
          onClick={onBack}
          aria-label={t("gameDetails.back")}
          title={t("gameDetails.back")}
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <span className="gd-identity__mount" aria-hidden="true" />
        <div className="gd-identity__main" />
      </header>
      <LoadingView size="md" label={t("state.loading")} />
    </section>
  );
}

/**
 * Recent local play sessions. Real local data only: when there is none, the
 * section renders nothing rather than an empty shelf. Secondary by design, so it
 * is a HUD label over three hairline rows, never a panel.
 */
function RecentGameSessions({ appId }: { appId: string }) {
  const { language, t } = useTranslation();
  const [revision, setRevision] = useState(0);
  useEffect(() => gameSessionSummaryStore.subscribe(() => setRevision((value) => value + 1)), []);
  const state = useAsyncData(() => gameSessionSummaryStore.forGame(appId, SESSION_LIMIT), [appId, revision]);
  if (state.status !== "success" || state.data.length === 0) return null;
  const date = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
  const number = new Intl.NumberFormat(language);
  return (
    <section className="gd-sessions">
      <h2 className="gd-sessions__title">{t("sessionSummary.recentTitle")}</h2>
      <ol className="gd-sessions__list">
        {state.data.slice(0, SESSION_LIMIT).map((summary) => (
          <li key={summary.sessionId}>
            <History size={14} aria-hidden="true" />
            <strong>{formatSessionSummaryDuration(summary.durationSeconds, language, t)}</strong>
            <time dateTime={new Date(summary.endedAtMs).toISOString()}>{date.format(new Date(summary.endedAtMs))}</time>
            {summary.unlockedCount > 0 && (
              <span className="gd-sessions__unlocks">
                {t(sessionSummaryPluralKey("sessionSummary.historyUnlocks", summary.unlockedCount, language), {
                  count: number.format(summary.unlockedCount)
                })}
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The real reason there is no achievement data, taken from what the last sync
 * actually reported. Never a guess and never a generic "not available". Steam
 * only: the caller does not ask for a sync state for a local game.
 */
function getSyncState(game: Game, hasAchievementData = game.totalAchievements > 0): SyncState {
  const status = game.achievementsSyncStatus;
  if (status === "unsupported") return "unsupported";
  if (status === "error") {
    return game.achievementsSyncError?.toLowerCase().includes("private") ? "private" : "failed";
  }
  if (!game.achievementsSyncedAt) return "never";
  if (status === "partial" || !hasAchievementData) return "partial";
  return "success";
}

function emptyTitleKey(state: SyncState | undefined, isSteam: boolean) {
  if (!isSteam || !state) return "gameDetails.noAchievements";
  if (state === "private") return "gameDetails.sync.private";
  if (state === "never") return "gameDetails.neverSynced";
  if (state === "partial") return "gameDetails.sync.partial";
  if (state === "failed") return "gameDetails.sync.failed";
  return "gameDetails.noAchievements";
}

function emptyDescriptionKey(state: SyncState | undefined, isSteam: boolean) {
  if (!isSteam || !state) return "gameDetails.localGame";
  if (state === "private") return "gameDetails.privateDescription";
  if (state === "never") return "gameDetails.sync.never";
  if (state === "partial") return "gameDetails.partialDescription";
  if (state === "failed") return "gameDetails.sync.error";
  return "gameDetails.noAchievementsDescription";
}

function isValidDate(value?: string) {
  return Boolean(value) && Number.isFinite(new Date(value!).getTime());
}
