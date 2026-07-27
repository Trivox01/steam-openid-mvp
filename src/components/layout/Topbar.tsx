import { Bell } from "lucide-react";
import type { UserProfile } from "../../types";
import { AnimatedGlowingSearchBar } from "../ui/animated-glowing-search-bar";
import { ThemeToggle } from "../ui/ThemeToggle";
import { ProfileAvatar } from "../ui/ProfileAvatar";

export function Topbar({ profile, search, onSearch }: { profile?: UserProfile; search: string; onSearch: (value: string) => void }) {
  return (
    <header className="topbar">
      <AnimatedGlowingSearchBar
        value={search}
        onChange={onSearch}
        placeholder="Search games and achievements..."
        ariaLabel="Search games and achievements"
        className="topbar-glowing-search"
      />
      <div className="topbar-actions">
        <ThemeToggle />
        <button className="icon-button notification-button" aria-label="Notifications"><Bell size={18} /><span /></button>
        <div className="profile">
          <ProfileAvatar src={profile?.avatarUrl} name={profile?.displayName ?? "Alex Morgan"} />
          <div>
            <strong>{profile?.displayName ?? "Alex Morgan"}</strong>
            <span>{profile?.level ? `Level ${profile.level}` : "Steam profile"}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
