import {
  Activity,
  Boxes,
  Bug,
  Flag,
  FolderUp,
  LayoutDashboard,
  Medal,
  Settings,
  ShieldCheck,
  Tags,
  UserCog,
  Users
  ,Wrench, BadgeCheck, FolderTree
} from "lucide-react";
import { Surface } from "../components/ui/Surface";
import { StatusBadge } from "../components/ui/StatusBadge";
import { useTranslation } from "../i18n/TranslationContext";
import type { AuthorizationSnapshot } from "../features/developer-center/authorizationTypes";
import { lazy, Suspense, useState } from "react";
import { BadgeManagementPanel } from "../features/developer-center/badges/BadgeManagementPanel";
import { services } from "../services/compositionRoot";
const ToolsManagementPanel = lazy(async () => {
  const module = await import("../features/developer-center/tools/ToolsManagementPanel");
  return { default: module.ToolsManagementPanel };
});
const ReviewModerationPanel = lazy(async () => {
  const module = await import("../features/developer-center/tools/ReviewModerationPanel");
  return { default: module.ReviewModerationPanel };
});
const ReviewReportsPanel = lazy(async () => {
  const module = await import("../features/developer-center/tools/ReviewReportsPanel");
  return { default: module.ReviewReportsPanel };
});
const BadgeAssignmentsPanel = lazy(async () => {
  const module = await import(
    "../features/developer-center/assignments/BadgeAssignmentsPanel"
  );
  return { default: module.BadgeAssignmentsPanel };
});
const UserManagementPanel = lazy(async () => {
  const module = await import(
    "../features/developer-center/users/UserManagementPanel"
  );
  return { default: module.UserManagementPanel };
});

const sections = [
  ["overview", LayoutDashboard, false],
  ["users", Users, true],
  ["roles", UserCog, true],
  ["badges", Medal, false],
  ["assignments", Tags, true],
  ["assets", FolderUp, true],
  ["settings", Settings, true],
  ["flags", Flag, true],
  ["audit", Activity, true],
  ["diagnostics", Bug, true]
  ,["tools", Wrench, false]
  ,["toolBadges", BadgeCheck, false]
  ,["toolCategories", FolderTree, false]
  ,["toolReviews", Flag, false]
  ,["toolReviewReports", Flag, false]
] as const;

