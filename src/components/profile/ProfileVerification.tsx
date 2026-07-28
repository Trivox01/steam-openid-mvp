import { BadgeCheck, CalendarDays } from "lucide-react";
import type { UserProfileSummary } from "../../features/profile/types";
import { useTranslation } from "../../i18n/TranslationContext";

export function ProfileVerification({ summary }: { summary: UserProfileSummary }) {
  const { language, t } = useTranslation();
  const locale = language === "ar" ? "ar" : "en";
  const date = summary.memberSince ?? summary.authenticatedAt;
  if (!summary.isSteamVerified && !date) return null;

  return (
    <section className="profile-card__verification">
      {summary.isSteamVerified && (
        <div>
          <span className="profile-card__verification-icon"><BadgeCheck size={19} aria-hidden={true} /></span>
          <span><strong>{t("profile.steamVerified")}</strong><small>{t("profile.verifiedIdentity")}</small></span>
        </div>
      )}
      {date && (
        <div>
          <span className="profile-card__verification-icon"><CalendarDays size={19} aria-hidden={true} /></span>
          <span>
            <strong>{t(summary.memberSince ? "profile.joined" : "profile.connected")}</strong>
            <time dateTime={date}>{formatDate(date, locale)}</time>
          </span>
        </div>
      )}
    </section>
  );
}

function formatDate(value: string, locale: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(parsed);
}
