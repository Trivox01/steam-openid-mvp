import { memo, type CSSProperties, type MouseEvent } from "react";
import {
  Clock3,
  EyeOff,
  Heart,
  ListChecks,
  LoaderCircle,
  MoreHorizontal,
  Bookmark,
  RefreshCw,
} from "lucide-react";
import { useTranslation } from "../../i18n/TranslationContext";
import type { GameCardActions, GameCardData } from "../../types/gameCard";
import { GameArtwork } from "../ui/GameArtwork";
import { Skeleton } from "../ui/Skeleton";
import { StatusBadge } from "../ui/StatusBadge";
import { Surface } from "../ui/Surface";
import { steamArtworkSources } from "../../services/platform/steamArtwork";
import { GameActionButton } from "./GameActionButton";

type GameCardProps = GameCardActions & {
  game: GameCardData;
  className?: string;
};

type AccentStyle = CSSProperties & {
  "--game-accent-primary"?: string;
  "--game-accent-secondary"?: string;
  "--game-accent-text"?: string;
  "--game-background-dominant"?: string;
};

export const GameCard = memo(function GameCard({
  game,
  className,
  onOpen,
  onViewAchievements,
  onViewDetails,
  onFavoriteChange,
  onTrackedChange
}: GameCardProps) {
  const { language, t } = useTranslation();
  const completion = game.achievementCompletion;
  const isCompleted = completion === 100;
  const accentStyle: AccentStyle = game.accent ? {
    "--game-accent-primary": game.accent.accentPrimary,
    "--game-accent-secondary": game.accent.accentSecondary,
    "--game-accent-text": game.accent.accentText,
    "--game-background-dominant": game.accent.backgroundDominant
  } : {};

  return (
    <Surface
      as="article"
      elevation="default"
      className={[
        "nexus-game-card",
        game.hidden && "nexus-game-card--hidden",
        isCompleted && "nexus-game-card--completed",
        className
      ].filter(Boolean).join(" ")}
      style={accentStyle}
    >
      <button
        className="nexus-game-card__open-hitarea"
        type="button"
        aria-label={t("gameCard.openLabel", { title: game.title })}
        onClick={() => onOpen(game.id)}
      />
      <div className="nexus-game-card__media">
        <GameArtwork
          src={game.coverUrl}
          sources={game.platform === "steam" && game.platformGameId
            ? steamArtworkSources({ appId: game.platformGameId, kind: "cover", storedUrl: game.coverUrl, iconUrl: game.iconUrl })
            : undefined}
          alt={t("gameCard.coverAlt", { title: game.title })}
          variant="cover"
          className="nexus-game-card__artwork"
          appId={game.platform === "steam" ? game.platformGameId : undefined}
          componentName="GameCard"
        />
        <div className="nexus-game-card__media-gradient" aria-hidden="true" />
        <div className="nexus-game-card__badges">
          {game.syncState && <StatusBadge className={`nexus-game-card__sync-badge nexus-game-card__sync-badge--${game.syncState}`} tone={syncTone(game.syncState)} title={t(`gameCard.sync.${game.syncState}.tooltip`)}>{game.syncState==="needsUpdate"&&<RefreshCw size={12} aria-hidden="true"/>}{t(`gameCard.sync.${game.syncState}`)}</StatusBadge>}
          {game.tracked && <StatusBadge className="nexus-game-card__tracked-badge" tone="accent"><Bookmark size={11} />{t("gameCard.tracked")}</StatusBadge>}
          {game.hidden && <StatusBadge tone="neutral"><EyeOff size={12} />{t("gameCard.hidden")}</StatusBadge>}
        </div>
        {completion !== undefined && <ProgressRing value={completion} label={t("gameCard.completionLabel", { percent: Math.round(completion) })} />}
        {game.favorite && <Heart className="nexus-game-card__favorite-indicator" size={18} fill="currentColor" aria-label={t("gameCard.favorite")} />}
        <div className="nexus-game-card__hover-details">
          <div className="nexus-game-card__meta">
            <span><Clock3 size={13} />{formatPlaytime(game.playtimeMinutes, language, t)}</span>
          </div>
          <p className="nexus-game-card__last-played">
            {game.playtimeMinutes <= 0 || !game.lastPlayedAt || !Number.isFinite(new Date(game.lastPlayedAt).getTime())
              ? t("gameCard.neverPlayed")
              : t("gameCard.lastPlayed", { time: formatRelativeTime(game.lastPlayedAt, language) })}
          </p>
        </div>
        <QuickActions
          game={game}
          onOpen={onOpen}
          onViewAchievements={onViewAchievements}
          onViewDetails={onViewDetails}
          onFavoriteChange={onFavoriteChange}
          onTrackedChange={onTrackedChange}
        />
      </div>

      <div className="nexus-game-card__content">
        <div className="nexus-game-card__heading">
          <div>
            <span className="nexus-game-card__platform" dir="auto">{game.platform}</span>
            <h2 title={game.title} dir="auto">{game.title}</h2>
          </div>
        </div>
      </div>
    </Surface>
  );
});

