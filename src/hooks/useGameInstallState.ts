import { useEffect, useState } from "react";
import { gameLauncher } from "../services/compositionRoot";
import type { GameLaunchSnapshot, GameOwnership } from "../services/GameLauncherService";

/**
 * Read-only installation state for one Steam app.
 *
 * The hook mirrors the launcher snapshot so a surface can state the real
 * installation state instead of guessing one. It never launches a game, never
 * opens Steam and never opens the Steam installer: `act` and `openSteamInstaller`
 * stay with the action button that the user actually pressed.
 *
 * The snapshot is stored together with the app it belongs to. When the app
 * changes, or when there is no app at all, the state is resynchronised in the
 * same render from `gameLauncher.getSnapshot(appId ?? "")`, so one game's
 * installation state can never be shown for another and an absent app falls
 * back to the unknown snapshot instead of the previous game's.
 */
export function useGameInstallState(appId?: string, ownership: GameOwnership = "unknown") {
  const key = appId ?? "";
  const [state, setState] = useState<{ key: string; snapshot: GameLaunchSnapshot }>(() => ({
    key,
    snapshot: gameLauncher.getSnapshot(key)
  }));
  if (state.key !== key) {
    setState({ key, snapshot: gameLauncher.getSnapshot(key) });
  }
  useEffect(() => {
    if (!appId) return;
    const unsubscribe = gameLauncher.subscribe(appId, (snapshot) => setState({ key: appId, snapshot }));
    void gameLauncher.refresh(appId, ownership);
    return unsubscribe;
  }, [appId, ownership]);
  return state.snapshot;
}

/**
 * Translation key for the installation state, or `undefined` when the state is
 * not known well enough to claim anything on screen.
 */
export function gameInstallStateKey(snapshot: GameLaunchSnapshot) {
  switch (snapshot.availability) {
    case "installed": return "gameDetails.install.installed";
    case "running": return "gameDetails.install.running";
    case "owned_not_installed":
    case "not_installed": return "gameDetails.install.notInstalled";
    case "steam_not_installed": return "gameDetails.install.steamMissing";
    case "steam_unavailable": return "gameDetails.install.steamUnavailable";
    default: return undefined;
  }
}
