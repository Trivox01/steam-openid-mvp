import { useEffect } from "react";
import { ArrowRight, LockKeyhole, Share2, Trophy, X } from "lucide-react";
import type { AchievementDetails } from "../../types";
import { AchievementIcon } from "../ui/AchievementIcon";
import { useTranslation } from "../../i18n/TranslationContext";

export function AchievementDetailsDialog({ details, onClose, onOpenGame }: { details: AchievementDetails; onClose: () => void; onOpenGame: () => void }) {
  const { language, t } = useTranslation();
  const hidden = details.isHidden && !details.unlockedAt;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <article className="achievement-dialog" role="dialog" aria-modal="true" aria-labelledby="achievement-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="dialog-close" onClick={onClose} aria-label={t("common.close")}><X size={18} /></button>
        <div className="achievement-dialog-hero"><AchievementIcon src={details.iconUrl} alt={t("achievements.iconAlt", { title: details.title })} size={56} loading="eager" /><span>{details.unlockedAt ? <Trophy size={18} /> : <LockKeyhole size={18} />}</span></div>
        <span className={`rarity-tier ${details.rarityTier}`}>{t(`achievements.rarity.${details.rarityTier}`)}</span>
        <h2 id="achievement-dialog-title">{hidden ? t("gameDetails.hiddenAchievement") : details.title}</h2>
        <p className="dialog-game">{details.gameName} · {details.unlockedAt ? t("gameDetails.unlocked") : t("gameDetails.locked")}</p>
        <p className="dialog-description">{hidden ? t("achievements.hiddenDescription") : details.description}</p>
        <div className="dialog-stats"><div><span>{t("achievements.sort.rarity")}</span><strong>{details.rarityPercentage}%</strong></div><div><span>{t("gameDetails.unlocked")}</span><strong>{details.unlockedAt ? formatDate(details.unlockedAt, language) : t("achievements.notYet")}</strong></div></div>
        <footer><button onClick={onOpenGame}>{t("achievements.viewGame")} <ArrowRight size={14} /></button><button className="share-button"><Share2 size={14} /> {t("achievements.share")}</button></footer>
      </article>
    </div>
  );
}
function formatDate(value: string, language: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(language, { month: "short", day: "numeric", year: "numeric" }); }