export const GameCardCompact = memo(function GameCardCompact(props: GameCardProps) {
  const { game, className, ...actions } = props;
  return <GameCard game={game} className={["nexus-game-card--compact", className].filter(Boolean).join(" ")} {...actions} />;
});

function QuickActions({ game, onViewAchievements, onViewDetails, onFavoriteChange, onTrackedChange }: GameCardProps) {
  const { t } = useTranslation();
  const act = (event: MouseEvent<HTMLButtonElement>, action: () => void) => {
    event.stopPropagation();
    action();
  };
  return (
    <div className="nexus-game-card__quick-actions" role="group" aria-label={t("gameCard.quickActions")}>
      {game.platform === "steam" && <GameActionButton appId={game.platformGameId} title={game.title} owned={game.owned} compact />}
      {onTrackedChange && <button type="button" data-track-game-id={game.id} className={game.tracked ? "is-active" : ""} disabled={game.tracking} aria-busy={game.tracking || undefined} title={t(game.tracked ? "games.untrack" : "games.track", { title: game.title })} onClick={(event) => act(event, () => void onTrackedChange(game.id, !game.tracked))} aria-label={t(game.tracking ? "gameCard.trackProcessing" : game.tracked ? "games.untrack" : "games.track", { title: game.title })}>{game.tracking ? <LoaderCircle className="nexus-game-card__track-spinner" size={15} /> : <Bookmark size={15} fill={game.tracked ? "currentColor" : "none"} />}</button>}
      {onViewAchievements && <button type="button" onClick={(event) => act(event, () => onViewAchievements(game.id))} aria-label={t("gameCard.achievementsLabel", { title: game.title })}><ListChecks size={15} /></button>}
      {onViewDetails && <button type="button" onClick={(event) => act(event, () => onViewDetails(game.id))} aria-label={t("gameCard.detailsLabel", { title: game.title })}><MoreHorizontal size={16} /></button>}
      {onFavoriteChange && <button type="button" className={game.favorite ? "is-active" : ""} onClick={(event) => act(event, () => onFavoriteChange(game.id, !game.favorite))} aria-label={t(game.favorite ? "gameCard.removeFavoriteLabel" : "gameCard.addFavoriteLabel", { title: game.title })}><Heart size={15} fill={game.favorite ? "currentColor" : "none"} /></button>}
    </div>
  );
}

export function GameCardSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <Surface className={`nexus-game-card nexus-game-card--skeleton ${compact ? "nexus-game-card--compact" : ""}`} aria-hidden="true">
      <Skeleton className="nexus-game-card-skeleton__artwork" />
      <div className="nexus-game-card__content">
        <Skeleton width="34%" height="10px" />
        <Skeleton width="78%" height="20px" />
        <div className="nexus-game-card-skeleton__meta"><Skeleton width="30%" height="12px" /><Skeleton width="30%" height="12px" /></div>
        <Skeleton width="100%" height="6px" radius="999px" />
        <Skeleton width="48%" height="10px" />
      </div>
    </Surface>
  );
}

function syncTone(status: NonNullable<GameCardData["syncState"]>): "neutral" | "accent" | "success" | "warning" {
  if (status === "updated") return "success";
  if (status === "updating") return "accent";
  if (status === "needsUpdate") return "warning";
  return "neutral";
}

function ProgressRing({ value, label }: { value: number; label: string }) {
  const radius=15; const circumference=2*Math.PI*radius; const offset=circumference-(value/100)*circumference;
  return <span className="nexus-game-card__progress-ring" role="img" aria-label={label} title={label}>
    <svg viewBox="0 0 38 38" aria-hidden="true"><circle className="track" cx="19" cy="19" r={radius}/><circle className="value" cx="19" cy="19" r={radius} strokeDasharray={circumference} strokeDashoffset={offset}/></svg>
    <strong>{Math.round(value)}<small>%</small></strong>
  </span>;
}

function formatNumber(value: number, language: string) {
  return new Intl.NumberFormat(language).format(Math.max(0, value));
}

function formatPlaytime(minutes: number, language: string, t: (key: string, variables?: Record<string, string | number>) => string) {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const remaining = safeMinutes % 60;
  if (hours === 0) return t("gameCard.playtimeMinutes", { minutes: formatNumber(remaining, language) });
  if (remaining === 0) return t("gameCard.playtimeHours", { hours: formatNumber(hours, language) });
  return t("gameCard.playtimeHoursMinutes", {
    hours: formatNumber(hours, language),
    minutes: formatNumber(remaining, language)
  });
}

function formatRelativeTime(value: string, language: string) {
  const timestamp = new Date(value).getTime();
  const deltaSeconds = Math.round((timestamp - Date.now()) / 1000);
  const absolute = Math.abs(deltaSeconds);
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  if (absolute < 3600) return formatter.format(Math.round(deltaSeconds / 60), "minute");
  if (absolute < 86400) return formatter.format(Math.round(deltaSeconds / 3600), "hour");
  if (absolute < 2592000) return formatter.format(Math.round(deltaSeconds / 86400), "day");
  if (absolute < 31536000) return formatter.format(Math.round(deltaSeconds / 2592000), "month");
  return formatter.format(Math.round(deltaSeconds / 31536000), "year");
}
