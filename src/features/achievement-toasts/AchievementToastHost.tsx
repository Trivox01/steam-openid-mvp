import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AchievementIcon } from "../../components/ui/AchievementIcon";
import { useTranslation } from "../../i18n/TranslationContext";
import { achievementToastCoordinator } from "../../services/compositionRoot";

export function AchievementToastHost() {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const [snapshot, setSnapshot] = useState(achievementToastCoordinator.getSnapshot());
  useEffect(() => achievementToastCoordinator.subscribe(setSnapshot), []);
  useEffect(() => {
    const update = () => achievementToastCoordinator.setAppVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const event = snapshot.active;
  const rarity = validRarity(event?.rarity);
  const pending = snapshot.queued + snapshot.overflow;
  return <aside className="achievement-toast-host" aria-live="polite" aria-atomic="true">
    <AnimatePresence mode="wait">
    {event && <motion.section
      key={event.eventId}
      className="achievement-toast nexus-glass nexus-glass--strong"
      role="status"
      initial={{ opacity: 0, y: reducedMotion ? 0 : -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reducedMotion ? 0 : -5 }}
      transition={{ duration: reducedMotion ? 0 : 0.16 }}
      onMouseEnter={() => achievementToastCoordinator.pause("hover")}
      onMouseLeave={() => achievementToastCoordinator.resume("hover")}
      onFocusCapture={() => achievementToastCoordinator.pause("focus")}
      onBlurCapture={() => achievementToastCoordinator.resume("focus")}
    >
      <AchievementIcon src={event.iconUrl} alt={t("achievementToast.iconAlt", { name: event.name })} size={56} loading="eager" />
      <div className="achievement-toast__copy">
        <span className="achievement-toast__eyebrow">{t("achievementToast.unlocked")}</span>
        <strong dir="auto">{event.name}</strong>
        {event.description && <p dir="auto">{event.description}</p>}
        <div className="achievement-toast__meta">
          {rarity !== undefined && <span>{t("achievementToast.rarity", { value: formatPercent(rarity) })}</span>}
          {pending > 0 && <span>{t("achievementToast.more", { count: pending })}</span>}
        </div>
      </div>
      <button type="button" className="achievement-toast__close" onClick={() => achievementToastCoordinator.dismiss()} aria-label={t("achievementToast.dismiss")}>
        <X aria-hidden="true" />
      </button>
    </motion.section>}
    </AnimatePresence>
  </aside>;
}

function validRarity(value?: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
}

function formatPercent(value: number) { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value); }
