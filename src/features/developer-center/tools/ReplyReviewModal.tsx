import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "../../../i18n/TranslationContext";
import type { ToolClient } from "../../tools/ToolClient";
import type { ToolReviewAdminView } from "../../tools/types";

const REPLY_LIMIT = 2000;

export function ReplyReviewModal({ client, review, onClose, onSaved }: { client: ToolClient; review: ToolReviewAdminView; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const body = review.developerReply?.body ?? "";
  const [value, setValue] = useState(body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<"" | "saved" | "removed">("");
  const changed = value !== body;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (changed && !window.confirm(t("review.discardChanges"))) return;
        onClose();
      }
      if (event.key === "Tab" && ref.current) {
        const controls = [...ref.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled), textarea")];
        if (!controls.length) return;
        const index = controls.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index === controls.length - 1 ? 0 : index + 1);
        event.preventDefault(); controls[next].focus();
      }
    };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, [changed, onClose]);
  const save = async () => {
    if (busy || !value.trim()) return;
    setBusy(true); setError(false); setNotice("");
    try {
      await client.saveDeveloperReply(review.id, value.trim());
      setNotice("saved");
      onSaved();
    } catch { setError(true); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (busy || !review.developerReply || !window.confirm(t("review.replyRemoveConfirm"))) return;
    setBusy(true); setError(false); setNotice("");
    try {
      await client.removeDeveloperReply(review.id);
      onSaved();
      onClose();
    } catch { setError(true); }
    finally { setBusy(false); }
  };
  return (
    <div className="dialog-backdrop" role="presentation">
      <div ref={ref} className="confirm-dialog report-modal reply-modal" role="dialog" aria-modal="true" aria-labelledby="reply-title">
        <button className="dialog-close" type="button" onClick={onClose} aria-label={t("common.close")}><X /></button>
        <h2 id="reply-title" className="nexus-display-title">{review.developerReply ? t("review.replyEditTitle") : t("review.replyNewTitle")}</h2>
        <p className="reply-modal__context"><strong dir="auto">{review.displayName}</strong>{review.title ? <>: <span dir="auto">{review.title}</span></> : null}</p>
        <label className="review-form__label" htmlFor="reply-body">{t("review.bodyLabel")}</label>
        <textarea
          id="reply-body"
          className="reply-modal__body"
          value={value}
          maxLength={REPLY_LIMIT}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={value.trim().length === 0}
          aria-describedby="reply-count"
        />
        <p id="reply-count" className="review-form__count">{t("review.characterCount", { current: value.length, limit: REPLY_LIMIT })}</p>
        {error && <p role="alert">{t("review.replySaveFailed")}</p>}
        {notice === "saved" && <p className="tool-rating-feedback is-success" role="status">{t("review.replyUpdated")}</p>}
        <footer className="review-form__actions">
          {review.developerReply && <button type="button" className="reply-modal__remove" disabled={busy} onClick={() => void remove()}>{t("review.replyRemove")}</button>}
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
          <button className="primary-button" type="button" disabled={busy || !value.trim()} aria-busy={busy} onClick={() => void save()}>{t("review.replySave")}</button>
        </footer>
      </div>
    </div>
  );
}