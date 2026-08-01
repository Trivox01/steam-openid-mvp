import { useMemo, useState } from "react";
import { BarChart3, CheckCircle2, Clock3, Gem, Library, Target, Trophy } from "lucide-react";
import { EmptyView, ErrorView, LoadingView } from "../components/ui/StateViews";
import { GameArtwork } from "../components/ui/GameArtwork";
import { PageHeader } from "../components/ui/PageHeader";
import { ProgressBar } from "../components/ui/ProgressBar";
import { SectionHeader } from "../components/ui/SectionHeader";
import { StatusBadge } from "../components/ui/StatusBadge";
import { Surface } from "../components/ui/Surface";
import { useAsyncData } from "../hooks/useAsyncData";
import { useTranslation } from "../i18n/TranslationContext";
import { knownAchievementRarity } from "../services/achievementData";
import { services } from "../services/compositionRoot";
import { steamArtworkSources } from "../services/platform/steamArtwork";
import {
  calculateStatisticsInsights,
  groupUnlockActivity,
  type UnlockActivityRange
} from "../services/statistics/statisticsSelectors";
import type { Game, GameId } from "../types";

type StatisticsFilter = "all" | "completed" | "progress" | "notStarted" | "favorites";

export function StatisticsPage({
  onOpenGame,
  onOpenSettings
}: {
  onOpenGame: (id: GameId) => void;
  onOpenSettings: () => void;
}) {
  const { language, t } = useTranslation();
  const [filter, setFilter] = useState<StatisticsFilter>("all");
  const [activityRange, setActivityRange] = useState<UnlockActivityRange>("12m");
  const state = useAsyncData(() => services.statistics.get(), []);
  const number = useMemo(() => new Intl.NumberFormat(language, { maximumFractionDigits: 1 }), [language]);
  const date = useMemo(() => new Intl.DateTimeFormat(language, { dateStyle: "medium" }), [language]);
  const filteredGames = useMemo(
    () => state.status === "success" ? state.data.games.filter((game) => matchesFilter(game, filter)) : [],
    [state, filter]
  );
  const filteredAchievements = useMemo(() => {
    if (state.status !== "success") return [];
    const filteredIds = new Set(filteredGames.map((game) => game.id));
    return state.data.achievements.filter((item) => filteredIds.has(item.gameId));
  }, [state, filteredGames]);
  const insights = useMemo(
    () => calculateStatisticsInsights(filteredGames, filteredAchievements),
    [filteredGames, filteredAchievements]
  );
  const activity = useMemo(
    () => groupUnlockActivity(insights.datedUnlocks, activityRange),
    [insights.datedUnlocks, activityRange]
  );

  if (state.status === "loading") return <LoadingView />;
  if (state.status === "error") {
    return <ErrorView message={t("statistics.loadError")} onRetry={() => location.reload()} />;
  }
  if (state.status !== "success" || state.data.games.length === 0) {
    return <EmptyView title={t("statistics.empty")} description={t("statistics.emptyDescription")} />;
  }

  const dataStatus = insights.quality.errors || insights.quality.partial || insights.quality.unsupported
    ? "partial"
    : insights.quality.notSynced === insights.totalGames
      ? "notSynced"
      : "complete";

  return (
    <section className="content-page statistics-v2">
      <PageHeader
        eyebrow={t("statistics.eyebrow")}
        title={t("statistics.title")}
        description={t("statistics.description")}
        action={<div className="statistics-v2__header-meta">
          <StatusBadge tone={dataStatus === "complete" ? "success" : dataStatus === "partial" ? "warning" : "neutral"}>
            {t(`statistics.dataStatus.${dataStatus}`)}
          </StatusBadge>
          {insights.quality.lastSuccessfulSync && (
            <span>{t("statistics.lastUpdated", {
              date: date.format(new Date(insights.quality.lastSuccessfulSync))
            })}</span>
          )}
        </div>}
      />

      {(dataStatus === "partial" || insights.quality.unsupported > 0) && (
        <p className="statistics-v2__data-note" role="status">{t("statistics.partialNote")}</p>
      )}

      <div className="statistics-v2__filters" role="group" aria-label={t("statistics.filters.label")}>
        {(["all", "completed", "progress", "notStarted", "favorites"] as const).map((value) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {t(`statistics.filters.${value}`)}
          </button>
        ))}
      </div>

      {filteredGames.length === 0 ? (
        <EmptyView compact title={t("statistics.noFilteredGames")} description={t("statistics.noFilteredGamesDescription")} />
      ) : <>
        <section aria-labelledby="statistics-overview">
          <SectionHeader title={t("statistics.overview")} description={t("statistics.overviewDescription")} />
          <div className="statistics-v2__metrics">
            <Metric icon={Library} label={t("statistics.totalGames")} value={number.format(insights.totalGames)} />
            <Metric icon={Target} label={t("statistics.gamesWithAchievements")} value={number.format(insights.gamesWithAchievements)} />
            {insights.totalAchievements !== undefined && <Metric icon={Trophy} label={t("statistics.totalAchievements")} value={number.format(insights.totalAchievements)} />}
            {insights.unlockedAchievements !== undefined && <Metric icon={CheckCircle2} label={t("statistics.unlockedAchievements")} value={number.format(insights.unlockedAchievements)} />}
            {insights.overallCompletion !== undefined && <Metric icon={BarChart3} label={t("statistics.overallCompletion")} value={`${number.format(insights.overallCompletion)}%`} />}
            {insights.rareAchievementsUnlocked !== undefined && <Metric icon={Gem} label={t("statistics.rareUnlocks")} value={number.format(insights.rareAchievementsUnlocked)} />}
            <Metric icon={CheckCircle2} label={t("statistics.completedGames")} value={number.format(insights.completedGames.length)} />
            <Metric icon={Clock3} label={t("statistics.totalPlaytime")} value={formatDuration(insights.totalPlaytimeHours, language, t)} />
          </div>
        </section>

        <div className="statistics-v2__primary-grid">
          <Surface as="section" className="statistics-v2__chart-card" aria-label={t("statistics.completionDistribution")}>
            <SectionHeader title={t("statistics.completionDistribution")} description={t("statistics.completionDescription")} />
            {insights.completionBuckets.some((bucket) => bucket.count > 0)
              ? <CompletionDistribution buckets={insights.completionBuckets} total={insights.completionBuckets.reduce((sum, item) => sum + item.count, 0)} number={number} t={t} />
              : <InlineEmpty text={t("statistics.noCompletionData")} />}
          </Surface>

          <Surface as="section" className="statistics-v2__chart-card" aria-label={t("statistics.achievementActivity")}>
            <SectionHeader
              title={t("statistics.achievementActivity")}
              description={t("statistics.activityDescription")}
              action={<select aria-label={t("statistics.activityRange")} value={activityRange} onChange={(event) => setActivityRange(event.target.value as UnlockActivityRange)}>
                {(["30d", "6m", "12m", "all"] as const).map((range) => <option key={range} value={range}>{t(`statistics.range.${range}`)}</option>)}
              </select>}
            />
            {activity.length
              ? <UnlockActivityChart data={activity} language={language} number={number} t={t} />
              : <InlineEmpty text={t("statistics.noUnlockDates")} />}
          </Surface>
        </div>

        <section aria-labelledby="almost-completed">
          <SectionHeader title={t("statistics.almostCompleted")} description={t("statistics.almostCompletedDescription")} />
          {insights.almostCompleted.length
            ? <div className="statistics-v2__game-list">{insights.almostCompleted.map((game) => (
              <button key={game.id} type="button" onClick={() => onOpenGame(game.id)} className="statistics-v2__game-row">
                <GameArtwork src={game.coverUrl} sources={game.platform === "steam" ? steamArtworkSources({ appId: game.appId, kind: "cover", storedUrl: game.coverUrl, iconUrl: game.iconUrl }) : undefined} alt="" variant="cover" appId={game.platform === "steam" ? game.appId : undefined} componentName="StatisticsGameRow" />
                <span><strong dir="auto" title={game.name}>{game.name}</strong><small>{t("statistics.remaining", { count: Math.max(0, game.totalAchievements - game.unlockedAchievements) })}</small></span>
                <span className="statistics-v2__game-progress"><ProgressBar value={game.completionPercentage} label={t("statistics.completionFor", { name: game.name })} /><small>{number.format(game.unlockedAchievements)}/{number.format(game.totalAchievements)}</small></span>
                <b>{number.format(game.completionPercentage)}%</b>
              </button>
            ))}</div>
            : <InlineEmpty text={t("statistics.noAlmostCompleted")} />}
        </section>

        <div className="statistics-v2__insights-grid">
          <Surface as="section">
            <SectionHeader title={t("statistics.rareInsights")} description={t("statistics.rareDescription")} />
            {insights.topRareUnlocked.length ? <>
              <div className="statistics-v2__summary-line">
                <span>{t("statistics.rarestUnlocked")}</span>
                <strong dir="auto">{insights.rarestUnlocked?.title}</strong>
                <b>{number.format(knownAchievementRarity(insights.rarestUnlocked!)!)}%</b>
              </div>
              {insights.averageUnlockedRarity !== undefined && <p>{t("statistics.averageRarity", { value: number.format(insights.averageUnlockedRarity) })}</p>}
              <div className="statistics-v2__achievement-list">{insights.topRareUnlocked.map((achievement) => {
                const game = insights.gameById.get(achievement.gameId);
                return <div key={achievement.id}>
                  <img src={achievement.iconUrl} alt="" loading="lazy" decoding="async" />
                  <span><strong dir="auto">{achievement.title}</strong><small dir="auto">{game?.name}</small></span>
                  <b>{number.format(knownAchievementRarity(achievement)!)}%</b>
                </div>;
              })}</div>
            </> : <InlineEmpty text={t("statistics.noRareAchievements")} />}
          </Surface>

          <Surface as="section">
            <SectionHeader title={t("statistics.playtimeInsights")} description={t("statistics.playtimeDescription")} />
            {insights.mostPlayedGame ? <>
              <div className="statistics-v2__summary-line">
                <span>{t("statistics.mostPlayed")}</span>
                <strong dir="auto">{insights.mostPlayedGame.name}</strong>
                <b>{formatDuration(insights.mostPlayedGame.playtimeHours, language, t)}</b>
              </div>
              {insights.averagePlaytimeHours !== undefined && <p>{t("statistics.averagePlaytime", { value: formatDuration(insights.averagePlaytimeHours, language, t) })}</p>}
              <ol className="statistics-v2__ranked-list">{insights.topPlayedGames.map((game) => (
                <li key={game.id}><button type="button" onClick={() => onOpenGame(game.id)}><span dir="auto">{game.name}</span><b>{formatDuration(game.playtimeHours, language, t)}</b></button></li>
              ))}</ol>
            </> : <InlineEmpty text={t("statistics.noPlaytime")} />}
          </Surface>

          <Surface as="section">
            <SectionHeader title={t("statistics.completedSection")} description={t("statistics.completedDescription")} />
            <div className="statistics-v2__large-value">{number.format(insights.completedGames.length)}</div>
            {insights.completedWithDates.length
              ? <ol className="statistics-v2__ranked-list">{insights.completedWithDates.slice(0, 5).map(({ game, completedAt }) => (
                <li key={game.id}><button type="button" onClick={() => onOpenGame(game.id)}><span dir="auto">{game.name}</span><time dateTime={completedAt}>{date.format(new Date(completedAt))}</time></button></li>
              ))}</ol>
              : <p>{t("statistics.noReliableCompletionDates")}</p>}
          </Surface>

          {insights.achievementsPerHour !== undefined && <Surface as="section">
            <SectionHeader title={t("statistics.efficiency")} description={t("statistics.efficiencyDescription")} />
            <div className="statistics-v2__large-value">{number.format(insights.achievementsPerHour)}</div>
            <p>{t("statistics.efficiencyUnit")}</p>
          </Surface>}
        </div>

        <Surface as="section" className="statistics-v2__quality">
          <SectionHeader
            title={t("statistics.dataQuality")}
            description={t("statistics.dataQualityDescription")}
            action={(insights.quality.errors > 0 || insights.quality.notSynced > 0) &&
              <button type="button" className="secondary-button" onClick={onOpenSettings}>{t("statistics.openSteamSettings")}</button>}
          />
          <div>
            <QualityItem label={t("statistics.fullySynced")} value={insights.quality.fullySynced} tone="success" />
            <QualityItem label={t("statistics.partialGames")} value={insights.quality.partial} tone="warning" />
            <QualityItem label={t("statistics.unsupportedGames")} value={insights.quality.unsupported} tone="neutral" />
            <QualityItem label={t("statistics.syncErrors")} value={insights.quality.errors} tone="error" />
            <QualityItem label={t("statistics.notSynced")} value={insights.quality.notSynced} tone="neutral" />
          </div>
        </Surface>
      </>}
    </section>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Library; label: string; value: string }) {
  return <Surface className="statistics-v2__metric"><Icon aria-hidden="true" /><span>{label}</span><strong>{value}</strong></Surface>;
}

