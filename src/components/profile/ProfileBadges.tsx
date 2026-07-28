import { resolveBadgeIcon } from "../../features/profile/badges/badgeIcons";
import { badgeRarity } from "../../features/profile/badges/badgeRarity";
import { visibleBadges } from "../../features/profile/badges/badgeResolver";
import type { UserBadge } from "../../features/profile/badges/types";
import { useTranslation } from "../../i18n/TranslationContext";

export function ProfileBadges({ badges }: { badges: readonly UserBadge[] }) {
  const { t } = useTranslation();
  const { visible, remaining } = visibleBadges(badges);
  if (!visible.length) return null;

  return (
    <div className="profile-card__badges" aria-label={t("profile.badges")}>
      {visible.map((badge) => {
        const Icon = resolveBadgeIcon(badge.icon);
        const rarity = badgeRarity[badge.rarity];
        const name = t(`profile.badge.${badge.id}.name`);
        const description = t(`profile.badge.${badge.id}.description`);
        return (
          <span
            key={badge.id}
            className={`profile-badge ${rarity.className}`}
            tabIndex={0}
            aria-label={`${name}. ${description}. ${t(rarity.labelKey)}`}
          >
            <Icon size={15} aria-hidden={true} />
            <span className="profile-badge__rarity" aria-hidden="true">{t(rarity.labelKey)}</span>
            <span className="profile-badge__tooltip" role="tooltip">
              <span className="profile-badge__tooltip-title">
                <Icon size={24} aria-hidden={true} />
                <strong>{name}</strong>
              </span>
              <span>{description}</span>
              <small>{t(rarity.labelKey)}</small>
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
