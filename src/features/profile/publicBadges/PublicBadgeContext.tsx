import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PublicBadgeState } from "./PublicBadgeStore";
import { PublicBadgeStore } from "./PublicBadgeStore";

const PublicBadgeContext = createContext<{
  state: PublicBadgeState;
  retry: () => void;
}>({ state: { status: "idle" }, retry: () => undefined });

export function PublicBadgeProvider({
  store,
  children
}: { store?: PublicBadgeStore; children: ReactNode }) {
  const [state, setState] = useState<PublicBadgeState>(
    store?.getState() ?? { status: "idle" }
  );
  useEffect(() => {
    if (!store) return;
    const unsubscribe = store.subscribe(setState);
    store.start();
    setState(store.getState());
    return () => {
      unsubscribe();
      store.stop();
    };
  }, [store]);
  const value = useMemo(() => ({
    state,
    retry: () => void store?.retry()
  }), [state, store]);
  return <PublicBadgeContext.Provider value={value}>{children}</PublicBadgeContext.Provider>;
}

export function usePublicBadges() {
  return useContext(PublicBadgeContext);
}
