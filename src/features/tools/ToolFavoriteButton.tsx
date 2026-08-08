import { Heart } from "lucide-react";
import type { MouseEvent } from "react";
import { useTranslation } from "../../i18n/TranslationContext";

export function ToolFavoriteButton({ active, busy = false, onToggle, className = "" }: { active: boolean; busy?: boolean; onToggle: () => void; className?: string }) {
  const { t } = useTranslation();
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle();
  };
  return (
    <button
      type="button"
      className={`tool-favorite ${active ? "is-active" : ""} ${className}`.trim()}
      aria-pressed={active}
      aria-label={active ? t("toolsPage.favoriteRemove") : t("toolsPage.favoriteAdd")}
      title={active ? t("toolsPage.favoriteRemove") : t("toolsPage.favoriteAdd")}
      aria-busy={busy || undefined}
      disabled={busy}
      onClick={handleClick}
    >
      <Heart aria-hidden="true" />
    </button>
  );
}