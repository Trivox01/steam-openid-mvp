import { useEffect, useState } from "react";
import type { PublicBadgeClient } from "../../../features/profile/publicBadges/PublicBadgeClient";
import type { PublicBadge } from "../../../features/profile/publicBadges/types";
import { useTranslation } from "../../../i18n/TranslationContext";
import { PublicBadgeIcon } from "./PublicBadgeIcon";
import { PublicBadgeOverflow } from "./PublicBadgeOverflow";
import { PublicBadgeTooltip } from "./PublicBadgeTooltip";

const VISIBLE_BADGES = 5;

export function PublicBadgeList({ client }: { client?: PublicBadgeClient }) {
  const { t } = useTranslation();
  const [state, setState] = useState<
    { status: "loading" } |
    { status: "ready"; badges: PublicBadge[] } |
    { status: "error" }
  >({ status: "loading" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    setState({ status: "loading" });
    if (!client) {
      setState({ status: "ready", badges: [] });
      return () => request.abort();
    }
    client.list(request.signal).then(
      (badges) => setState({ status: "ready", badges }),
      (error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ status: "error" });
        }
      }
    );
    return () => request.abort();
  }, [client, revision]);

  if (state.status === "loading") {
    return <span className="public-badges__skeleton" aria-label={t("profile.badgesLoading")} />;
  }
  if (state.status === "error") {
    return (
      <button
        type="button"
        className="public-badges__retry"
        onClick={() => setRevision((value) => value + 1)}
        aria-label={t("profile.badgesRetry")}
      >!</button>
    );
  }
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
