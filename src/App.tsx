import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Settings as SettingsIcon } from "lucide-react";
import { Sidebar } from "./components/layout/Sidebar";
import { Topbar } from "./components/layout/Topbar";
import { ErrorView, LoadingView } from "./components/ui/StateViews";
import { FirstLaunchExperience } from "./features/onboarding/FirstLaunchExperience";
import type { AchievementId, GameId, NavigationView, PageId, UserPreferences, UserProfile } from "./types";
import { initializeApplication } from "./services/initializationService";
import { achievementSoundService, achievementToastCoordinator, achievementToastSoundController, applicationRefresh, services, smartSync } from "./services/compositionRoot";
import { installAchievementAudioUnlock } from "./features/achievement-toasts/AchievementSoundService";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "./runtime/environment";
import { useTheme } from "./state/ThemeContext";
import { useTranslation } from "./i18n/TranslationContext";
import type { SettingsPageHandle } from "./pages/SettingsPage";
import { activeNavigationPage } from "./components/layout/navigationState";
import { useAuthorization } from "./features/developer-center/AuthorizationContext";
import { DeveloperCenterRoute } from "./features/developer-center/DeveloperCenterRoute";
import { updateCoordinator } from "./features/updates/UpdateCoordinator";
import { UpdateExperience } from "./features/updates/UpdateExperience";
import { AmbientBackdrop } from "./components/ui/NexusGlass";
import { AchievementToastHost } from "./features/achievement-toasts/AchievementToastHost";
import { discordPresenceBridge } from "./services/DiscordPresenceBridge";
import { subscribeToLibraryChanges } from "./services/dataEvents";
import { SessionSummaryHost } from "./features/session-summaries/SessionSummaryHost";

