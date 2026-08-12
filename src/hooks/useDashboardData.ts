import { useCallback, useEffect, useState } from "react";
import { getDashboardData } from "../services/dashboardService";
import type { AsyncState, DashboardData } from "../types";
import { classifyAsyncError } from "./asyncErrorCategory";

export function useDashboardData() {
  const [state, setState] = useState<AsyncState<DashboardData>>({ status: "loading" });
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const data = await getDashboardData();
      setState(data.games.length ? { status: "success", data } : { status: "empty" });
    } catch (error) {
      // A category, not a message. The page turns it into translated text, so no
      // exception string can reach the screen.
      setState({ status: "error", error: classifyAsyncError(error) });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { state, retry: load };
}
