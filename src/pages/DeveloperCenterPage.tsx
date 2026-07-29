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
} from "lucide-react";
import { Surface } from "../components/ui/Surface";
import { StatusBadge } from "../components/ui/StatusBadge";
import { useTranslation } from "../i18n/TranslationContext";
import type { AuthorizationSnapshot } from "../features/developer-center/authorizationTypes";
import { useState } from "react";
import { BadgeManagementPanel } from "../features/developer-center/badges/BadgeManagementPanel";
import { services } from "../services/compositionRoot";

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
] as const;

export function DeveloperCenterPage({
  snapshot
}: {
  snapshot: AuthorizationSnapshot;
}) {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<"overview" | "badges">("overview");
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
          {sections.map(([id, Icon, disabled]) => (
            <button
              key={id}
              type="button"
              className={activeSection === id ? "active" : ""}
              disabled={disabled}
              aria-current={activeSection === id ? "page" : undefined}
              title={disabled ? t("developer.comingSoon") : undefined}
              onClick={() => {
                if (id === "overview" || id === "badges") setActiveSection(id);
              }}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{t(`developer.section.${id}`)}</span>
              {disabled ? <small>{t("developer.comingSoon")}</small> : null}
            </button>
          ))}
        </Surface>

        {activeSection === "badges" ? (
          <BadgeManagementPanel snapshot={snapshot} client={services.badgeAdmin} />
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
