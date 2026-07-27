import { Activity, BarChart3, Gamepad2, LayoutDashboard, Medal, Settings, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslation } from "../../i18n/TranslationContext";
import type { PageId } from "../../types";

const navItems = [
  { id: "dashboard" as const, icon: LayoutDashboard },
  { id: "games" as const, icon: Gamepad2 },
  { id: "achievements" as const, icon: Medal },
  { id: "activity" as const, icon: Activity },
  { id: "statistics" as const, icon: BarChart3 }
];

export function Sidebar({ activePage, onNavigate }: { activePage: PageId; onNavigate: (page: PageId) => void }) {
  const { t } = useTranslation();
  return (
    <aside className="sidebar">
      <button className="brand" onClick={() => onNavigate("dashboard")} aria-label={t("nav.home")}>
        <span className="brand-mark"><Sparkles size={20} /></span>
        <span><strong>Achievement</strong><small>NEXUS</small></span>
      </button>
      <nav aria-label={t("nav.primary")}>
        <p className="nav-label">{t("nav.overview")}</p>
        {navItems.map(({ id, icon: Icon }) => (
          <button key={id} className={`nav-item ${activePage === id ? "active" : ""}`} onClick={() => onNavigate(id)}>
            {activePage === id && <motion.span layoutId="nav-active" className="nav-active-bg" />}
            <Icon size={19} /><span>{t(`nav.${id}`)}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-spacer" />
      <button className={`nav-item ${activePage === "settings" ? "active" : ""}`} onClick={() => onNavigate("settings")}>
        <Settings size={19} /><span>{t("nav.settings")}</span>
      </button>
      <div className="sync-card">
        <div><span className="status-dot" /> {t("nav.synced")}</div>
        <p>{t("nav.syncedNow")}</p>
      </div>
    </aside>
  );
}
