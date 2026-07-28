import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { AuthorizationLoadState } from "./authorizationTypes";
import { AuthorizationStore } from "./AuthorizationStore";

const AuthorizationContext = createContext<{
  state: AuthorizationLoadState;
  retry: () => void;
} | null>(null);

export function AuthorizationProvider({
  store,
  children
}: {
  store?: AuthorizationStore;
  children: ReactNode;
}) {
  const [state, setState] = useState<AuthorizationLoadState>(
    store?.getState() ?? { status: "unauthorized" }
  );
  useEffect(() => {
    if (!store) {
      setState({ status: "unauthorized" });
      return;
    }
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
  return (
    <AuthorizationContext.Provider value={value}>
      {children}
    </AuthorizationContext.Provider>
  );
}

export function useAuthorization() {
  const value = useContext(AuthorizationContext);
  if (!value) {
    throw new Error("useAuthorization must be used within AuthorizationProvider");
  }
  return value;
}
