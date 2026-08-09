import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, ExternalLink, Trash2, X } from "lucide-react";
import { ToolImage } from "../features/tools/ToolImage";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/environment";
import { inspectToolUrl } from "../features/tools/safeToolUrl";
import type { NexusTool, ToolRatingSummary, ToolReviewReason, ToolReviewSort, ToolReviewView } from "../features/tools/types";
import { RatingSummaryView, StarPicker } from "../features/tools/ToolRating";
import { ToolFavoriteButton } from "../features/tools/ToolFavoriteButton";
import { ReviewForm } from "../features/tools/ReviewForm";
import { ReviewList } from "../features/tools/ReviewList";
import { ReportReviewModal } from "../features/tools/ReportReviewModal";
import { services } from "../services/compositionRoot";
import { useTranslation } from "../i18n/TranslationContext";
import { ErrorView, LoadingView } from "../components/ui/StateViews";

export function ToolDetailsPage({ slug, onBack }: { slug: string; onBack: () => void }) {
  const { language, t } = useTranslation();
  const [tool, setTool] = useState<NexusTool>();
  const [error, setError] = useState(false);
  const [target, setTarget] = useState<{ url: string; domain: string }>();
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState(false);
  const [summary, setSummary] = useState<ToolRatingSummary>();
  const [mine, setMine] = useState<number | null>(null);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [ratingNotice, setRatingNotice] = useState<"updated" | "removed" | "removed-failed" | "failed" | "too" | "sign">();
  const [myReview, setMyReview] = useState<ToolReviewView | null>();
  const [reviews, setReviews] = useState<ToolReviewView[]>([]);
  const [reviewsTotal, setReviewsTotal] = useState(0);
  const [reviewsPage, setReviewsPage] = useState(1);
  const [reviewsSort, setReviewsSort] = useState<ToolReviewSort>("newest");
  const [reviewsError, setReviewsError] = useState(false);
  const [reviewFormOpen, setReviewFormOpen] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewNotice, setReviewNotice] = useState<"" | "saved" | "removed" | "removed-failed" | "saved-failed" | "sign">("",);
  const [reportTarget, setReportTarget] = useState<ToolReviewView>();
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const [helpfulBusyId, setHelpfulBusyId] = useState("");
  const [helpfulError, setHelpfulError] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favBusy, setFavBusy] = useState(false);
  const [favNotice, setFavNotice] = useState("");
  const signedIn = Boolean(services.steamOpenId?.getActiveSession());
  useEffect(() => {
    const controller = new AbortController();
    services.tools?.get(slug, controller.signal).then((value) => { setTool(value); setSummary(value.ratingSummary); }).catch(() => setError(true));
    return () => controller.abort();
  }, [slug]);
  useEffect(() => {
    if (!tool) return;
    const controller = new AbortController();
    if (services.tools) {
      void services.tools.ratingSummary(tool.id, controller.signal).then(setSummary).catch(() => undefined);
      services.tools.favoriteStatus(tool.id, controller.signal).then((value) => { if (!controller.signal.aborted) setIsFavorite(value.isFavorite); }).catch(() => undefined);
      if (services.steamOpenId?.getActiveSession()) {
        services.tools.myRating(tool.id).then((value) => { if (!controller.signal.aborted) setMine(value); }).catch(() => undefined);
        services.tools.myReview(tool.id).then((value) => { if (!controller.signal.aborted) setMyReview(value); }).catch(() => setMyReview(null));
      } else {
        setMyReview(null);
      }
    }
    return () => controller.abort();
  }, [tool, signedIn, slug]);
  useEffect(() => {
    if (!tool || !services.tools) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(reviewsPage), pageSize: "10", sort: reviewsSort });
    services.tools.reviews(tool.id, params, controller.signal).then((page) => {
      if (controller.signal.aborted) return;
      setReviews(page.items);
      setReviewsTotal(page.total);
      setReviewsError(false);
    }).catch(() => { if (!controller.signal.aborted) setReviewsError(true); });
    return () => controller.abort();
  }, [tool, reviewsPage, reviewsSort, signedIn]);
  const refreshReviewData = async () => {
    if (!services.tools || !tool) return;
    try {
      const page = await services.tools.reviews(tool.id, new URLSearchParams({ page: String(reviewsPage), pageSize: "10", sort: reviewsSort }));
      setReviews(page.items);
      setReviewsTotal(page.total);
    } catch { /* keep current list */ }
    if (services.steamOpenId?.getActiveSession()) {
      try { setMyReview(await services.tools.myReview(tool.id)); } catch { /* keep current my review */ }
    }
  };
  const toggleHelpful = async (review: ToolReviewView) => {
    if (!services.tools || !tool || helpfulBusyId) return;
    setHelpfulBusyId(review.id);
    setHelpfulError(false);
    try {
      const state = await services.tools.setReviewHelpful(tool.id, review.id, !review.currentUserHelpful);
      setReviews((current) => current.map((item) => item.id === review.id ? { ...item, helpfulCount: state.helpfulCount, currentUserHelpful: state.currentUserHelpful } : item));
    } catch (reason) {
      if (String((reason as Error)?.message).includes("RATE_LIMITED")) { /* keep quiet; user retries later */ }
      setHelpfulError(true);
    } finally {
      setHelpfulBusyId("");
    }
  };
  const saveReview = async (title: string, body: string) => {
    if (!services.tools || !tool || reviewBusy) return;
    setReviewBusy(true);
    setReviewNotice("");
    try {
      await services.tools.saveReview(tool.id, { title: title || undefined, body });
      setReviewFormOpen(false);
      setReviewNotice("saved");
      await refreshReviewData();
    } catch (reason) {
      if (String((reason as Error)?.message).includes("AUTHENTICATION_REQUIRED")) setReviewNotice("sign");
      else setReviewNotice("saved-failed");
    } finally {
      setReviewBusy(false);
    }
  };
  const removeMine = async () => {
    if (!services.tools || !tool) return;
    if (!window.confirm(t("review.deleteConfirm"))) return;
    setReviewNotice("");
    try {
      await services.tools.removeReview(tool.id);
      setMyReview(null);
      setReviewNotice("removed");
      await refreshReviewData();
    } catch {
      setReviewNotice("removed-failed");
    }
  };
  const submitReport = async (reason: ToolReviewReason, details: string) => {
    if (!services.tools || !tool || !reportTarget || reportBusy) return;
    setReportBusy(true);
    setReportError(false);
    try {
      await services.tools.reportReview(tool.id, reportTarget.id, reason, details || undefined);
      setReportTarget(undefined);
      setReportDone(true);
      window.setTimeout(() => setReportDone(false), 4000);
    } catch {
      setReportError(true);
    } finally {
      setReportBusy(false);
    }
  };
  const refreshSummary = async () => {
    if (!services.tools || !tool) return;
    try { setSummary(await services.tools.ratingSummary(tool.id)); } catch { /* keep previous summary */ }
  };
  const saveRating = async (rating: number) => {
    if (!services.tools || ratingBusy) return;
    setRatingBusy(true);
    setRatingNotice(undefined);
    try {
      await services.tools.saveRating(tool!.id, rating);
      setMine(rating);
      setRatingNotice("updated");
      await refreshSummary();
    } catch (reason) {
      if (String((reason as Error)?.message).includes("RATING_RATE_LIMITED")) setRatingNotice("too");
      else if (String((reason as Error)?.message).includes("AUTHENTICATION_REQUIRED")) setRatingNotice("sign");
      else setRatingNotice("failed");
    } finally {
      setRatingBusy(false);
    }
  };
  const removeRating = async () => {
    if (!services.tools || !tool || ratingBusy) return;
    setRatingBusy(true);
    setRatingNotice(undefined);
    try {
      await services.tools.removeRating(tool.id);
      setMine(null);
      setRatingNotice("removed");
      await refreshSummary();
    } catch {
      setRatingNotice("removed-failed");
    } finally {
      setRatingBusy(false);
    }
  };
  const toggleFavorite = async () => {
    if (!services.tools || !tool || favBusy) return;
    setFavBusy(true);
    setFavNotice("");
    try {
      const result = await services.tools.favorite(tool.id, !isFavorite);
      setIsFavorite(result.isFavorite);
    } catch (reason) {
      setFavNotice(String((reason as Error)?.message).includes("AUTHENTICATION_REQUIRED") ? "sign" : "failed");
    } finally {
      setFavBusy(false);
    }
  };
  if (error) return <ErrorView message={t("tools.loadError")} onRetry={() => location.reload()} />;
  if (!tool) return <LoadingView label={t("state.loading")} />;
  const sortedBadges = [...tool.badges].sort((left, right) => left.displayOrder - right.displayOrder);
  const badgeSlots = tool.category ? 2 : 3;
  const visibleBadges = sortedBadges.slice(0, badgeSlots);
  const hiddenBadgeCount = sortedBadges.length - visibleBadges.length;
  const hasRatings = (summary?.total ?? 0) > 0;
  const hasReviews = reviewsTotal > 0;
  const requestOpen = (value: string) => {
    try { setTarget(inspectToolUrl(value)); setOpenError(false); }
    catch { setOpenError(true); }
  };
  const open = async () => {
    if (!target) return;
    setOpening(true); setOpenError(false);
    try {
      if (!isTauriRuntime()) throw new Error("desktop_only");
      await invoke("open_external_tool_url", { url: target.url });
      setTarget(undefined);
    } catch { setOpenError(true); }
    finally { setOpening(false); }
  };
  return <article className="tool-details">
    <button className="back-button" type="button" onClick={onBack}><ArrowLeft />{t("onboarding.back")}</button>
    <header className="tool-details__hero">
      <ToolImage className="tool-details__cover" src={tool.coverUrl} eager />
      <div className="tool-details__hero-content">
        <div className="tool-details__identity">
          <ToolImage className="tool-details__icon" src={tool.iconUrl} eager />
          <div className="tool-details__heading">
            <span className="tool-details__system-label" dir="ltr">NEXUS SYSTEM // TOOL</span>
            <div className="tool-card__badges">{tool.category && <span className="tool-category-chip">{tool.category.name}</span>}{visibleBadges.map((badge) => <span className={`tool-badge tool-badge--${badge.color}`} key={badge.id}>{badge.name}</span>)}{hiddenBadgeCount > 0 && <span className="tool-badge tool-badge--overflow">+{hiddenBadgeCount}</span>}</div>
            <h1 dir="auto">{tool.name}</h1>
            <span className="tool-details__publisher" dir="auto">{t("tools.by", { developer: tool.developerName })}</span>
          </div>
        </div>
        <p className="tool-details__summary" dir="auto">{tool.shortDescription}</p>
        <div className="tool-details__meta"><span dir="ltr">{t("tools.version", { version: tool.version })}</span><span>{t(`tools.trust.${tool.downloadTrust}`)}</span></div>
        <div className="tool-details__actions">
          <button className="tool-download" type="button" onClick={() => requestOpen(tool.externalDownloadUrl)}><Download />{t("tools.download")}</button>
          <ToolFavoriteButton active={isFavorite} busy={favBusy} onToggle={() => void toggleFavorite()} className="tool-details__favorite" />
        </div>
        {favNotice && <p className="tool-rating-feedback is-error" role="alert">{favNotice === "sign" ? t("review.signInRequired") : t("toolsPage.favoriteError")}</p>}
      </div>
    </header>
    <section className={`tool-details__ratings ${hasRatings ? "" : "is-empty"}`.trim()}>
      <h2 className="nexus-display-title">{t("tools.rating")}</h2>
      <div className="tool-rating-body">
        <RatingSummaryView summary={summary} />
        <div className="tool-rating-yours">
          <h3>{t("tools.yourRating")}</h3>
          {signedIn ? (
            <>
              <StarPicker value={mine} busy={ratingBusy} disabled={false} onSelect={rating => void saveRating(rating)} />
              {mine !== null && !ratingBusy && <button className="tool-rating-remove" type="button" onClick={() => void removeRating()}><Trash2 aria-hidden="true" />{t("tools.removeRating")}</button>}
            </>
          ) : (
            <p className="tool-rating-sign">{t("tools.ratingSignInRequired")}</p>
          )}
          {ratingNotice === "updated" && <p className="tool-rating-feedback is-success" role="status">{t("tools.ratingUpdated")}</p>}
          {ratingNotice === "removed" && <p className="tool-rating-feedback is-success" role="status">{t("tools.ratingRemoved")}</p>}
          {ratingNotice === "removed-failed" && <p className="tool-rating-feedback is-error" role="alert">{t("tools.ratingSaveFailed")}</p>}
          {ratingNotice === "failed" && <p className="tool-rating-feedback is-error" role="alert">{t("tools.ratingSaveFailed")}</p>}
          {ratingNotice === "too" && <p className="tool-rating-feedback is-error" role="alert">{t("tools.ratingTooMany")}</p>}
          {ratingNotice === "sign" && <p className="tool-rating-feedback is-error" role="alert">{t("tools.ratingSignInRequired")}</p>}
        </div>
      </div>
    </section>
    <section className={`tool-details__reviews ${hasReviews ? "" : "is-empty"}`.trim()} aria-labelledby="reviews-title">
      <h2 id="reviews-title" className="nexus-display-title">{t("review.title")} <small>({reviewsTotal})</small></h2>
      <div className="tool-review-yours">
        {signedIn ? (
          myReview ? (
            <div className="tool-review-mine">
              <div>
                <strong>{t("review.yourReview")}</strong>
                {myReview.title && <p dir="auto">{myReview.title}</p>}
                <p dir="auto" className="tool-review-mine__body">{myReview.body}</p>
              </div>
              <div className="tool-review-mine__actions">
                <button type="button" className="secondary-button" onClick={() => setReviewFormOpen(true)}>{t("review.edit")}</button>
                <button type="button" onClick={() => void removeMine()}><Trash2 aria-hidden="true" />{t("review.delete")}</button>
              </div>
            </div>
          ) : (
            <div className="tool-review-write">
              <p>{t("review.writePrompt")}</p>
              <button type="button" className="primary-button" onClick={() => setReviewFormOpen(true)}>{t("review.write")}</button>
            </div>
          )
        ) : (
          <p className="tool-rating-sign">{t("review.signInRequired")}</p>
        )}
        {reviewNotice === "saved" && <p className="tool-rating-feedback is-success" role="status">{t("review.saved")}</p>}
        {reviewNotice === "removed" && <p className="tool-rating-feedback is-success" role="status">{t("review.removed")}</p>}
        {reviewNotice === "removed-failed" && <p className="tool-rating-feedback is-error" role="alert">{t("review.saveFailed")}</p>}
        {reviewNotice === "saved-failed" && <p className="tool-rating-feedback is-error" role="alert">{t("review.saveFailed")}</p>}
        {reviewNotice === "sign" && <p className="tool-rating-feedback is-error" role="alert">{t("review.signInRequired")}</p>}
      </div>
      {hasReviews && <div className="tool-reviews-toolbar">
        <span>{t("review.sortLabel")}</span>
        <select aria-label={t("review.sortLabel")} value={reviewsSort} onChange={(event) => { setReviewsSort(event.target.value as ToolReviewSort); setReviewsPage(1); }}>
          <option value="newest">{t("review.sortNewest")}</option>
          <option value="highest_rating">{t("review.sortHighest")}</option>
          <option value="lowest_rating">{t("review.sortLowest")}</option>
        </select>
      </div>}
      {reviewsError && <p className="review-load-error" role="alert">{t("review.loadFailed")}</p>}
      {helpfulError && <p className="tool-rating-feedback is-error" role="alert">{t("review.helpfulFailed")}</p>}
      <ReviewList items={reviews} ownReviewId={myReview?.id} canReport={signedIn} canVote={signedIn} busyHelpfulId={helpfulBusyId} language={language} onReport={setReportTarget} onHelpful={(review) => void toggleHelpful(review)} />
      {reviewsTotal > 10 && (
        <nav className="review-pagination" aria-label={t("review.pagination")}>
          <button type="button" disabled={reviewsPage <= 1} onClick={() => setReviewsPage(reviewsPage - 1)}>{t("review.previous")}</button>
          <span>{t("review.pageOf", { page: reviewsPage, total: Math.max(1, Math.ceil(reviewsTotal / 10)) })}</span>
          <button type="button" disabled={reviewsPage >= Math.ceil(reviewsTotal / 10)} onClick={() => setReviewsPage(reviewsPage + 1)}>{t("review.next")}</button>
        </nav>
      )}
    </section>
    <section className="tool-details__description">
      <p dir="auto">{tool.fullDescription}</p><dl><div><dt>{t("tools.domain")}</dt><dd dir="ltr">{tool.downloadDomain}</dd></div><div><dt>{t("tools.updated", { date: "" }).trim()}</dt><dd>{new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(tool.updatedAt))}</dd></div></dl>
      {tool.officialWebsiteUrl && <button type="button" className="secondary-button" onClick={() => requestOpen(tool.officialWebsiteUrl!)}><ExternalLink />{t("tools.website")}</button>}
      {openError && !target && <p role="alert">{t("tools.openError")}</p>}
    </section>
      {target && <ExternalLinkDialog domain={target.domain} busy={opening} error={openError} onCancel={() => setTarget(undefined)} onContinue={() => void open()} />}
      {reviewFormOpen && <ReviewForm value={myReview ?? undefined} busy={reviewBusy} onCancel={() => setReviewFormOpen(false)} onSave={saveReview} />}
      {reportTarget && <ReportReviewModal review={reportTarget} busy={reportBusy} error={reportError} onCancel={() => setReportTarget(undefined)} onSubmit={(reason, details) => void submitReport(reason, details)} />}
      {reportDone && <p className="tool-rating-feedback is-success review-report-done" role="status">{t("review.reported")}</p>}
    </article>;
}

