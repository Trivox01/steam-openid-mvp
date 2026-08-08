export function formatSessionSummaryDuration(
  seconds: number,
  language: string,
  t: (key: string, variables?: Record<string, string | number>) => string
) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const number = new Intl.NumberFormat(language);
  if (language === "ar") {
    if (hours > 0) {
      const hoursText = formatArabicUnit(hours, "hours", number, t);
      return minutes > 0
        ? t("sessionSummary.duration.join", { first: hoursText, second: formatArabicUnit(minutes, "minutes", number, t) })
        : hoursText;
    }
    if (minutes > 0) return formatArabicUnit(minutes, "minutes", number, t);
    return formatArabicUnit(safe, "seconds", number, t);
  }
  if (hours > 0) {
    return t("sessionSummary.duration.hoursMinutes", {
      hours: number.format(hours),
      minutes: number.format(minutes)
    });
  }
  if (minutes > 0) return t("sessionSummary.duration.minutes", { minutes: number.format(minutes) });
  return t("sessionSummary.duration.seconds", { seconds: number.format(safe) });
}

export function sessionSummaryPluralKey(base: string, count: number, language: string) {
  const category = new Intl.PluralRules(language).select(count);
  return `${base}.${language === "ar" ? category : category === "one" ? "one" : "other"}`;
}

function formatArabicUnit(
  value: number,
  unit: "hours" | "minutes" | "seconds",
  number: Intl.NumberFormat,
  t: (key: string, variables?: Record<string, string | number>) => string
) {
  const category = new Intl.PluralRules("ar").select(value);
  return t(`sessionSummary.duration.${unit}.${category}`, { count: number.format(value) });
}
