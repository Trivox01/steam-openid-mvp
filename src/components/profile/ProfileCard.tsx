import { BadgeCheck } from "lucide-react";
import type { UserProfileSummary } from "../../features/profile/types";
import { useTranslation } from "../../i18n/TranslationContext";
import { ProfileAvatar } from "../ui/ProfileAvatar";
import { ProfileBadges } from "./ProfileBadges";

export function ProfileCard({ summary, onAction }: { summary: UserProfileSummary; onAction?: () => void }) {
  const { language, t } = useTranslation();
  const locale = language === "ar" ? "ar" : "en";
  const stats = summary.stats
    ? [
        ["gamesOwned", "profile.games", summary.stats.gamesOwned],
        ["achievementsUnlocked", "profile.achievements", summary.stats.achievementsUnlocked],
        ["perfectGames", "profile.perfectGames", summary.stats.perfectGames],
        ["completionRate", "profile.completion", summary.stats.completionRate]
      ].filter((entry) => entry[2] !== undefined)
    : [];
  const date = summary.memberSince ?? summary.authenticatedAt;

  return (
    <article className="profile-card">
      <div className="profile-card__banner" style={summary.bannerUrl ? { backgroundImage: `url("${summary.bannerUrl}")` } : undefined} />
      <div className="profile-card__identity">
        <div className="profile-card__avatar-wrap">
          <ProfileAvatar src={summary.avatarUrl} name={summary.displayName} className="profile-card__avatar" />
          {summary.status && <span className={`profile-card__status profile-card__status--${summary.status}`} aria-label={t(`profile.status.${summary.status}`)} />}
        </div>
        <div className="profile-card__heading">
          <div className="profile-card__name">
            <h2 dir="auto">{summary.displayName}</h2>
            <ProfileBadges badges={summary.badges} />
            {summary.username && <p dir="auto">@{summary.username}</p>}
          </div>
          {summary.isSteamVerified && <BadgeCheck size={18} aria-label={t("profile.steamVerified")} />}
        </div>
      </div>
      <div className="profile-card__body">
        {summary.bio && <p className="profile-card__bio" dir="auto">{summary.bio}</p>}
        {stats.length > 0 && (
          <dl className="profile-card__stats">
            {stats.map(([id, label, rawValue]) => (
              <div key={String(id)}>
                <dt>{t(String(label))}</dt>
                <dd>{id === "completionRate"
                  ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(rawValue))}%`
                  : new Intl.NumberFormat(locale).format(Number(rawValue))}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {date && (
          <p className="profile-card__date">
            <span>{summary.memberSince ? t("profile.memberSince") : t("profile.authenticatedAt")}</span>
            <time dateTime={date}>{formatDate(date, locale)}</time>
          </p>
        )}
        {onAction && (
          <button className="primary-button profile-card__action" type="button" onClick={onAction}>
            {summary.isCurrentUser ? t("profile.editProfile") : t("profile.viewFullProfile")}
          </button>
        )}
      </div>
    </article>
  );
}

function formatDate(value: string, locale: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(parsed);
}
