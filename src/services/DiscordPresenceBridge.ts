import { invoke } from "@tauri-apps/api/core";
import type { UserPreferences } from "../types";
import { isTauriRuntime } from "../runtime/environment";

export type DiscordPresenceStatus = {
  availability: "unconfigured" | "disabled" | "idle" | "connecting" | "connected" | "retrying" | "disconnected";
  currentActivity: "game" | "none";
  queuedUpdates: number;
};

const browserStatus: DiscordPresenceStatus = {
  availability: "unconfigured",
  currentActivity: "none",
  queuedUpdates: 0
};

function settingsFromPreferences(preferences: UserPreferences) {
  return {
    enabled: preferences.discordPresenceEnabled,
    showGameName: preferences.discordShowGameName,
    showAchievementProgress: preferences.discordShowAchievementProgress,
    showSessionDuration: preferences.discordShowSessionDuration
  };
}

export const discordPresenceBridge = {
  async configure(preferences: UserPreferences): Promise<DiscordPresenceStatus> {
    if (!isTauriRuntime()) return browserStatus;
    return invoke<DiscordPresenceStatus>("discord_presence_configure", {
      settings: settingsFromPreferences(preferences)
    });
  },

  async refresh(): Promise<void> {
    if (!isTauriRuntime()) return;
    await invoke("discord_presence_refresh");
  },

  async status(): Promise<DiscordPresenceStatus> {
    if (!isTauriRuntime()) return browserStatus;
    return invoke<DiscordPresenceStatus>("discord_presence_status");
  }
};
