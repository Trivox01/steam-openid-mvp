import { Pencil } from "lucide-react";
import type { UserProfileSummary } from "../../features/profile/types";
import { useTranslation } from "../../i18n/TranslationContext";
import { ProfileBanner } from "./ProfileBanner";
import { ProfileIdentity } from "./ProfileIdentity";
import { ProfileStats } from "./ProfileStats";
import { ProfileVerification } from "./ProfileVerification";

export function ProfileCard({ summary, onAction }: { summary: UserProfileSummary; onAction?: () => void }) {
  const { t } = useTranslation();
  const actionLabel = summary.isCurrentUser ? t("profile.editProfile") : t("profile.viewFullProfile");
  const actionUnavailableLabel = summary.isCurrentUser
    ? t("profile.editUnavailable")
    : t("profile.viewUnavailable");

  return (
    <article className="profile-card">
      <ProfileBanner src={summary.bannerUrl} />
      <ProfileIdentity summary={summary} />
      <div className="profile-card__body">
        <ProfileStats stats={summary.stats} />
        <ProfileVerification summary={summary} />
        <span
          className="profile-card__action-wrap"
          title={!onAction ? actionUnavailableLabel : undefined}
        >
          <button
            className="primary-button profile-card__action"
            type="button"
            onClick={onAction}
            disabled={!onAction}
            aria-label={onAction ? actionLabel : `${actionLabel}. ${actionUnavailableLabel}`}
          >
            <Pencil size={17} aria-hidden={true} />
            {actionLabel}
          </button>
        </span>
      </div>
    </article>
  );
}