function CompletionDistribution({ buckets, total, number, t }: {
  buckets: ReturnType<typeof calculateStatisticsInsights>["completionBuckets"];
  total: number;
  number: Intl.NumberFormat;
  t: (key: string, variables?: Record<string, string | number>) => string;
}) {
  const summary = buckets.map((item) => `${t(`statistics.bucket.${item.key}`)}: ${item.count}`).join(", ");
  return <div className="statistics-v2__distribution" role="img" aria-label={t("statistics.completionSummary", { summary })}>
    <div className="statistics-v2__distribution-bars">{buckets.map((item) => (
      <div key={item.key} title={`${t(`statistics.bucket.${item.key}`)}: ${item.count}`}>
        <span style={{ blockSize: `${Math.max(4, total ? item.count / total * 100 : 0)}%` }} />
        <b>{number.format(item.count)}</b>
        <small>{t(`statistics.bucket.${item.key}`)}</small>
      </div>
    ))}</div>
    <p className="sr-only">{summary}</p>
  </div>;
}

function UnlockActivityChart({ data, language, number, t }: {
  data: Array<{ key: string; count: number }>;
  language: string;
  number: Intl.NumberFormat;
  t: (key: string, variables?: Record<string, string | number>) => string;
}) {
  const maximum = Math.max(...data.map((item) => item.count), 1);
  const summary = data.map((item) => `${formatActivityKey(item.key, language)}: ${item.count}`).join(", ");
  return <div className="statistics-v2__activity" role="img" aria-label={t("statistics.activitySummary", { summary })}>
    {data.map((item) => <div key={item.key} title={`${formatActivityKey(item.key, language)}: ${item.count}`}>
      <span style={{ blockSize: `${Math.max(5, item.count / maximum * 100)}%` }} />
      <b>{number.format(item.count)}</b>
      <small>{formatActivityKey(item.key, language)}</small>
    </div>)}
    <p className="sr-only">{summary}</p>
  </div>;
}

