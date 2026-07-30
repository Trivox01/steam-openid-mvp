import type { UserProfileSummary } from "../../features/profile/types";
import { useTranslation } from "../../i18n/TranslationContext";
import { ProfileAvatar } from "../ui/ProfileAvatar";
import { PublicBadgeList } from "./publicBadges/PublicBadgeList";

export function ProfileIdentity({ summary }: { summary: UserProfileSummary }) {
  const { t } = useTranslation();
  return (
    <section className="profile-card__identity">
      <div className="profile-card__identity-row">
        <div className="profile-card__avatar-wrap">
          <ProfileAvatar src={summary.avatarUrl} name={summary.displayName} className="profile-card__avatar" />
          {summary.status && (
            <span
              className={`profile-card__status profile-card__status--${summary.status}`}
              aria-label={t(`profile.status.${summary.status}`)}
            />
          )}
        </div>
        <div className="profile-card__heading">
          <div className="profile-card__name-row">
            <h2 dir="auto">{summary.displayName}</h2>
            <PublicBadgeList />
          </div>
          {summary.username && <p className="profile-card__username" dir="auto">@{summary.username}</p>}
        </div>
      </div>
      {summary.bio && <p className="profile-card__bio" dir="auto">{summary.bio}</p>}
    </section>
  );
}
