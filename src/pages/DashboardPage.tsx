import { useMemo } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Flame,
  Gamepad2,
  Library,
  Sparkles,
  Target,
  Trophy
} from "lucide-react";
import { analyzeAchievementJourney } from "../intelligence/index.ts";
import { useTranslation } from "../i18n/TranslationContext";
import { useAchievementJourneyData } from "../hooks/useAchievementJourneyData";
import {
  toAchievementJourneyInput,
  createLibrarySnapshot,
  toJourneyGameCard
} from "../services/intelligence/achievementJourneyAdapter";
import { GameCard } from "../components/games/GameCard";
import { EmptyView, ErrorView } from "../components/ui/StateViews";
import { AchievementIcon } from "../components/ui/AchievementIcon";
import { ProgressBar } from "../components/ui/ProgressBar";
import { SectionHeader } from "../components/ui/SectionHeader";
import { Skeleton } from "../components/ui/Skeleton";
import { StatusBadge } from "../components/ui/StatusBadge";
import { Surface } from "../components/ui/Surface";
import type { AchievementId, GameId } from "../types";

type DashboardPageProps = {
  search: string;
  onOpenGame: (id: GameId) => void;
  onOpenAchievement: (id: AchievementId, gameId: GameId) => void;
};

export function DashboardPage({ search, onOpenGame, onOpenAchievement }: DashboardPageProps) {
  const { language, t } = useTranslation();
  const { state, retry } = useAchievementJourneyData();
  const source = state.status === "success" ? state.data : null;
  const intelligence = useMemo(
    () => source ? {
      analysis: analyzeAchievementJourney(toAchievementJourneyInput(source)),
      snapshot: createLibrarySnapshot(source.games)
    } : null,
    [source]
  );

  if (state.status === "loading") return <AchievementJourneySkeleton />;
  if (state.status === "error") return <ErrorView message={t(state.error)} onRetry={retry} />;
  if (state.status === "empty" || !source || !intelligence) {
    return <EmptyView title={t("journey.emptyTitle")} description={t("journey.emptyDescription")} />;
  }

  const { analysis, snapshot } = intelligence;
  const gameById = new Map(source.games.map((game) => [game.id, game]));
  const achievementById = new Map(source.achievements.map((achievement) => [achievement.id, achievement]));
  const continueGames = analysis.rankedGames
    .filter((ranked) => ranked.eligible && ranked.score > 0)
    .filter((ranked) => ranked.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .slice(0, 4);
  const next = analysis.nextAchievement;
  const nextAchievement = next ? achievementById.get(next.achievementId) : undefined;
  const nextGame = next ? gameById.get(next.gameId) : undefined;
  const primaryJourney = analysis.journeyCards[0];
  const firstName = source.profile.displayName.trim().split(/\s+/)[0] || source.profile.displayName;

  return (
    <div className="achievement-journey">
      <Surface className="journey-hero" elevation="elevated">
        <div className="journey-hero__glow" aria-hidden="true" />
        <div className="journey-hero__content">
          <span className="journey-eyebrow"><Sparkles size={14} />{t("journey.eyebrow")}</span>
          <p>{t("journey.welcome", { name: firstName })}</p>
          <h1 className="nexus-display-title">{t("journey.heroTitle")}</h1>
          <div className="journey-hero__summary">
            {primaryJourney
              ? t(primaryJourney.translationKey, primaryJourney.translationParams)
              : t("journey.heroInsufficient")}
          </div>
        </div>
        <StatusBadge tone="accent">
          {t("journey.analyzedGames", { count: formatNumber(analysis.rankedGames.length, language) })}
        </StatusBadge>
      </Surface>

      <section className="journey-section">
        <SectionHeader title={t("journey.continueTitle")} description={t("journey.continueDescription")} />
        {continueGames.length ? (
          <div className="journey-game-grid">
            {continueGames.map((ranked) => {
              const game = gameById.get(ranked.gameId);
              return game ? (
                <div className="journey-ranked-game" key={game.id}>
                  <StatusBadge tone="accent">{t("journey.score", { score: Math.round(ranked.score) })}</StatusBadge>
                  <GameCard game={toJourneyGameCard(game)} onOpen={onOpenGame} onViewDetails={onOpenGame} />
                </div>
              ) : null;
            })}
          </div>
        ) : (
          <Surface className="journey-inline-empty" elevation="subtle">{t("journey.noContinue")}</Surface>
        )}
      </section>

      <div className="journey-feature-grid">
        <Surface className="journey-next-achievement" elevation="default">
          <SectionHeader title={t("journey.nextTitle")} description={t("journey.nextDescription")} />
          {next && nextAchievement && nextGame ? (
            <button
              type="button"
              className="journey-achievement-button"
              onClick={() => onOpenAchievement(next.achievementId, next.gameId)}
            >
              <AchievementIcon src={nextAchievement.iconUrl} alt={`${nextAchievement.title} achievement icon`} className="journey-achievement-art" />
              <div>
                <span dir="auto">{nextGame.name}</span>
                <h2 dir="auto">{nextAchievement.title}</h2>
                <p>{t(next.translationKey)}</p>
                {next.metadata.progressPercent !== null && (
                  <ProgressBar
                    value={next.metadata.progressPercent}
                    label={t("journey.achievementProgress")}
                    showValue
                  />
                )}
              </div>
            </button>
          ) : (
            <div className="journey-inline-empty">{t("journey.noNextAchievement")}</div>
          )}
        </Surface>

        <Surface className="journey-dna" elevation="default">
          <SectionHeader title={t("journey.dnaTitle")} description={t("journey.dnaDescription")} />
          <div className="journey-dna__mark"><Sparkles size={28} /></div>
          <StatusBadge tone={analysis.achievementDna.confidence < 0.4 ? "neutral" : "accent"}>
            {t(analysis.achievementDna.translationKey)}
          </StatusBadge>
          {analysis.achievementDna.secondaryType && (
            <span className="journey-dna__secondary">
              {t("journey.secondaryDna", { type: t(`intelligence.dna.${analysis.achievementDna.secondaryType}`) })}
            </span>
          )}
          <p>{analysis.achievementDna.confidence < 0.4
            ? t("journey.dnaInsufficient")
            : t(`journey.dnaReason.${analysis.achievementDna.primaryType}`)}</p>
          <ProgressBar
            value={analysis.achievementDna.confidence * 100}
            label={t("journey.confidence")}
            showValue
          />
        </Surface>
      </div>

      <section className="journey-section">
        <SectionHeader title={t("journey.cardsTitle")} description={t("journey.cardsDescription")} />
        {analysis.journeyCards.length ? (
          <div className="journey-cards-grid">
            {analysis.journeyCards.slice(0, 4).map((card) => (
              <Surface as="article" className="journey-insight-card" elevation="subtle" key={`${card.type}-${card.gameId}`}>
                <StatusBadge tone={card.type === "recentlyCompleted" ? "success" : "accent"}>
                  {t(`journey.cardType.${card.type}`)}
                </StatusBadge>
                <h3>{t(card.translationKey, card.translationParams)}</h3>
                <p>{t(`intelligence.reason.${card.reasonCode}`)}</p>
                <button type="button" onClick={() => onOpenGame(card.gameId)}>{t("journey.openGame")}</button>
              </Surface>
            ))}
          </div>
        ) : <Surface className="journey-inline-empty" elevation="subtle">{t("journey.noCards")}</Surface>}
      </section>

      <div className="journey-feature-grid">
        <Surface className="journey-weekly" elevation="default">
          <SectionHeader title={t("journey.weeklyTitle")} description={t("journey.weeklyDescription")} />
          <div className="journey-metric-grid">
            <JourneyMetric icon={Clock3} label={t("journey.weeklyPlaytime")} value={source.capabilities.weeklyPlaytime ? formatMinutes(analysis.weeklyInsights.totalPlaytimeMinutes, language, t) : t("journey.unavailable")} />
            <JourneyMetric icon={Trophy} label={t("journey.weeklyAchievements")} value={formatNumber(analysis.weeklyInsights.achievementsUnlocked, language)} />
            <JourneyMetric icon={Gamepad2} label={t("journey.weeklyGames")} value={formatNumber(analysis.weeklyInsights.gamesPlayed, language)} />
            <JourneyMetric icon={CalendarDays} label={t("journey.activeDays")} value={formatNumber(analysis.weeklyInsights.activeDays, language)} />
            <JourneyMetric icon={Flame} label={t("journey.streak")} value={t("journey.days", { count: formatNumber(analysis.weeklyInsights.streakDays, language) })} />
            <JourneyMetric icon={Target} label={t("journey.weekChange")} value={analysis.weeklyInsights.changeComparedToPreviousWeek === null ? t("journey.unavailable") : `${analysis.weeklyInsights.changeComparedToPreviousWeek > 0 ? "+" : ""}${formatNumber(analysis.weeklyInsights.changeComparedToPreviousWeek, language)}%`} />
          </div>
        </Surface>

        <Surface className="journey-library" elevation="default">
          <SectionHeader title={t("journey.libraryTitle")} description={t("journey.libraryDescription")} />
          <div className="journey-metric-grid">
            <JourneyMetric icon={Library} label={t("journey.totalGames")} value={formatNumber(snapshot.totalGames, language)} />
            <JourneyMetric icon={CheckCircle2} label={t("journey.completedGames")} value={formatNumber(snapshot.completedGames, language)} />
            <JourneyMetric icon={Target} label={t("journey.averageCompletion")} value={`${formatNumber(Math.round(snapshot.averageCompletion), language)}%`} />
            <JourneyMetric icon={Clock3} label={t("journey.totalPlaytime")} value={formatMinutes(snapshot.totalPlaytimeMinutes, language, t)} />
            <JourneyMetric icon={Gamepad2} label={t("journey.unstartedGames")} value={formatNumber(snapshot.unstartedGames, language)} />
          </div>
        </Surface>
      </div>
    </div>
  );
}

function JourneyMetric({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) {
  return <div className="journey-metric"><Icon size={17} /><span>{label}</span><strong>{value}</strong></div>;
}

function AchievementJourneySkeleton() {
  return (
    <div className="achievement-journey" aria-hidden="true">
      <Surface className="journey-hero"><Skeleton width="24%" height="14px" /><Skeleton width="68%" height="48px" /><Skeleton width="52%" height="16px" /></Surface>
      <div className="journey-skeleton-grid">{Array.from({ length: 4 }, (_, index) => <Surface key={index}><Skeleton width="100%" height="250px" /><Skeleton width="70%" height="18px" /></Surface>)}</div>
      <div className="journey-feature-grid"><Surface><Skeleton width="55%" height="24px" /><Skeleton width="100%" height="180px" /></Surface><Surface><Skeleton width="55%" height="24px" /><Skeleton width="100%" height="180px" /></Surface></div>
    </div>
  );
}

function formatNumber(value: number, language: string) {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value);
}

function formatMinutes(
  minutes: number,
  language: string,
  t: (key: string, variables?: Record<string, string | number>) => string
) {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours <= 0) return t("journey.minutes", { minutes: formatNumber(remaining, language) });
  return remaining
    ? t("journey.hoursMinutes", {
        hours: formatNumber(hours, language),
        minutes: formatNumber(remaining, language)
      })
    : t("journey.hours", { hours: formatNumber(hours, language) });
}
