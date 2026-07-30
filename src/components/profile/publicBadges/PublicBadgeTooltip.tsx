import type { PublicBadge } from "../../../features/profile/publicBadges/types";
import { useTranslation } from "../../../i18n/TranslationContext";
import { BadgeTooltip } from "../BadgeTooltip";
import { PublicBadgeIcon } from "./PublicBadgeIcon";
import type { ReactNode } from "react";

export function PublicBadgeTooltip({
  badge,
  children
}: { badge: PublicBadge; children: ReactNode }) {
  const { t } = useTranslation();
  const rarity = t(`profile.rarity.${badge.rarity}`);
  const category = t(`profile.badgeCategory.${badge.category}`);
  return (
    <BadgeTooltip
      label={`${badge.displayName}. ${badge.description}. ${rarity}, ${category}`}
      content={
        <>
          <span className="profile-badge__tooltip-title">
            <PublicBadgeIcon badge={badge} />
            <strong dir="auto">{badge.displayName}</strong>
          </span>
          <span dir="auto">{badge.description}</span>
          <small>{rarity} · {category}</small>
        </>
      }
    >
      {children}
    </BadgeTooltip>
  );
}