function ExternalLinkDialog({ domain, busy, error, onCancel, onContinue }: { domain: string; busy: boolean; error: boolean; onCancel: () => void; onContinue: () => void }) {
  const { t } = useTranslation(); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
      if (event.key === "Tab" && ref.current) {
        const controls = [...ref.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        if (!controls.length) return;
        const index = controls.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index === controls.length - 1 ? 0 : index + 1);
        event.preventDefault(); controls[next].focus();
      }
    };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, [onCancel]);
  return <div className="dialog-backdrop" role="presentation"><div ref={ref} className="confirm-dialog tool-external-dialog" role="dialog" aria-modal="true" aria-labelledby="tool-leave-title"><button className="dialog-close" type="button" onClick={onCancel} aria-label={t("common.close")}><X /></button><ExternalLink /><h2 id="tool-leave-title" className="nexus-display-title">{t("tools.leaveTitle")}</h2><p>{t("tools.leaveBody")}</p><strong dir="ltr">{domain}</strong><small>{t("tools.leaveNotice")}</small>{error && <p role="alert">{t("tools.openError")}</p>}<footer><button type="button" disabled={busy} onClick={onCancel}>{t("common.cancel")}</button><button className="primary-button" type="button" disabled={busy} aria-busy={busy} onClick={onContinue}>{t("tools.continue")}</button></footer></div></div>;
}
