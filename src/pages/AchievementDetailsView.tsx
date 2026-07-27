import { AchievementDetailsDialog } from "../components/achievements/AchievementDetailsDialog";
import { ErrorView, LoadingView } from "../components/ui/StateViews";
import { useAsyncData } from "../hooks/useAsyncData";
import { services } from "../services/compositionRoot";
import type { AchievementId, GameId } from "../types";

export function AchievementDetailsView({ achievementId, onClose, onOpenGame }: { achievementId: AchievementId; onClose: () => void; onOpenGame: (id: GameId) => void }) {
  const state = useAsyncData(() => services.achievements.details(achievementId), [achievementId]);
  if (state.status === "loading") return <div className="dialog-backdrop"><div className="dialog-loading"><LoadingView size="sm" label="Loading achievement" delay={120} /></div></div>;
  if (state.status === "error") return <div className="dialog-backdrop"><div className="dialog-loading"><ErrorView message={state.error} onRetry={onClose} /></div></div>;
  if (state.status !== "success" || !state.data) return null;
  const details = state.data;
  return <AchievementDetailsDialog details={details} onClose={onClose} onOpenGame={() => onOpenGame(details.gameId)} />;
}
