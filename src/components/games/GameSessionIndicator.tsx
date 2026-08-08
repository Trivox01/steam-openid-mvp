import { useTranslation } from "../../i18n/TranslationContext";
import { formatSessionClock, useGameSession } from "../../hooks/useGameSession";

export function GameSessionIndicator({
  appId,
  className = ""
}: {
  appId: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const { isRunning, elapsedSeconds } = useGameSession(appId);
  if (!isRunning) return null;
  return (
    <div className={`nexus-session-indicator ${className}`.trim()} role="status" aria-live="polite" title={t("gameSession.nexusSessionTime")}>
      <span className="nexus-session-indicator__dot" aria-hidden="true" />
      <strong>{t("gameSession.playing")}</strong>
      <time>{formatSessionClock(elapsedSeconds)}</time>
    </div>
  );
}