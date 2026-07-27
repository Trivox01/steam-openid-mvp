import { Bell } from "lucide-react";
import type { UserProfile } from "../../types";
import { AnimatedGlowingSearchBar } from "../ui/animated-glowing-search-bar";
import { ThemeToggle } from "../ui/ThemeToggle";
import { ProfileAvatar } from "../ui/ProfileAvatar";
import { useTranslation } from "../../i18n/TranslationContext";

export function Topbar({ profile, search, onSearch }: { profile?: UserProfile; search: string; onSearch: (value: string) => void }) {
  const { t } = useTranslation();
  return (
    <header className="topbar">
      <AnimatedGlowingSearchBar
        value={search}
        onChange={onSearch}
        placeholder={t("topbar.searchPlaceholder")}
        ariaLabel={t("topbar.searchLabel")}
        className="topbar-glowing-search"
      />
      <div className="topbar-actions">
        <ThemeToggle />
        <button className="icon-button notification-button" aria-label={t("topbar.notifications")}><Bell size={18} /><span /></button>
        <div className="profile">
          <ProfileAvatar src={profile?.avatarUrl} name={profile?.displayName ?? "Alex Morgan"} />
          <div>
            <strong>{profile?.displayName ?? "Alex Morgan"}</strong>
            <span>{profile?.level ? t("topbar.level", { level: profile.level }) : t("topbar.profile")}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
