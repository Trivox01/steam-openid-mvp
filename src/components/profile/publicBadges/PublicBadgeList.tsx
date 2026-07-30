import { usePublicBadges } from "../../../features/profile/publicBadges/PublicBadgeContext";
import { useTranslation } from "../../../i18n/TranslationContext";
import { PublicBadgeIcon } from "./PublicBadgeIcon";
import { PublicBadgeOverflow } from "./PublicBadgeOverflow";
import { PublicBadgeTooltip } from "./PublicBadgeTooltip";

const VISIBLE_BADGES = 5;

export function PublicBadgeList() {
  const { t } = useTranslation();
  const { state, retry } = usePublicBadges();

  if (state.status === "loading") {
    return <span className="public-badges__skeleton" aria-label={t("profile.badgesLoading")} />;
  }
  if (state.status === "error") {
    return (
      <button
        type="button"
        className="public-badges__retry"
        onClick={retry}
        aria-label={t("profile.badgesRetry")}
      >!</button>
    );
  }
  if (state.status === "idle") return null;
  if (!state.badges.length) return null;
  const visible = state.badges.slice(0, VISIBLE_BADGES);
  const overflow = state.badges.slice(VISIBLE_BADGES);
  return (
    <span className="profile-card__badges" aria-label={t("profile.badges")}>
      {visible.map((badge) => (
        <PublicBadgeTooltip key={badge.slug} badge={badge}>
          <span className={`public-badge public-badge--${badge.rarity}`}>
            <PublicBadgeIcon badge={badge} />
            <span className="profile-badge__rarity" aria-hidden={true}>{t(`profile.rarity.${badge.rarity}`)}</span>
          </span>
        </PublicBadgeTooltip>
      ))}
      {overflow.length > 0 && <PublicBadgeOverflow badges={overflow} />}
    </span>
  );
}