export function DeveloperCenterPage({
  snapshot
}: {
  snapshot: AuthorizationSnapshot;
}) {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<"overview" | "users" | "badges" | "assignments" | "tools" | "toolBadges" | "toolCategories" | "toolReviews" | "toolReviewReports">("overview");
  const highestRole = [...snapshot.roles].sort(
    (left, right) => right.priority - left.priority
  )[0];
  return (
    <div className="developer-center">
      <header className="developer-header">
        <div>
          <div className="developer-eyebrow">
            <ShieldCheck size={16} aria-hidden="true" />
            {t("developer.eyebrow")}
          </div>
          <h1>{t("developer.title")}</h1>
          <p>{t("developer.description")}</p>
        </div>
        <StatusBadge tone="accent">{t("developer.administrative")}</StatusBadge>
      </header>

      <div className="developer-layout">
        <Surface as="nav" className="developer-section-nav" aria-label={t("developer.sections")}>
          {sections.map(([id, Icon, originallyDisabled]) => {
            if (
              id === "assignments" &&
              !snapshot.permissions.includes("badges.view_assignments")
            ) return null;
            if (id === "users" && !snapshot.permissions.includes("users.view")) {
              return null;
            }
            if (id === "tools" && !snapshot.permissions.includes("tools.manage")) return null;
            if (id === "toolBadges" && !snapshot.permissions.includes("tool_badges.manage")) return null;
            if (id === "toolCategories" && !snapshot.permissions.includes("tool_categories.manage")) return null;
            if (id === "toolReviews" && !snapshot.permissions.includes("tools.moderate_reviews")) return null;
            if (id === "toolReviewReports" && !snapshot.permissions.includes("tools.moderate_reviews")) return null;
            const disabled = originallyDisabled && id !== "assignments" && id !== "users";
            return (
              <button
                key={id}
                type="button"
                className={activeSection === id ? "active" : ""}
                disabled={disabled}
                aria-current={activeSection === id ? "page" : undefined}
                title={disabled ? t("developer.comingSoon") : undefined}
                onClick={() => {
                  if (
                    id === "overview" ||
                    id === "users" ||
                    id === "badges" ||
                    id === "assignments" || id === "tools" || id === "toolBadges" || id === "toolCategories" || id === "toolReviews" || id === "toolReviewReports"
                  ) setActiveSection(id);
                }}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{t(`developer.section.${id}`)}</span>
                {disabled ? <small>{t("developer.comingSoon")}</small> : null}
              </button>
            );
          })}
        </Surface>

        {activeSection === "users" ? (
          <Suspense fallback={<Surface className="badge-state">{t("developer.users.loading")}</Surface>}>
            <UserManagementPanel
              client={services.userAdmin}
              canChangeStatus={snapshot.permissions.includes("users.change_status")}
              onOpenAssignments={snapshot.permissions.includes("badges.view_assignments")
                ? () => setActiveSection("assignments")
                : undefined}
            />
          </Suspense>
        ) : activeSection === "assignments" ? (
          <Suspense fallback={<Surface className="badge-state">{t("developer.assignments.loading")}</Surface>}>
            <BadgeAssignmentsPanel snapshot={snapshot} client={services.badgeAssignments}/>
          </Suspense>
        ) : activeSection === "badges" ? (
          <BadgeManagementPanel snapshot={snapshot} client={services.badgeAdmin} />
        ) : activeSection === "tools" ? (
          <Suspense fallback={<Surface className="badge-state">{t("state.loading")}</Surface>}><ToolsManagementPanel client={services.tools} mode="tools" /></Suspense>
        ) : activeSection === "toolBadges" ? (
          <Suspense fallback={<Surface className="badge-state">{t("state.loading")}</Surface>}><ToolsManagementPanel client={services.tools} mode="badges" /></Suspense>
        ) : activeSection === "toolCategories" ? (
          <Suspense fallback={<Surface className="badge-state">{t("state.loading")}</Surface>}><ToolsManagementPanel client={services.tools} mode="categories" /></Suspense>
        ) : activeSection === "toolReviews" ? (
          <Suspense fallback={<Surface className="badge-state">{t("state.loading")}</Surface>}><ReviewModerationPanel client={services.tools} canOpenReports={snapshot.permissions.includes("tools.moderate_reviews")} canReply={snapshot.permissions.includes("tools.reply_to_review")} onOpenReports={() => setActiveSection("toolReviewReports")} /></Suspense>
        ) : activeSection === "toolReviewReports" ? (
          <Suspense fallback={<Surface className="badge-state">{t("state.loading")}</Surface>}><ReviewReportsPanel client={services.tools} onBack={() => setActiveSection("toolReviews")} /></Suspense>
        ) : <div className="developer-overview">
          <div className="developer-overview-heading">
            <div>
              <h2>{t("developer.section.overview")}</h2>
              <p>{t("developer.overviewDescription")}</p>
            </div>
            <StatusBadge tone="success">{t("developer.accessGranted")}</StatusBadge>
          </div>

          <div className="developer-metrics">
            <Metric icon={ShieldCheck} label={t("developer.session")} value={t("developer.sessionActive")} />
            <Metric icon={Users} label={t("developer.rolesCount")} value={String(snapshot.roles.length)} />
            <Metric icon={Boxes} label={t("developer.permissionsCount")} value={String(snapshot.permissions.length)} />
            <Metric
              icon={UserCog}
              label={t("developer.highestRole")}
              value={highestRole?.displayName ?? t("developer.noRole")}
              detail={highestRole ? t("developer.priority", { value: highestRole.priority }) : undefined}
            />
          </div>

          <Surface className="developer-coming-sections">
            <h3>{t("developer.nextSections")}</h3>
            <p>{t("developer.nextSectionsDescription")}</p>
            <ul>
              {sections.slice(1, 5).map(([id, Icon]) => (
                <li key={id}>
                  <Icon size={17} aria-hidden="true" />
                  <span>{t(`developer.section.${id}`)}</span>
                  <StatusBadge>{t("developer.comingSoon")}</StatusBadge>
                </li>
              ))}
            </ul>
          </Surface>
        </div>}
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <Surface className="developer-metric">
      <Icon aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </Surface>
  );
}
