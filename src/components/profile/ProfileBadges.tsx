import { resolveBadgeIcon } from "../../features/profile/badges/badgeIcons";
import { badgeRarity } from "../../features/profile/badges/badgeRarity";
import { visibleBadges } from "../../features/profile/badges/badgeResolver";
import type { UserBadge } from "../../features/profile/badges/types";
import { useTranslation } from "../../i18n/TranslationContext";
import { BadgeTooltip } from "./BadgeTooltip";

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
          <BadgeTooltip
            key={badge.id}
            label={`${name}. ${description}. ${t(rarity.labelKey)}`}
            content={
              <>
                <span className="profile-badge__tooltip-title">
                  <Icon size={24} aria-hidden={true} />
                  <strong>{name}</strong>
                </span>
                <span>{description}</span>
                <small>{t(rarity.labelKey)}</small>
              </>
            }
          >
            <span className={rarity.className}><Icon size={18} aria-hidden={true} /></span>
            <span className="profile-badge__rarity" aria-hidden="true">{t(rarity.labelKey)}</span>
          </BadgeTooltip>
        );
      })}
      {remaining > 0 && (
        <BadgeTooltip
          label={t("profile.moreBadgesCount", { count: remaining })}
          content={<span>{t("profile.moreBadgesCount", { count: remaining })}</span>}
        >
          <span className="profile-badge--more">+{remaining}</span>
        </BadgeTooltip>
      )}
    </div>
  );
}
