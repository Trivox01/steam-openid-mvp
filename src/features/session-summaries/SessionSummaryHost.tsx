import { useCallback, useEffect, useState } from "react";
import type { GameId } from "../../types";
import { gameSessionSummaryStore } from "../../services/compositionRoot";
import { SessionSummaryModal } from "./SessionSummaryModal";

export function SessionSummaryHost({ onOpenGame }: { onOpenGame: (gameId: GameId) => void }) {
  const [, setRevision] = useState(0);
  useEffect(() => gameSessionSummaryStore.subscribe(() => setRevision((value) => value + 1)), []);
  const summary = gameSessionSummaryStore.active();
  const dismiss = useCallback(() => {
    const current = gameSessionSummaryStore.active();
    if (current) void gameSessionSummaryStore.dismiss(current.sessionId);
  }, []);
  if (!summary) return null;
  return <SessionSummaryModal
    summary={summary}
    pendingCount={gameSessionSummaryStore.pendingCount()}
    onDone={dismiss}
    onViewGame={() => {
      void gameSessionSummaryStore.dismiss(summary.sessionId);
      if (summary.gameId) onOpenGame(summary.gameId as GameId);
    }}
  />;
}
