import { useEffect, useRef } from "react";
import { ArrowRight, LockKeyhole, Share2, Trophy, X } from "lucide-react";
import type { AchievementDetails } from "../../types";
import { AchievementIcon } from "../ui/AchievementIcon";
import { useTranslation } from "../../i18n/TranslationContext";

export function AchievementDetailsDialog({ details, onClose, onOpenGame }: { details: AchievementDetails; onClose: () => void; onOpenGame: () => void }) {
  const { language, t } = useTranslation();
  const hidden = details.isHidden && !details.unlockedAt;
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const background = Array.from(backdropRef.current?.parentElement?.children ?? []).filter(
      (element): element is HTMLElement => element instanceof HTMLElement && element !== backdropRef.current
    );
    const backgroundState = background.map((element) => ({
      element,
      ariaHidden: element.getAttribute("aria-hidden"),
      inert: element.hasAttribute("inert")
    }));
    background.forEach((element) => {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    });
    requestAnimationFrame(() => headingRef.current?.focus());
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex='-1'])"
      );
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      const activeControl = Array.from(controls).includes(document.activeElement as HTMLElement);
      if (event.shiftKey && (!activeControl || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!activeControl || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      backgroundState.forEach(({ element, ariaHidden, inert }) => {
        if (!inert) element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
      previousFocus?.focus();
    };
  }, [details.id]);
  return (
    <div ref={backdropRef} className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <article ref={dialogRef} className="achievement-dialog" role="dialog" aria-modal="true" aria-labelledby="achievement-dialog-title" aria-describedby="achievement-dialog-description" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="dialog-close" onClick={onClose} aria-label={t("common.close")}><X size={18} /></button>
        <div className="achievement-dialog-hero"><AchievementIcon src={details.iconUrl} alt={t("achievements.iconAlt", { title: details.title })} size={56} loading="eager" /><span>{details.unlockedAt ? <Trophy size={18} /> : <LockKeyhole size={18} />}</span></div>
        <span className={`rarity-tier ${details.rarityTier}`}>{t(`achievements.rarity.${details.rarityTier}`)}</span>
        <h2 id="achievement-dialog-title" ref={headingRef} tabIndex={-1}>{hidden ? t("gameDetails.hiddenAchievement") : details.title}</h2>
        <p className="dialog-game">{details.gameName} · {details.unlockedAt ? t("gameDetails.unlocked") : t("gameDetails.locked")}</p>
        <p id="achievement-dialog-description" className="dialog-description">{hidden ? t("achievements.hiddenDescription") : details.description}</p>
        <div className="dialog-stats"><div><span>{t("achievements.sort.rarity")}</span><strong>{details.rarityPercentage}%</strong></div><div><span>{t("gameDetails.unlocked")}</span><strong>{details.unlockedAt ? formatDate(details.unlockedAt, language) : t("achievements.notYet")}</strong></div></div>
        <footer><button onClick={onOpenGame}>{t("achievements.viewGame")} <ArrowRight size={14} /></button><button className="share-button"><Share2 size={14} /> {t("achievements.share")}</button></footer>
      </article>
    </div>
  );
}
function formatDate(value: string, language: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(language, { month: "short", day: "numeric", year: "numeric" }); }
