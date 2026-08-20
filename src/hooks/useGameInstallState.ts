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
 */
export function useGameInstallState(appId?: string, ownership: GameOwnership = "unknown") {
  const [snapshot, setSnapshot] = useState<GameLaunchSnapshot>(() => gameLauncher.getSnapshot(appId ?? ""));
  useEffect(() => {
    if (!appId) return;
    const unsubscribe = gameLauncher.subscribe(appId, setSnapshot);
    void gameLauncher.refresh(appId, ownership);
    return unsubscribe;
  }, [appId, ownership]);
  return snapshot;
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
