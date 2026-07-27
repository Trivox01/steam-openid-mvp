import { Activity, BarChart3, Gamepad2, LayoutDashboard, Medal, Settings, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { strings } from "../../i18n/strings";
import type { PageId } from "../../types";

const navItems = [
  { id: "dashboard" as const, icon: LayoutDashboard },
  { id: "games" as const, icon: Gamepad2 },
  { id: "achievements" as const, icon: Medal },
  { id: "activity" as const, icon: Activity },
  { id: "statistics" as const, icon: BarChart3 }
];

export function Sidebar({ activePage, onNavigate }: { activePage: PageId; onNavigate: (page: PageId) => void }) {
  return (
    <aside className="sidebar">
      <button className="brand" onClick={() => onNavigate("dashboard")} aria-label="Achievement Nexus home">
        <span className="brand-mark"><Sparkles size={20} /></span>
        <span><strong>Achievement</strong><small>NEXUS</small></span>
      </button>
      <nav aria-label="Primary navigation">
        <p className="nav-label">OVERVIEW</p>
        {navItems.map(({ id, icon: Icon }) => (
          <button key={id} className={`nav-item ${activePage === id ? "active" : ""}`} onClick={() => onNavigate(id)}>
            {activePage === id && <motion.span layoutId="nav-active" className="nav-active-bg" />}
            <Icon size={19} /><span>{strings.navigation[id]}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-spacer" />
      <button className={`nav-item ${activePage === "settings" ? "active" : ""}`} onClick={() => onNavigate("settings")}>
        <Settings size={19} /><span>{strings.navigation.settings}</span>
      </button>
      <div className="sync-card">
        <div><span className="status-dot" /> Library synced</div>
        <p>Mock data · Just now</p>
      </div>
    </aside>
  );
}
