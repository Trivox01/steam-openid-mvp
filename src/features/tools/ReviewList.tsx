import { Flag, Star } from "lucide-react";
import { ProfileAvatar } from "../../components/ui/ProfileAvatar";
import { useTranslation } from "../../i18n/TranslationContext";
import type { ToolReviewView } from "./types";

function reviewStars(rating: number | null) {
  return (
    <span className="tool-review-card__rating" role="img" aria-label={rating === null ? "no rating" : `${rating} / 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          aria-hidden="true"
          className={rating !== null && star <= rating ? "tool-star tool-star--filled" : "tool-star tool-star--muted"}
          strokeWidth={1.6}
        />
      ))}
    </span>
  );
}

export function ReviewList({ items, ownReviewId, canReport, language, onReport }: { items: ToolReviewView[]; ownReviewId?: string; canReport: boolean; language: string; onReport: (review: ToolReviewView) => void }) {
  const { t } = useTranslation();
  if (!items.length) return <p className="review-empty">{t("review.empty")}</p>;
  return (
    <ul className="review-list">
      {items.map((review) => (
        <li className="review-card" key={review.id}>
          <ProfileAvatar src={review.avatarUrl} name={review.displayName} />
          <div className="review-card__body">
            <span dir="auto">{review.displayName}</span>
            {reviewStars(review.rating)}
            <time dateTime={review.createdAt}>{new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(review.createdAt))}</time>
            {review.edited && <small className="review-card__edited">{t("review.edited")}</small>}
            {review.title && <h3 dir="auto">{review.title}</h3>}
            <p dir="auto" className="review-card__text">{review.body}</p>
            {review.id !== ownReviewId && canReport && (
              <button type="button" className="review-card__report" onClick={() => onReport(review)}>
                <Flag aria-hidden="true" />
                {t("review.report")}
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}