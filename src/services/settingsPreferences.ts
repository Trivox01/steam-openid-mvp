import type { UserPreferences } from "../types";

export const defaultPreferences: UserPreferences = {
  theme: "dark",
  language: "en",
  onboardingCompleted: false,
  sidebarCollapsed: false,
  launchAtStartup: false,
  minimizeToTray: true,
  notificationsEnabled: true,
  achievementSoundEnabled: false,
  autoCheckForUpdates: true,
  updateChannel: "beta",
  hidePlaytime: false,
  hideHiddenGames: true
};

export function normalizePreferences(value: unknown): UserPreferences {
  const source = isRecord(value) ? value : {};
  return {
    theme: isTheme(source.theme) ? source.theme : defaultPreferences.theme,
    language: normalizeLanguage(source.language),
    onboardingCompleted: booleanOrDefault(
      source.onboardingCompleted,
      defaultPreferences.onboardingCompleted
    ),
    sidebarCollapsed: booleanOrDefault(source.sidebarCollapsed, defaultPreferences.sidebarCollapsed),
    launchAtStartup: booleanOrDefault(
      source.launchAtStartup,
      defaultPreferences.launchAtStartup
    ),
    minimizeToTray: booleanOrDefault(
      source.minimizeToTray,
      defaultPreferences.minimizeToTray
    ),
    notificationsEnabled: normalizeNotifications(source),
    achievementSoundEnabled: booleanOrDefault(source.achievementSoundEnabled, false),
    autoCheckForUpdates: booleanOrDefault(
      source.autoCheckForUpdates ?? source.automaticUpdates,
      defaultPreferences.autoCheckForUpdates
    ),
    updateChannel: "beta",
    hidePlaytime: booleanOrDefault(source.hidePlaytime, defaultPreferences.hidePlaytime),
    hideHiddenGames: booleanOrDefault(
      source.hideHiddenGames,
      defaultPreferences.hideHiddenGames
    )
  };
}

export function preferencesEqual(left: UserPreferences, right: UserPreferences) {
  return (
    left.theme === right.theme &&
    left.language === right.language &&
    left.onboardingCompleted === right.onboardingCompleted &&
    left.sidebarCollapsed === right.sidebarCollapsed &&
    left.launchAtStartup === right.launchAtStartup &&
    left.minimizeToTray === right.minimizeToTray &&
    left.notificationsEnabled === right.notificationsEnabled &&
    left.achievementSoundEnabled === right.achievementSoundEnabled &&
    left.autoCheckForUpdates === right.autoCheckForUpdates &&
    left.updateChannel === right.updateChannel &&
    left.hidePlaytime === right.hidePlaytime &&
    left.hideHiddenGames === right.hideHiddenGames
  );
}

function normalizeLanguage(value: unknown): UserPreferences["language"] {
  return value === "ar" || value === "Arabic" ? "ar" : "en";
}

function normalizeNotifications(source: Record<string, unknown>) {
  if (typeof source.notificationsEnabled === "boolean") {
    return source.notificationsEnabled;
  }
  const legacyValues = [
    source.achievementNotifications,
    source.completionNotifications,
    source.weeklyGoalReminder
  ].filter((value): value is boolean => typeof value === "boolean");
  return legacyValues.length
    ? legacyValues.some(Boolean)
    : defaultPreferences.notificationsEnabled;
}

function isTheme(value: unknown): value is UserPreferences["theme"] {
  return value === "system" || value === "dark" || value === "light";
}

function booleanOrDefault(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
