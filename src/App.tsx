import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Settings as SettingsIcon } from "lucide-react";
import { Sidebar } from "./components/layout/Sidebar";
import { Topbar } from "./components/layout/Topbar";
import { ErrorView, LoadingView } from "./components/ui/StateViews";
import { Onboarding } from "./components/onboarding/Onboarding";
import type { AchievementId, GameId, NavigationView, PageId, UserPreferences, UserProfile } from "./types";
import { initializeApplication } from "./services/initializationService";
import { services } from "./services/compositionRoot";
import { useTheme } from "./state/ThemeContext";
import { useTranslation } from "./i18n/TranslationContext";
import type { SettingsPageHandle } from "./pages/SettingsPage";

const DashboardPage = lazy(() => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const GamesPage = lazy(() => import("./pages/GamesPage").then((module) => ({ default: module.GamesPage })));
const AchievementsPage = lazy(() => import("./pages/AchievementsPage").then((module) => ({ default: module.AchievementsPage })));
const ActivityPage = lazy(() => import("./pages/ActivityPage").then((module) => ({ default: module.ActivityPage })));
const StatisticsPage = lazy(() => import("./pages/StatisticsPage").then((module) => ({ default: module.StatisticsPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const GameDetailsPage = lazy(() => import("./pages/GameDetailsPage").then((module) => ({ default: module.GameDetailsPage })));
const AchievementDetailsView = lazy(() => import("./pages/AchievementDetailsView").then((module) => ({ default: module.AchievementDetailsView })));

export function App() {
  const { setTheme } = useTheme();
  const { setLanguage, t } = useTranslation();
  const [initialization, setInitialization] = useState<"loading"|"ready"|"error">("loading");
  const [initializationError, setInitializationError] = useState("");
  const [profile, setProfile] = useState<UserProfile>();
  const [preferences, setPreferences] = useState<UserPreferences>();
  const [activePage, setActivePage] = useState<PageId>("dashboard");
  const [view, setView] = useState<NavigationView>({ kind: "page", page: "dashboard" });
  const [, setHistory] = useState<NavigationView[]>([]);
  const [search, setSearch] = useState("");
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [pendingPage, setPendingPage] = useState<PageId>();
  const [navigationSaving, setNavigationSaving] = useState(false);
  const [navigationSaveFailed, setNavigationSaveFailed] = useState(false);
  const settingsRef = useRef<SettingsPageHandle>(null);
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

  const performPageNavigation = (page: PageId) => {
    setActivePage(page);
    setHistory([]);
    setView({ kind: "page", page });
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
  const openGame = useCallback((gameId: GameId) => { setView((current) => { setHistory((items) => [...items, current]); return { kind: "game", gameId }; }); }, []);
  const openAchievement = useCallback((achievementId: AchievementId, gameId: GameId) => { setView((current) => { setHistory((items) => [...items, current]); return { kind: "achievement", achievementId, gameId }; }); }, []);
  const goBack = useCallback(() => {
    setHistory((items) => {
      const previous = items.at(-1) ?? { kind: "page", page: activePage } as NavigationView;
      setView(previous);
      return items.slice(0, -1);
    });
  }, [activePage]);
  const completeOnboarding = async (destination?: "steam-settings") => {
    if (!preferences) return;
    const next = { ...preferences, onboardingCompleted: true };
    await services.settings.save(next);
    setPreferences(next);
    if (destination === "steam-settings") navigatePage("settings");
  };

  if (initialization === "loading") return <LoadingView fullScreen size="lg" label={t("state.initializing")} />;
  if (initialization === "error") return <main className="initialization-state"><ErrorView message={initializationError} onRetry={() => void initialize()} /></main>;
  if (!preferences) return <main className="initialization-state"><ErrorView message={t("state.settingsMissing")} onRetry={() => void initialize()} /></main>;
  if (!preferences.onboardingCompleted) {
    return <Onboarding onComplete={completeOnboarding} />;
  }
  return (
    <div className="app-shell">
      <Sidebar activePage={activePage} onNavigate={navigatePage} />
      <div className="main-column">
        <Topbar profile={profile} search={search} onSearch={setSearch} />
        <main>
          <Suspense fallback={<LoadingView size="md" label={t("state.loadingPage")} delay={150} />}>
            <div className={view.kind === "page" ? "" : "preserved-page"} aria-hidden={view.kind !== "page"}>
              {activePage === "dashboard" && <DashboardPage search={search} onOpenGame={openGame} onOpenAchievement={openAchievement} />}
              {activePage === "games" && <GamesPage onOpenGame={openGame} />}
              {activePage === "achievements" && <AchievementsPage onOpenAchievement={openAchievement} />}
              {activePage === "activity" && <ActivityPage />}
              {activePage === "statistics" && <StatisticsPage onOpenGame={openGame} />}
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
