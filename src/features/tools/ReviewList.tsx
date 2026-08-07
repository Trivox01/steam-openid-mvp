import { Flag, Star, ThumbsUp } from "lucide-react";
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

export function ReviewList({ items, ownReviewId, canReport, canVote, busyHelpfulId, language, onReport, onHelpful }: { items: ToolReviewView[]; ownReviewId?: string; canReport: boolean; canVote: boolean; busyHelpfulId?: string; language: string; onReport: (review: ToolReviewView) => void; onHelpful: (review: ToolReviewView) => void }) {
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
            <div className="review-card__actions">
              {review.id === ownReviewId ? (
                <span className="review-helpful-count" aria-label={t("review.helpfulCount", { count: review.helpfulCount })}><ThumbsUp aria-hidden="true" />{review.helpfulCount}</span>
              ) : canVote ? (
                <button
                  type="button"
                  className={review.currentUserHelpful ? "review-helpful is-on" : "review-helpful"}
                  aria-pressed={Boolean(review.currentUserHelpful)}
                  disabled={Boolean(busyHelpfulId)}
                  onClick={() => onHelpful(review)}
                >
                  <ThumbsUp aria-hidden="true" />
                  {review.currentUserHelpful ? t("review.helpfulMarked") : t("review.helpfulMark")}
                  <span className="review-helpful__count">{review.helpfulCount}</span>
                </button>
              ) : (
                <span className="review-helpful-count" aria-label={t("review.helpfulCount", { count: review.helpfulCount })}><ThumbsUp aria-hidden="true" />{review.helpfulCount}</span>
              )}
              {review.id !== ownReviewId && canReport && (
                <button type="button" className="review-card__report" onClick={() => onReport(review)}>
                  <Flag aria-hidden="true" />
                  {t("review.report")}
                </button>
              )}
            </div>
            {review.developerReply && (
              <div className="review-reply" lang={language}>
                <div className="review-reply__head">
<span className="review-reply__badge" role="img" aria-hidden="true"><ThumbsUp size={12} /><span>{t("review.developer")}</span></span>
                <time dateTime={review.developerReply.createdAt}>{new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(review.developerReply.createdAt))}</time>
                  {review.developerReply.edited && <small className="review-card__edited">{t("review.edited")}</small>}
                </div>
                <p dir="auto" className="review-reply__body">{review.developerReply.body}</p>
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}