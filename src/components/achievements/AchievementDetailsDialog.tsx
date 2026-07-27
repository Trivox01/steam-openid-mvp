import { useEffect } from "react";
import { ArrowRight, LockKeyhole, Share2, Trophy, X } from "lucide-react";
import type { AchievementDetails } from "../../types";

const rarityLabels = { common: "Common", uncommon: "Uncommon", rare: "Rare", ultra_rare: "Ultra Rare" };
export function AchievementDetailsDialog({ details, onClose, onOpenGame }: { details: AchievementDetails; onClose: () => void; onOpenGame: () => void }) {
  const hidden = details.isHidden && !details.unlockedAt;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <article className="achievement-dialog" role="dialog" aria-modal="true" aria-labelledby="achievement-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="dialog-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div className="achievement-dialog-hero"><img src={details.iconUrl} alt="" /><span>{details.unlockedAt ? <Trophy size={18} /> : <LockKeyhole size={18} />}</span></div>
        <span className={`rarity-tier ${details.rarityTier}`}>{rarityLabels[details.rarityTier]}</span>
        <h2 id="achievement-dialog-title">{hidden ? "Hidden achievement" : details.title}</h2>
        <p className="dialog-game">{details.gameName} · {details.unlockedAt ? "Unlocked" : "Locked"}</p>
        <p className="dialog-description">{hidden ? "The name and description will be revealed when this achievement is unlocked." : details.description}</p>
        <div className="dialog-stats"><div><span>Rarity</span><strong>{details.rarityPercentage}%</strong></div><div><span>Unlocked</span><strong>{details.unlockedAt ? formatDate(details.unlockedAt) : "Not yet"}</strong></div></div>
        <footer><button onClick={onOpenGame}>View game <ArrowRight size={14} /></button><button className="share-button"><Share2 size={14} /> Share</button></footer>
      </article>
    </div>
  );
}
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }); }
