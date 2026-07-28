import { BadgeCheck, CalendarDays, CircleCheck, Gamepad2, Target, Trophy } from "lucide-react";
import type { UserProfileSummary } from "../../features/profile/types";
import { useTranslation } from "../../i18n/TranslationContext";
import { ProfileAvatar } from "../ui/ProfileAvatar";
import { ProfileBadges } from "./ProfileBadges";
import { ProfileBanner } from "./ProfileBanner";

export function ProfileCard({ summary, onAction }: { summary: UserProfileSummary; onAction?: () => void }) {
  const { language, t } = useTranslation();
  const locale = language === "ar" ? "ar" : "en";
  const stats = summary.stats
    ? [
        { id: "gamesOwned", label: "profile.games", value: summary.stats.gamesOwned, icon: Gamepad2 },
        { id: "achievementsUnlocked", label: "profile.achievements", value: summary.stats.achievementsUnlocked, icon: Trophy },
        { id: "perfectGames", label: "profile.perfectGames", value: summary.stats.perfectGames, icon: CircleCheck },
        { id: "completionRate", label: "profile.completion", value: summary.stats.completionRate, icon: Target }
      ]
    : [];
  const date = summary.memberSince ?? summary.authenticatedAt;

  return (
    <article className="profile-card">
      <ProfileBanner src={summary.bannerUrl} />
      <div className="profile-card__identity">
        <div className="profile-card__identity-row">
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
          </div>
        </div>
      </div>
      <div className="profile-card__body">
        {summary.bio && <p className="profile-card__bio" dir="auto">{summary.bio}</p>}
        {stats.length > 0 && (
          <dl className="profile-card__stats">
            {stats.map(({ id, label, value, icon: Icon }) => (
              <div key={id}>
                <Icon size={17} aria-hidden={true} />
                <dt>{t(label)}</dt>
                <dd>{value === undefined
                  ? "—"
                  : id === "completionRate"
                    ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)}%`
                    : new Intl.NumberFormat(locale).format(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {(summary.isSteamVerified || date) && (
          <div className="profile-card__verification">
            {summary.isSteamVerified && (
              <div>
                <span className="profile-card__verification-icon"><BadgeCheck size={19} aria-hidden={true} /></span>
                <span><strong>{t("profile.steamVerified")}</strong><small>{t("profile.verifiedIdentity")}</small></span>
              </div>
            )}
            {date && (
              <div>
                <span className="profile-card__verification-icon"><CalendarDays size={19} aria-hidden={true} /></span>
                <span><strong>{t("profile.joined")}</strong><time dateTime={date}>{formatDate(date, locale)}</time></span>
              </div>
            )}
          </div>
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
