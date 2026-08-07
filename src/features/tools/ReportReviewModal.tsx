import { useEffect, useRef, useState } from "react";
import { Flag, X } from "lucide-react";
import { useTranslation } from "../../i18n/TranslationContext";
import type { ToolReviewReason, ToolReviewView } from "./types";

const REASONS: ToolReviewReason[] = ["spam", "harassment", "unsafe_link", "misleading", "inappropriate", "other"];

export function ReportReviewModal({ review, busy, error, onCancel, onSubmit }: { review: ToolReviewView; busy: boolean; error: boolean; onCancel: () => void; onSubmit: (reason: ToolReviewReason, details: string) => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<ToolReviewReason | "">("");
  const [details, setDetails] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>("input[type=radio]")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
      if (event.key === "Tab" && ref.current) {
        const controls = [...ref.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled)")];
        if (!controls.length) return;
        const index = controls.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index === controls.length - 1 ? 0 : index + 1);
        event.preventDefault();
        controls[next].focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onCancel]);
  return (
    <div className="dialog-backdrop report-backdrop">
      <div ref={ref} className="confirm-dialog report-modal" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <button className="dialog-close" type="button" onClick={onCancel} aria-label={t("common.close")}><X /></button>
        <Flag aria-hidden="true" />
        <h2 id="report-title" className="nexus-display-title">{t("review.reportTitle")}</h2>
        <p>{t("review.reportBody")}</p>
        <blockquote className="report-quote">
          <span dir="auto">{review.displayName}</span>
          {review.title && <strong dir="auto">{review.title}</strong>}
          <p dir="auto">{review.body}</p>
        </blockquote>
        <fieldset className="report-reasons">
          <legend>{t("review.reportReason")}</legend>
          {REASONS.map((value) => (
            <label key={value}>
              <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
              <span>{t(`review.reason.${value}`)}</span>
            </label>
          ))}
        </fieldset>
        <label className="report-details">
          <span>{t("review.reportDetails")}</span>
          <textarea rows={3} maxLength={500} value={details} onChange={(event) => setDetails(event.target.value)} />
          <small>{t("review.reportDetailsOptional")}</small>
        </label>
        {error && <p className="report-error" role="alert">{t("review.reportFailed")}</p>}
        <footer>
          <button type="button" onClick={onCancel}>{t("common.cancel")}</button>
          <button className="primary-button" type="button" disabled={busy || !reason} aria-busy={busy} onClick={() => reason && onSubmit(reason, details.trim())}>{t("review.reportSubmit")}</button>
        </footer>
      </div>
    </div>
  );
}