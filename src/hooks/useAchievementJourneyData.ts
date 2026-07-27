import { useCallback, useEffect, useState } from "react";
import { getAchievementJourneySource } from "../services/dashboardService";
import type { AchievementJourneySource } from "../services/intelligence/achievementJourneyAdapter";
import type { AsyncState } from "../types";
import { useLibraryRevision } from "./useLibraryRevision";

export function useAchievementJourneyData() {
  const libraryRevision = useLibraryRevision();
  const [state, setState] = useState<AsyncState<AchievementJourneySource>>({ status: "loading" });
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const data = await getAchievementJourneySource();
      setState(data.games.length ? { status: "success", data } : { status: "empty" });
    } catch {
      setState({ status: "error", error: "journey.loadError" });
    }
  }, [libraryRevision]);
  useEffect(() => { void load(); }, [load]);
  return { state, retry: load };
}
