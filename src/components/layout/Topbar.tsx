import { Bell } from "lucide-react";
import type { UserProfile } from "../../types";
import { AnimatedGlowingSearchBar } from "../ui/animated-glowing-search-bar";
import { ThemeToggle } from "../ui/ThemeToggle";
import { ProfileAvatar } from "../ui/ProfileAvatar";
import { useTranslation } from "../../i18n/TranslationContext";
import { CurrentUserProfileCardTrigger } from "../profile/CurrentUserProfileCardTrigger";

export function Topbar({ profile, search, onSearch }: { profile?: UserProfile; search: string; onSearch: (value: string) => void }) {
  const { t } = useTranslation();
  const displayName = profile?.id !== "local-player" && profile?.displayName.trim()
    ? profile.displayName.trim()
    : t("profile.fallbackName");
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
        <CurrentUserProfileCardTrigger profile={profile}>
          <span className="profile">
            <ProfileAvatar src={profile?.avatarUrl} name={displayName} />
            <span>
              <strong dir="auto">{displayName}</strong>
              <span>{profile?.level ? t("topbar.level", { level: profile.level }) : t("topbar.profile")}</span>
            </span>
          </span>
        </CurrentUserProfileCardTrigger>
      </div>
    </header>
  );
}
