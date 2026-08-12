import { useCallback, useEffect, useRef, useState } from "react";
import type { AsyncState } from "../types";
import { subscribeToApplicationRefresh } from "../services/dataEvents";
import { classifyAsyncError } from "./asyncErrorCategory";
import { reportDiagnostic } from "../runtime/diagnostics";
import { createAsyncRequestGate, invokeAsyncLoader } from "./asyncRequestGate";

/**
 * Loads data for a page and exposes a retry that reloads only this hook.
 *
 * Two rules keep the state honest:
 * - `error` carries an internal category, never a message. The page turns the
 *   category into translated text, so no backend string or exception message can
 *   reach the screen and the hook stays free of i18n.
 * - Only the newest request may write. A stale response from a superseded load
 *   is dropped instead of overwriting fresh data, and nothing writes after
 *   unmount.
 */
export function useAsyncData<T>(loader: () => Promise<T>, dependencies: readonly unknown[] = []) {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const [hasLoaded, setHasLoaded] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [retryRevision, setRetryRevision] = useState(0);
  const requestGate = useRef(createAsyncRequestGate());
  useEffect(() => subscribeToApplicationRefresh(
    () => setRefreshRevision((value) => value + 1)
  ), []);
  useEffect(() => {
    const current = requestGate.current.begin();
    // A superseded or unmounted load must not write, so both checks are the same
    // check: is this still the request the hook is waiting for?
    const isCurrent = () => requestGate.current.isCurrent(current);
    if (!hasLoaded) setState({ status: "loading" });
    invokeAsyncLoader(loader).then((data) => {
      if (!isCurrent()) return;
      setHasLoaded(true);
      setState(Array.isArray(data) && data.length === 0 ? { status: "empty" } : { status: "success", data });
    }).catch((error: unknown) => {
      // An abort is the hook's own cleanup, not a failure to show or log.
      if (error instanceof Error && error.name === "AbortError") return;
      const category = classifyAsyncError(error);
      reportDiagnostic({ scope: "async_data", category: diagnosticCategory(category) });
      if (isCurrent()) setState({ status: "error", error: category });
    });
    return () => requestGate.current.cancel(current);
    // Dependencies are supplied by the caller to control reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, refreshRevision, retryRevision]);
  // Reloads this hook only. A full page reload would throw away the Steam
  // session state, the theme and every other loaded page.
  const retry = useCallback(() => setRetryRevision((value) => value + 1), []);
  return { ...state, retry } as AsyncState<T> & { retry: () => void };
}

function diagnosticCategory(category: ReturnType<typeof classifyAsyncError>) {
  switch (category) {
    case "network": return "network" as const;
    case "unauthorized": return "unauthorized" as const;
    case "forbidden": return "forbidden" as const;
    case "account_not_active": return "account_not_active" as const;
    case "malformed": return "malformed_payload" as const;
    case "server": return "server_error" as const;
    case "domain": return "domain_error" as const;
    default: return "unknown" as const;
  }
}
