import { useEffect, useRef, useState } from "react";
import type { PublicBadge } from "../../../features/profile/publicBadges/types";
import { useTranslation } from "../../../i18n/TranslationContext";
import { PublicBadgeIcon } from "./PublicBadgeIcon";
import { PublicBadgeTooltip } from "./PublicBadgeTooltip";

export function PublicBadgeOverflow({ badges }: { badges: PublicBadge[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  return (
    <span className="public-badge-overflow">
      <button
        ref={button}
        type="button"
        className="public-badge-overflow__button"
        aria-expanded={open}
        aria-label={t("profile.moreBadgesCount", { count: badges.length })}
        onClick={() => setOpen((value) => !value)}
      >+{badges.length}</button>
      {open && (
        <span className="public-badge-overflow__panel" role="group" aria-label={t("profile.badges")}>
          {badges.map((badge) => (
            <PublicBadgeTooltip key={badge.slug} badge={badge}>
              <PublicBadgeIcon badge={badge} />
            </PublicBadgeTooltip>
          ))}
        </span>
      )}
    </span>
  );
}
