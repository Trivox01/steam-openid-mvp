import { ArrowRight } from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useTranslation } from "../../i18n/TranslationContext";
import type { NexusTool, ToolBadge } from "./types";
import { ToolImage } from "./ToolImage";
import { ToolCardRating } from "./ToolRating";
import { ToolFavoriteButton } from "./ToolFavoriteButton";

const MAX_VISIBLE_BADGES = 2;

function byDisplayOrder(left: ToolBadge, right: ToolBadge) {
  return left.displayOrder - right.displayOrder;
}

export function ToolCard({ tool, onOpen, favoriteActive = false, favoriteBusy = false, onFavoriteToggle }: {
  tool: NexusTool;
  onOpen: (slug: string) => void;
  favoriteActive?: boolean;
  favoriteBusy?: boolean;
  onFavoriteToggle?: () => void;
}) {
  const { t } = useTranslation();
  const badges = [...tool.badges].sort(byDisplayOrder);
  const shownBadges = badges.slice(0, MAX_VISIBLE_BADGES);
  const hiddenBadges = badges.slice(MAX_VISIBLE_BADGES);
  const open = (event?: MouseEvent | KeyboardEvent) => {
    event?.stopPropagation();
    onOpen(tool.slug);
  };
  return (
    <article
      className="tool-card"
      role="link"
      tabIndex={0}
      aria-label={`${t("tools.viewDetails")}: ${tool.name}`}
      onClick={() => open()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open(event);
        }
      }}
    >
      <div className="tool-card__cover">
        <ToolImage src={tool.coverUrl} />
        {onFavoriteToggle && <ToolFavoriteButton active={favoriteActive} busy={favoriteBusy} onToggle={onFavoriteToggle} className="tool-card__favorite" />}
      </div>
      <div className="tool-card__body">
        <div className="tool-card__identity"><ToolImage src={tool.iconUrl} /><div><h3 dir="auto">{tool.name}</h3><span dir="auto">{t("tools.by", { developer: tool.developerName })}</span></div></div>
        <p>{tool.shortDescription}</p>
        <div className="tool-card__badges">{tool.category && <span className="tool-category-chip">{tool.category.name}</span>}{shownBadges.map(badge => <span className={`tool-badge tool-badge--${badge.color}`} title={badge.name} key={badge.id}>{badge.name}</span>)}{hiddenBadges.length > 0 && <span className="tool-badge tool-badge--overflow" title={hiddenBadges.map(badge => badge.name).join(", ")}>+{hiddenBadges.length}</span>}</div>
        <ToolCardRating summary={tool.ratingSummary} />
        <footer>
          <small dir="ltr">{t("tools.version", { version: tool.version })}</small>
          <button type="button" onClick={(event) => open(event)}>{t("tools.viewDetails")}<ArrowRight aria-hidden="true" /></button>
        </footer>
      </div>
    </article>
  );
}