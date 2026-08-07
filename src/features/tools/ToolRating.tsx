import { Star } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "../../i18n/TranslationContext";
import type { ToolRatingSummary } from "./types";

function StarIcon({ filled, muted = false }: { filled: boolean; muted?: boolean }) {
  return (
    <Star
      aria-hidden="true"
      className={filled ? "tool-star tool-star--filled" : muted ? "tool-star tool-star--muted" : "tool-star"}
      strokeWidth={1.6}
    />
  );
}

export function ToolCardRating({ summary }: { summary?: ToolRatingSummary }) {
  const { t } = useTranslation();
  if (!summary || summary.total === 0) {
    return <span className="tool-rating-no-rating">{t("tools.noRatings")}</span>;
  }
  const average = summary.average ?? 0;
  const filled = Math.max(1, Math.floor(average));
  return (
    <span className="tool-rating tool-rating--card" role="img" aria-label={`${average.toFixed(1)} / 5, ${summary.total}`}>
      {[1, 2, 3, 4, 5].map((star) => <StarIcon key={star} filled={star <= filled} muted />)}
      <strong>{average.toFixed(1)}</strong>
      <small>({summary.total})</small>
    </span>
  );
}

export function RatingSummaryView({ summary }: { summary?: ToolRatingSummary }) {
  const { t } = useTranslation();
  if (!summary || summary.total === 0) {
    return <p className="tool-rating-no-rating">{t("tools.noRatings")}</p>;
  }
  const average = summary.average ?? 0;
  const filled = Math.max(1, Math.floor(average));
  return (
    <div className="tool-rating-summary">
      <div className="tool-rating tool-rating--summary" role="img" aria-label={`${average.toFixed(1)} / 5, ${summary.total}`}>
        {[1, 2, 3, 4, 5].map((star) => <StarIcon key={star} filled={star <= filled} />)}
        <strong>{average.toFixed(1)}</strong>
        <small>{t("tools.ratingCount", { count: summary.total })}</small>
      </div>
      <RatingDistribution summary={summary} />
    </div>
  );
}

function RatingDistribution({ summary }: { summary: ToolRatingSummary }) {
  const { t } = useTranslation();
  const total = Math.max(1, summary.total);
  const rows = [5, 4, 3, 2, 1];
  return (
    <div className="tool-rating-distribution" role="group" aria-label={t("tools.ratingDistribution")}>
      {rows.map((star) => {
        const count = summary.distribution[String(star) as "1" | "2" | "3" | "4" | "5"] ?? 0;
        return (
          <div className="tool-rating-row" key={star}>
            <span className="tool-rating-row__label" aria-hidden="true"><StarIcon filled />{star}</span>
            <div className="tool-rating-row__track" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={count} aria-label={`${star} / 5, ${count}`}>
              <span className="tool-rating-row__fill" style={{ width: `${Math.round((count / total) * 100)}%` }} />
            </div>
            <span className="tool-rating-row__count">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

export function StarPicker({ value, busy, disabled, onSelect }: { value: number | null; busy: boolean; disabled: boolean; onSelect: (rating: number) => void }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const preview = hover ?? focus ?? null;
  const move = (event: KeyboardEvent<HTMLDivElement>, direction: 1 | -1) => {
    const current = focus ?? value ?? 1;
    const next = current + direction;
    if (next < 1 || next > 5) return;
    event.preventDefault();
    setFocus(next);
    groupRef.current?.querySelector<HTMLButtonElement>(`[data-star="${next}"]`)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") move(event, 1);
    else if (event.key === "ArrowLeft") move(event, -1);
    else if (event.key === "Home") { event.preventDefault(); const next = 1; setFocus(next); groupRef.current?.querySelector<HTMLButtonElement>(`[data-star="${next}"]`)?.focus(); }
    else if (event.key === "End") { event.preventDefault(); const next = 5; setFocus(next); groupRef.current?.querySelector<HTMLButtonElement>(`[data-star="${next}"]`)?.focus(); }
  };
  return (
    <div ref={groupRef} className="tool-rating-picker" role="group" aria-label={t("tools.rateThisTool")} onKeyDown={onKeyDown}>
      {[1, 2, 3, 4, 5].map((star) => {
        const highlighted = preview !== null ? star <= preview : value !== null && star <= value;
        return (
          <button
            key={star}
            type="button"
            data-star={star}
            className={highlighted ? "tool-rating-picker__star is-highlighted" : "tool-rating-picker__star"}
            disabled={busy || disabled}
            tabIndex={focus === star || (focus === null && star === 1) ? 0 : -1}
            aria-label={t("tools.rateAria", { value: star })}
            aria-pressed={value === star}
            aria-busy={busy}
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setFocus(star)}
            onBlur={() => setFocus(null)}
            onClick={() => onSelect(star)}
          >
            <StarIcon filled={highlighted} />
          </button>
        );
      })}
    </div>
  );
}