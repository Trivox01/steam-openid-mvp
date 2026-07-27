import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sidebar } from "./components/layout/Sidebar";
import { Topbar } from "./components/layout/Topbar";
import { mockDashboardData } from "./data/mockData";
import { DashboardPage } from "./pages/DashboardPage";
import { GamesPage } from "./pages/GamesPage";
import { AchievementsPage } from "./pages/AchievementsPage";
import { ActivityPage } from "./pages/ActivityPage";
import { StatisticsPage } from "./pages/StatisticsPage";
import { SettingsPage } from "./pages/SettingsPage";
import type { PageId } from "./types";

export function App() {
  const [activePage, setActivePage] = useState<PageId>("dashboard");
  const [search, setSearch] = useState("");
  return (
    <div className="app-shell">
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <div className="main-column">
        <Topbar profile={mockDashboardData.profile} search={search} onSearch={setSearch} />
        <main>
          <AnimatePresence mode="wait">
            <motion.div key={activePage} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.2 }}>
              {activePage === "dashboard" && <DashboardPage search={search} />}
              {activePage === "games" && <GamesPage />}
              {activePage === "achievements" && <AchievementsPage />}
              {activePage === "activity" && <ActivityPage />}
              {activePage === "statistics" && <StatisticsPage />}
              {activePage === "settings" && <SettingsPage />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
