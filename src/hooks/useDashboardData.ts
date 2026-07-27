import { useCallback, useEffect, useState } from "react";
import { getDashboardData } from "../services/dashboardService";
import type { AsyncState, DashboardData } from "../types";

export function useDashboardData() {
  const [state, setState] = useState<AsyncState<DashboardData>>({ status: "loading" });
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const data = await getDashboardData();
      setState(data.games.length ? { status: "success", data } : { status: "empty" });
    } catch (error) {
      setState({ status: "error", error: error instanceof Error ? error.message : "Unable to load your library." });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { state, retry: load };
}
