import { Activity, BarChart3, ChevronLeft, Code2, Gamepad2, LayoutDashboard, Medal, Settings, Sparkles } from "lucide-react";
import type { CSSProperties } from "react";
import { useTranslation } from "../../i18n/TranslationContext";
import type { PageId } from "../../types";

const navItems = [
  { id: "dashboard" as const, icon: LayoutDashboard },
  { id: "games" as const, icon: Gamepad2 },
  { id: "achievements" as const, icon: Medal },
  { id: "activity" as const, icon: Activity },
  { id: "statistics" as const, icon: BarChart3 }
];

export function Sidebar({ activePage, collapsed, canAccessDeveloperCenter, onCollapsedChange, onNavigate }: {
  activePage: PageId;
  collapsed: boolean;
  canAccessDeveloperCenter: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onNavigate: (page: PageId) => void;
}) {
  const { t } = useTranslation();
  const item = (id: PageId, Icon: typeof LayoutDashboard) => {
    const active = activePage === id;
    const label = t(`nav.${id}`);
    return <button
      key={id}
      className={`nav-item ${active ? "active" : ""}`}
      onClick={() => onNavigate(id)}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      data-tooltip={label}
    >
      {active && <span className="nav-active-bg" aria-hidden="true" />}
      <Icon size={19} strokeWidth={1.8} aria-hidden="true" /><span className="nav-item-label">{label}</span>
    </button>;
  };
  return (
    <aside className={`sidebar ${collapsed ? "sidebar--collapsed" : ""}`}>
      <div className="sidebar-header">
        <button className="brand" onClick={() => onNavigate("dashboard")} aria-label={t("nav.home")}>
          <span className="brand-mark"><Sparkles size={20} strokeWidth={1.8} /></span>
          <span className="brand-copy"><strong>Achievement</strong><small>NEXUS</small></span>
        </button>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => onCollapsedChange(!collapsed)}
          aria-expanded={!collapsed}
          aria-label={t(collapsed ? "nav.expand" : "nav.collapse")}
          title={t(collapsed ? "nav.expand" : "nav.collapse")}
        >
          <ChevronLeft size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      <nav aria-label={t("nav.primary")}>
        <p className="nav-label">{t("nav.overview")}</p>
        <div
          className="nav-items"
          style={{ "--active-nav-index": Math.max(0, navItems.findIndex(({ id }) => id === activePage)) } as CSSProperties}
        >
          {activePage !== "settings" && <span className="nav-moving-indicator" aria-hidden="true" />}
          {navItems.map(({ id, icon }) => item(id, icon))}
        </div>
      </nav>
      <div className="sidebar-spacer" />
      {canAccessDeveloperCenter ? item("developer", Code2) : null}
      {item("settings", Settings)}
      <div className="sync-card">
        <div><span className="status-dot" /> {t("nav.synced")}</div>
        <p>{t("nav.syncedNow")}</p>
      </div>
    </aside>
  );
}