const DashboardPage = lazy(() => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const GamesPage = lazy(() => import("./pages/GamesPage").then((module) => ({ default: module.GamesPage })));
const AchievementsPage = lazy(() => import("./pages/AchievementsPage").then((module) => ({ default: module.AchievementsPage })));
const ActivityPage = lazy(() => import("./pages/ActivityPage").then((module) => ({ default: module.ActivityPage })));
const StatisticsPage = lazy(() => import("./pages/StatisticsPage").then((module) => ({ default: module.StatisticsPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const GameDetailsPage = lazy(() => import("./pages/GameDetailsPage").then((module) => ({ default: module.GameDetailsPage })));
const AchievementDetailsView = lazy(() => import("./pages/AchievementDetailsView").then((module) => ({ default: module.AchievementDetailsView })));
const ToolsPage = lazy(() => import("./pages/ToolsPage").then((module) => ({ default: module.ToolsPage })));
const ToolDetailsPage = lazy(() => import("./pages/ToolDetailsPage").then((module) => ({ default: module.ToolDetailsPage })));

export function App() {
  const { setTheme } = useTheme();
  const { setLanguage, t } = useTranslation();
  const { state: authorizationState } = useAuthorization();
  const initialPage = initialPageFromLocation();
  const [initialization, setInitialization] = useState<"loading"|"ready"|"error">("loading");
  const [initializationError, setInitializationError] = useState("");
  const [profile, setProfile] = useState<UserProfile>();
  const [preferences, setPreferences] = useState<UserPreferences>();
  const [activePage, setActivePage] = useState<PageId>(initialPage);
  const [view, setView] = useState<NavigationView>({ kind: "page", page: initialPage });
  const [, setHistory] = useState<NavigationView[]>([]);
  const [search, setSearch] = useState("");
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [pendingPage, setPendingPage] = useState<PageId>();
  const [navigationSaving, setNavigationSaving] = useState(false);
  const [navigationSaveFailed, setNavigationSaveFailed] = useState(false);
  const settingsRef = useRef<SettingsPageHandle>(null);
  const mainRef = useRef<HTMLElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const initialize = useCallback(async () => {
    setInitialization("loading");
    try {
      const result = await initializeApplication();
      setProfile(result.profile);
      setPreferences(result.preferences);
      setTheme(result.preferences.theme);
      setLanguage(result.preferences.language);
      setInitialization("ready");
    } catch {
      setInitializationError(t("state.storageError"));
      setInitialization("error");
    }
  }, [setLanguage, setTheme, t]);
  useEffect(() => { void initialize(); }, [initialize]);
  useEffect(() => {
    if (initialization !== "ready") return;
    smartSync.start();
    return () => smartSync.stop();
  }, [initialization]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "r")) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      void applicationRefresh.refreshAll();
    };
    const abort = () => applicationRefresh.abort();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("beforeunload", abort);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("beforeunload", abort);
      applicationRefresh.abort();
    };
  }, []);
  useEffect(() => {
    if (!preferences || !isTauriRuntime()) return;
    void invoke("set_tray_behavior_enabled", { enabled: preferences.minimizeToTray });
  }, [preferences]);
  useEffect(() => {
    if (!preferences) return;
    achievementToastCoordinator.configure({ notificationsEnabled: preferences.notificationsEnabled, soundEnabled: preferences.achievementSoundEnabled });
    achievementToastSoundController.configure({ enabled: preferences.notificationsEnabled && preferences.achievementSoundEnabled, volume: preferences.achievementSoundVolume });
  }, [preferences]);
  useEffect(() => {
    if (!preferences) return;
    void discordPresenceBridge.configure(preferences).catch(() => {
      if (import.meta.env.DEV) console.debug("[discord-presence] configuration unavailable");
    });
  }, [preferences]);
  useEffect(() => {
    const unsubscribe = subscribeToLibraryChanges(() => {
      void discordPresenceBridge.refresh().catch(() => {
        if (import.meta.env.DEV) console.debug("[discord-presence] refresh unavailable");
      });
    });
    return () => { unsubscribe(); };
  }, []);
  useEffect(() => installAchievementAudioUnlock(achievementSoundService), []);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    void listen("nexus://check-for-updates", () => { void updateCoordinator.check("tray"); }).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, [t]);

  const performPageNavigation = (page: PageId) => {
    mainRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0, behavior: "auto" });
    setActivePage(page);
    setHistory([]);
    setView({ kind: "page", page });
    syncDeveloperRoute(page);
  };
  const navigatePage = (page: PageId) => {
    if (activePage === "settings" && page !== "settings" && settingsDirty) {
      setPendingPage(page);
      setNavigationSaveFailed(false);
      return;
    }
    performPageNavigation(page);
  };
  const handleSettingsDirty = useCallback((dirty: boolean) => setSettingsDirty(dirty), []);
  const finishPendingNavigation = () => {
    if (!pendingPage) return;
    const target = pendingPage;
    setPendingPage(undefined);
    setNavigationSaving(false);
    setNavigationSaveFailed(false);
    performPageNavigation(target);
  };
  const openGame = useCallback((gameId: GameId) => {
    mainRef.current?.scrollTo({ top: 0 });
    setView((current) => {
      scrollPositions.current.set(navigationViewKey(current), window.scrollY);
      setHistory((items) => [...items, current]);
      return { kind: "game", gameId };
    });
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  }, []);
  const openAchievement = useCallback((achievementId: AchievementId, gameId: GameId) => {
    mainRef.current?.scrollTo({ top: 0 });
    setView((current) => {
      scrollPositions.current.set(navigationViewKey(current), window.scrollY);
      setHistory((items) => [...items, current]);
      return { kind: "achievement", achievementId, gameId };
    });
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  }, []);
  const openTool = useCallback((slug: string) => {
    mainRef.current?.scrollTo({ top: 0 });
    setView((current) => { scrollPositions.current.set(navigationViewKey(current), window.scrollY); setHistory((items) => [...items, current]); return { kind: "tool", slug }; });
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  }, []);
  const goBack = useCallback(() => {
    setHistory((items) => {
      const previous = items.at(-1) ?? { kind: "page", page: activePage } as NavigationView;
      setView(previous);
      requestAnimationFrame(() => window.scrollTo({ top: scrollPositions.current.get(navigationViewKey(previous)) ?? 0, behavior: "auto" }));
      return items.slice(0, -1);
    });
  }, [activePage]);
  const updateOnboardingPreferences = async (next: UserPreferences) => {
    await services.settings.save(next);
    setPreferences(next);
    setTheme(next.theme);
    setLanguage(next.language);
  };
  const completeOnboarding = async (current: UserPreferences) => {
    const next = { ...current, onboardingCompleted: true };
    await services.settings.save(next);
    setPreferences(next);
  };

  if (initialization === "loading") return <LoadingView fullScreen size="lg" label={t("state.initializing")} />;
  if (initialization === "error") return <main className="initialization-state"><ErrorView message={initializationError} onRetry={() => void initialize()} /></main>;
  if (!preferences) return <main className="initialization-state"><ErrorView message={t("state.settingsMissing")} onRetry={() => void initialize()} /></main>;
  if (!preferences.onboardingCompleted) {
    return <FirstLaunchExperience preferences={preferences} onPreferencesChange={updateOnboardingPreferences} onComplete={completeOnboarding} />;
  }
  return (
    <div className={`app-shell ${preferences.sidebarCollapsed ? "app-shell--sidebar-collapsed" : ""}`}>
      <AmbientBackdrop />
      <GlobalRefreshStatus />
      <UpdateExperience autoCheck={preferences.autoCheckForUpdates} />
      <AchievementToastHost />
      <SessionSummaryHost onOpenGame={openGame} />
      <Sidebar
        activePage={activeNavigationPage(view, activePage)}
        collapsed={preferences.sidebarCollapsed}
        canAccessDeveloperCenter={
          authorizationState.status === "authenticated" &&
          authorizationState.snapshot.canAccessDeveloperCenter
        }
        onCollapsedChange={(sidebarCollapsed) => {
        const next = { ...preferences, sidebarCollapsed };
        setPreferences(next);
        void services.settings.save(next).catch(() => undefined);
      }} onNavigate={navigatePage} />
      <div className="main-column">
        <Topbar profile={profile} search={search} onSearch={setSearch} />
        <main ref={mainRef}>
          <Suspense fallback={<LoadingView size="md" label={t("state.loadingPage")} delay={150} />}>
            <div className={view.kind === "page" ? "" : "preserved-page"} aria-hidden={view.kind !== "page"}>
              {activePage === "dashboard" && <DashboardPage search={search} onOpenGame={openGame} onOpenAchievement={openAchievement} />}
              {activePage === "games" && <GamesPage onOpenGame={openGame} />}
              {activePage === "achievements" && <AchievementsPage onOpenAchievement={openAchievement} />}
              {activePage === "activity" && <ActivityPage />}
              {activePage === "statistics" && <StatisticsPage onOpenGame={openGame} onOpenSettings={() => navigatePage("settings")} />}
              {activePage === "tools" && <ToolsPage onOpen={openTool} />}
              {activePage === "developer" && <DeveloperCenterRoute onOpenSettings={() => navigatePage("settings")} />}
              {activePage === "settings" && (
                <SettingsPage
                  ref={settingsRef}
                  onProfileChange={setProfile}
                  onDirtyChange={handleSettingsDirty}
                  onPreferencesSaved={setPreferences}
                  onShowOnboarding={() => setPreferences((current) =>
                    current ? { ...current, onboardingCompleted: false } : current
                  )}
                />
              )}
            </div>
            <AnimatePresence mode="wait">
              {view.kind === "game" && <motion.div key={`game-${view.gameId}`} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}}><GameDetailsPage gameId={view.gameId} onBack={goBack} onOpenAchievement={(id) => openAchievement(id, view.gameId)} /></motion.div>}
            </AnimatePresence>
            {view.kind === "achievement" && <AchievementDetailsView achievementId={view.achievementId} onClose={goBack} onOpenGame={(id) => { setHistory([]); setView({ kind: "game", gameId: id }); }} />}
            {view.kind === "tool" && <ToolDetailsPage slug={view.slug} onBack={goBack} />}
          </Suspense>
        </main>
      </div>
      {pendingPage && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => { if (!navigationSaving) setPendingPage(undefined); }}>
          <div className="confirm-dialog settings-leave-dialog" role="dialog" aria-modal="true" aria-labelledby="leave-settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <div><SettingsIcon size={22} /></div>
            <h2 id="leave-settings-title">{t("settings.leaveTitle")}</h2>
            <p>{t("settings.leaveDescription")}</p>
            {navigationSaveFailed && <p className="dialog-inline-error" role="alert">{t("settings.saveError")}</p>}
            <footer>
              <button type="button" disabled={navigationSaving} onClick={() => setPendingPage(undefined)}>{t("common.cancel")}</button>
              <button type="button" disabled={navigationSaving} onClick={() => { settingsRef.current?.discard(); finishPendingNavigation(); }}>{t("common.discard")}</button>
              <button className="primary-button" type="button" disabled={navigationSaving} onClick={async () => {
                setNavigationSaving(true);
                setNavigationSaveFailed(false);
                if (await settingsRef.current?.save()) {
                  finishPendingNavigation();
                } else {
                  setNavigationSaving(false);
                  setNavigationSaveFailed(true);
                }
              }}>{navigationSaving ? t("settings.saving") : t("common.save")}</button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