function QualityItem({ label, value, tone }: { label: string; value: number; tone: "success" | "warning" | "neutral" | "error" }) {
  return <div><StatusBadge tone={tone}>{value}</StatusBadge><span>{label}</span></div>;
}

function InlineEmpty({ text }: { text: string }) {
  return <p className="statistics-v2__inline-empty">{text}</p>;
}

function matchesFilter(game: Game, filter: StatisticsFilter) {
  if (filter === "completed") return game.completionPercentage === 100;
  if (filter === "progress") return game.completionPercentage > 0 && game.completionPercentage < 100;
  if (filter === "notStarted") return game.playtimeHours === 0;
  if (filter === "favorites") return Boolean(game.favorite);
  return true;
}

function formatDuration(hours: number, language: string, t: (key: string, variables?: Record<string, string | number>) => string) {
  const minutes = Math.max(0, Math.round(hours * 60));
  const formatter = new Intl.NumberFormat(language);
  return t("statistics.duration", {
    hours: formatter.format(Math.floor(minutes / 60)),
    minutes: formatter.format(minutes % 60)
  });
}

function formatActivityKey(key: string, language: string) {
  const date = new Date(key.length === 7 ? `${key}-01T00:00:00Z` : `${key}T00:00:00Z`);
  return new Intl.DateTimeFormat(language, key.length === 7
    ? { month: "short", year: "2-digit", timeZone: "UTC" }
    : { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}
