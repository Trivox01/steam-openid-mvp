import { Bell, Search } from "lucide-react";
import type { UserProfile } from "../../types";
import { ThemeToggle } from "../ui/ThemeToggle";

export function Topbar({ profile, search, onSearch }: { profile?: UserProfile; search: string; onSearch: (value: string) => void }) {
  return (
    <header className="topbar">
      <label className="search-box">
        <Search size={18} />
        <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search games and achievements..." />
        <kbd>⌘ K</kbd>
      </label>
      <div className="topbar-actions">
        <ThemeToggle />
        <button className="icon-button notification-button" aria-label="Notifications"><Bell size={18} /><span /></button>
        <div className="profile">
          <img src={profile?.avatarUrl} alt="" />
          <div><strong>{profile?.displayName ?? "Alex Morgan"}</strong><span>Level {profile?.level ?? 42}</span></div>
        </div>
      </div>
    </header>
  );
}
