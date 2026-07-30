import { useEffect, useState } from "react";
import type { AsyncState } from "../types";
import { subscribeToApplicationRefresh } from "../services/dataEvents";

export function useAsyncData<T>(loader: () => Promise<T>, dependencies: readonly unknown[] = []) {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const [refreshRevision, setRefreshRevision] = useState(0);
  useEffect(() => subscribeToApplicationRefresh(
    () => setRefreshRevision((value) => value + 1)
  ), []);
  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    loader().then((data) => active && setState(Array.isArray(data) && data.length === 0 ? { status: "empty" } : { status: "success", data }))
      .catch((error: unknown) => active && setState({ status: "error", error: error instanceof Error ? error.message : "Unable to load data." }));
    return () => { active = false; };
    // Dependencies are supplied by the caller to control reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, refreshRevision]);
  return state;
}