function navigationViewKey(view: NavigationView) {
  if (view.kind === "page") return `page:${view.page}`;
  if (view.kind === "game") return `game:${view.gameId}`;
  if (view.kind === "tool") return `tool:${view.slug}`;
  return `achievement:${view.gameId}:${view.achievementId}`;
}

function GlobalRefreshStatus() {
  const { t } = useTranslation();
  const [state, setState] = useState(applicationRefresh.getSnapshot());
  useEffect(() => applicationRefresh.subscribe(setState), []);
  if (state.status === "idle") return null;
  const visibleStatus = state.status === "success" && state.results.some((item) => item.status === "skipped") ? "partial" : state.status;
  const failedSources = state.results
    .filter((item) => item.status === "failed")
    .map((item) => t(`settings.refreshSource.${item.id}`))
    .join(", ");
  const skippedSources = state.results
    .filter((item) => item.status === "skipped")
    .map((item) => t(`settings.refreshSource.${item.id}`))
    .join(", ");
  return (
    <div className={`application-refresh-toast is-${visibleStatus}`} role="status" aria-live="polite">
      {state.status === "refreshing" ? t("settings.refreshingAll")
        : visibleStatus === "success" ? t("settings.refreshAllSuccess")
          : failedSources
            ? t("settings.refreshAllPartialSources", { sources: failedSources })
            : skippedSources
              ? t("settings.refreshAllSkippedSources", { sources: skippedSources })
              : t("settings.refreshAllPartial")}
    </div>
  );
}

function initialPageFromLocation(): PageId {
  return window.location.hash === "#/developer" ? "developer" : "dashboard";
}

function syncDeveloperRoute(page: PageId) {
  const hash = page === "developer" ? "#/developer" : "";
  if (window.location.hash === hash) return;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
}
