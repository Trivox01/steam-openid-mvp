import { visibleProfileBadges } from "../../features/profile/badges/resolveProfileBadges";
import type { UserBadge } from "../../features/profile/badges/types";
import { useTranslation } from "../../i18n/TranslationContext";

export function ProfileBadges({ badges }: { badges: readonly UserBadge[] }) {
  const { t } = useTranslation();
  const { visible, remaining } = visibleProfileBadges(badges);
  if (!visible.length) return null;

  return (
    <div className="profile-card__badges" aria-label={t("profile.badges")}>
      {visible.map((badge) => {
        const Icon = badge.icon;
        return (
          <span
            key={badge.id}
            className={`profile-badge profile-badge--${badge.rarity}`}
            tabIndex={0}
            aria-label={`${badge.name}. ${badge.description}. ${t(`profile.rarity.${badge.rarity}`)}`}
          >
            <Icon size={15} aria-hidden={true} />
            <span className="profile-badge__rarity" aria-hidden="true">{t(`profile.rarity.${badge.rarity}`)}</span>
            <span className="profile-badge__tooltip" role="tooltip">
              <strong>{badge.name}</strong>
              <span>{badge.description}</span>
            </span>
          </span>
        );
      })}
      {remaining > 0 && (
        <span className="profile-badge profile-badge--more" tabIndex={0} aria-label={t("profile.moreBadgesCount", { count: remaining })}>
          +{remaining}
          <span className="profile-badge__tooltip" role="tooltip">{t("profile.moreBadgesCount", { count: remaining })}</span>
        </span>
      )}
    </div>
  );
}
