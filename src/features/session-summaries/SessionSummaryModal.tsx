import { useEffect, useMemo, useRef } from "react";
import { ArrowRight, Check, Clock3, Trophy, X } from "lucide-react";
import { AchievementIcon } from "../../components/ui/AchievementIcon";
import { GameArtwork } from "../../components/ui/GameArtwork";
import { GlassSurface } from "../../components/ui/NexusGlass";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { useTranslation } from "../../i18n/TranslationContext";
import type { GameSessionSummary } from "../../services/GameSessionSummaryStore";
import { formatSessionSummaryDuration, sessionSummaryPluralKey } from "./sessionSummaryFormatting";

const visibleAchievementLimit = 4;

export function SessionSummaryModal({
  summary,
  pendingCount,
  onDone,
  onViewGame
}: {
  summary: GameSessionSummary;
  pendingCount: number;
  onDone: () => void;
  onViewGame: () => void;
}) {
  const { language, t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const number = useMemo(() => new Intl.NumberFormat(language), [language]);
  const visibleAchievements = summary.achievementsUnlocked.slice(0, visibleAchievementLimit);
  const remainingAchievements = Math.max(0, summary.unlockedCount - visibleAchievements.length);
  const progressReady = summary.progressBefore && summary.progressAfter;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const heading = headingRef.current;
    requestAnimationFrame(() => heading?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDoneRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex='-1'])"
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [summary.sessionId]);

  return (
    <div className="session-summary-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onDone();
    }}>
      <div
        ref={dialogRef}
        className="session-summary-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-summary-title"
        aria-describedby="session-summary-description"
      >
      <GlassSurface as="div" variant="strong" className="session-summary-modal">
        {summary.backgroundUrl && <GameArtwork
          src={summary.backgroundUrl}
          alt=""
          variant="background"
          className="session-summary-modal__ambient"
          appId={summary.appId}
          componentName="SessionSummaryAmbient"
        />}
        <button className="session-summary-modal__close" type="button" onClick={onDone} aria-label={t("sessionSummary.close")}><X /></button>
        <header className="session-summary-modal__header">
          <GameArtwork
            src={summary.coverUrl ?? ""}
            alt={t("sessionSummary.coverAlt", { game: summary.gameName || t("gameSession.unknownGame") })}
            variant="cover"
            className="session-summary-modal__cover"
            eager
            appId={summary.appId}
            componentName="SessionSummaryCover"
          />
          <div>
            <span className="session-summary-modal__eyebrow"><Check />{t("sessionSummary.complete")}</span>
            <h2 id="session-summary-title" ref={headingRef} tabIndex={-1} dir="auto">{summary.gameName || t("gameSession.unknownGame")}</h2>
            <p id="session-summary-description"><Clock3 />{t("sessionSummary.duration", { duration: formatSessionSummaryDuration(summary.durationSeconds, language, t) })}</p>
            {pendingCount > 1 && <small>{t("sessionSummary.pending", { count: number.format(pendingCount - 1) })}</small>}
          </div>
        </header>

        {visibleAchievements.length > 0 && <section className="session-summary-modal__content" aria-labelledby="session-summary-achievements">
          <div className="session-summary-modal__section-title">
            <Trophy aria-hidden="true" />
            <h3 id="session-summary-achievements">{t(sessionSummaryPluralKey("sessionSummary.achievements", summary.unlockedCount, language), { count: number.format(summary.unlockedCount) })}</h3>
          </div>
          <ol className="session-summary-modal__achievements">
            {visibleAchievements.map((achievement) => <li key={achievement.achievementId}>
              <AchievementIcon src={achievement.iconUrl} alt={t("achievements.iconAlt", { title: achievement.name })} size="compact" />
              <span><strong dir="auto">{achievement.name}</strong>{achievement.description && <small dir="auto">{achievement.description}</small>}</span>
              {typeof achievement.rarityPercentage === "number" && <b>{t("sessionSummary.rarity", { value: new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(achievement.rarityPercentage) })}</b>}
            </li>)}
          </ol>
          {remainingAchievements > 0 && <p className="session-summary-modal__more">{t("sessionSummary.more", { count: number.format(remainingAchievements) })}</p>}
        </section>}

        {progressReady && <section className="session-summary-modal__content session-summary-modal__progress" aria-labelledby="session-summary-progress">
          <div>
            <h3 id="session-summary-progress">{t("sessionSummary.progress")}</h3>
            <strong dir="ltr">{number.format(summary.progressBefore!.unlocked)} → {number.format(summary.progressAfter!.unlocked)} / {number.format(summary.progressAfter!.total)}</strong>
          </div>
          <ProgressBar value={summary.progressAfter!.completionPercentage} label={t("sessionSummary.progressLabel", { game: summary.gameName })} showValue />
        </section>}

        <footer>
          {summary.gameId && <button type="button" className="secondary-button" onClick={onViewGame}>{t("sessionSummary.viewGame")}<ArrowRight /></button>}
          <button type="button" className="primary-button" onClick={onDone}>{t("sessionSummary.done")}</button>
        </footer>
      </GlassSurface>
      </div>
    </div>
  );
}
