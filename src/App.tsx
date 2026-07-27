import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sidebar } from "./components/layout/Sidebar";
import { Topbar } from "./components/layout/Topbar";
import { ErrorView, LoadingView } from "./components/ui/StateViews";
import type { AchievementId, GameId, NavigationView, PageId, UserProfile } from "./types";
import { initializeApplication } from "./services/initializationService";
import { useTheme } from "./state/ThemeContext";

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
  const [initialization, setInitialization] = useState<"loading"|"ready"|"error">("loading");
  const [initializationError, setInitializationError] = useState("");
  const [profile, setProfile] = useState<UserProfile>();
  const [activePage, setActivePage] = useState<PageId>("dashboard");
  const [view, setView] = useState<NavigationView>({ kind: "page", page: "dashboard" });
  const [, setHistory] = useState<NavigationView[]>([]);
  const [search, setSearch] = useState("");
  const initialize = useCallback(async () => {
    setInitialization("loading");
    try {
      const result = await initializeApplication();
      setProfile(result.profile); setTheme(result.preferences.theme); setInitialization("ready");
    } catch (error: unknown) {
      setInitializationError(error instanceof Error ? error.message : "Unable to initialize local storage.");
      setInitialization("error");
    }
  }, [setTheme]);
  useEffect(() => { void initialize(); }, [initialize]);

  const navigatePage = (page: PageId) => { setActivePage(page); setHistory([]); setView({ kind: "page", page }); };
  const openGame = useCallback((gameId: GameId) => { setView((current) => { setHistory((items) => [...items, current]); return { kind: "game", gameId }; }); }, []);
  const openAchievement = useCallback((achievementId: AchievementId, gameId: GameId) => { setView((current) => { setHistory((items) => [...items, current]); return { kind: "achievement", achievementId, gameId }; }); }, []);
  const goBack = useCallback(() => {
    setHistory((items) => {
      const previous = items.at(-1) ?? { kind: "page", page: activePage } as NavigationView;
      setView(previous);
      return items.slice(0, -1);
    });
  }, [activePage]);

  if (initialization === "loading") return <LoadingView fullScreen size="lg" label="Initializing Nexus" />;
  if (initialization === "error") return <main className="initialization-state"><ErrorView message={initializationError} onRetry={() => void initialize()} /></main>;
  return (
    <div className="app-shell">
      <Sidebar activePage={activePage} onNavigate={navigatePage} />
      <div className="main-column">
        <Topbar profile={profile} search={search} onSearch={setSearch} />
        <main>
          <Suspense fallback={<LoadingView size="md" label="Loading page" delay={150} />}>
            <div className={view.kind === "page" ? "" : "preserved-page"} aria-hidden={view.kind !== "page"}>
              {activePage === "dashboard" && <DashboardPage search={search} onOpenGame={openGame} onOpenAchievement={openAchievement} />}
              {activePage === "games" && <GamesPage onOpenGame={openGame} />}
              {activePage === "achievements" && <AchievementsPage onOpenAchievement={openAchievement} />}
              {activePage === "activity" && <ActivityPage />}
              {activePage === "statistics" && <StatisticsPage onOpenGame={openGame} />}
              {activePage === "settings" && <SettingsPage onProfileChange={setProfile} />}
            </div>
            <AnimatePresence mode="wait">
              {view.kind === "game" && <motion.div key={`game-${view.gameId}`} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}}><GameDetailsPage gameId={view.gameId} onBack={goBack} onOpenAchievement={(id) => openAchievement(id, view.gameId)} /></motion.div>}
            </AnimatePresence>
            {view.kind === "achievement" && <AchievementDetailsView achievementId={view.achievementId} onClose={goBack} onOpenGame={(id) => { setHistory([]); setView({ kind: "game", gameId: id }); }} />}
          </Suspense>
        </main>
      </div>
    </div>
  );
}
