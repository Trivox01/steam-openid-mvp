import { CircleCheck, Gamepad2, Target, Trophy, type LucideIcon } from "lucide-react";
import type { UserProfileStats } from "../../features/profile/types";
import { useTranslation } from "../../i18n/TranslationContext";

type StatItem = {
  id: keyof UserProfileStats;
  label: string;
  value?: number;
  icon: LucideIcon;
};

export function ProfileStats({ stats }: { stats?: UserProfileStats }) {
  const { language, t } = useTranslation();
  if (!stats) return null;
  const locale = language === "ar" ? "ar" : "en";
  const items: StatItem[] = [
    { id: "gamesOwned", label: "profile.games", value: stats.gamesOwned, icon: Gamepad2 },
    { id: "achievementsUnlocked", label: "profile.achievements", value: stats.achievementsUnlocked, icon: Trophy },
    { id: "perfectGames", label: "profile.perfectGames", value: stats.perfectGames, icon: CircleCheck },
    { id: "completionRate", label: "profile.completion", value: stats.completionRate, icon: Target }
  ];

  return (
    <dl className="profile-card__stats">
      {items.map(({ id, label, value, icon: Icon }) => (
        <div key={id}>
          <span className="profile-card__stat-icon"><Icon size={20} aria-hidden={true} /></span>
          <span className="profile-card__stat-copy">
            <dt>{t(label)}</dt>
            <dd>{formatStat(value, id === "completionRate", locale)}</dd>
          </span>
        </div>
      ))}
    </dl>
  );
}

function formatStat(value: number | undefined, percent: boolean, locale: string) {
  if (value === undefined) return "—";
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: percent ? 0 : 2 }).format(value);
  return percent ? `${formatted}%` : formatted;
}
