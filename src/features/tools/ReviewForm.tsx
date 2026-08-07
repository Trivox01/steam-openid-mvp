import { useEffect, useRef, useState, type FormEvent } from "react";
import { MessageSquare, X } from "lucide-react";
import { useTranslation } from "../../i18n/TranslationContext";
import type { ToolReviewView } from "./types";

const TITLE_LIMIT = 100;
const BODY_LIMIT = 2500;

export function ReviewForm({ value, busy, onCancel, onSave }: { value?: ToolReviewView; busy: boolean; onCancel: () => void; onSave: (title: string, body: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(value?.title ?? "");
  const [body, setBody] = useState(value?.body ?? "");
  const [touched, setTouched] = useState({ title: false, body: false });
  const [titleError, setTitleError] = useState("");
  const [bodyError, setBodyError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const startTitle = useRef(value?.title ?? "");
  const startBody = useRef(value?.body ?? "");
  const dirty = title !== startTitle.current || body !== startBody.current;

  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>("input")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (dirty && !window.confirm(t("tools.reviewDiscardChanges"))) return;
        onCancel();
      }
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
  }, [dirty, onCancel]);

  const validateTitle = (raw: string) => raw.length > TITLE_LIMIT ? t("review.titleTooLong") : "";
  const validateBody = (raw: string) => !raw.trim() ? t("review.bodyRequired") : raw.length > BODY_LIMIT ? t("review.bodyTooLong") : "";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextTitleError = validateTitle(title);
    const nextBodyError = validateBody(body);
    setTitleError(nextTitleError);
    setBodyError(nextBodyError);
    setTouched({ title: true, body: true });
    if (nextTitleError || nextBodyError || busy) return;
    await onSave(title.trim(), body.trim());
  };

  return (
    <div className="dialog-backdrop review-form-backdrop">
      <div ref={ref} className="confirm-dialog review-form" role="dialog" aria-modal="true" aria-labelledby="review-form-title">
        <button className="dialog-close" type="button" onClick={onCancel} aria-label={t("common.close")}><X /></button>
        <MessageSquare aria-hidden="true" />
        <h2 id="review-form-title" className="nexus-display-title">{value ? t("review.editTitle") : t("review.writeTitle")}</h2>
        <form noValidate onSubmit={(event) => void submit(event)}>
          <label className="review-field">
            <span>{t("review.titleLabel")}</span>
            <input name="title" value={title} maxLength={TITLE_LIMIT} dir="auto" onChange={(event) => { setTitle(event.target.value); setTitleError(validateTitle(event.target.value)); }} onBlur={() => setTouched({ ...touched, title: true })} aria-invalid={Boolean(titleError)} aria-describedby={titleError ? "review-title-error" : undefined} />
            <small className="review-count">{t("review.characterCount", { current: title.length, limit: TITLE_LIMIT })}</small>
            {touched.title && titleError && <p id="review-title-error" className="review-error" role="alert">{titleError}</p>}
          </label>
          <label className="review-field">
            <span>{t("review.bodyLabel")}</span>
            <textarea name="body" value={body} rows={6} maxLength={BODY_LIMIT} dir="auto" onChange={(event) => { setBody(event.target.value); setBodyError(validateBody(event.target.value)); }} onBlur={() => setTouched({ ...touched, body: true })} aria-invalid={Boolean(bodyError)} aria-describedby={bodyError ? "review-body-error" : undefined} />
            <span className="review-field__count">{t("review.characterCount", { current: body.length, limit: BODY_LIMIT })}</span>
            {touched.body && bodyError && <p id="review-body-error" className="review-error" role="alert">{bodyError}</p>}
            <small>{t("review.plainTextNote")}</small>
          </label>
          <footer>
            <button type="button" onClick={() => { if (dirty && !window.confirm(t("review.discardChanges"))) return; onCancel(); }}>{t("common.cancel")}</button>
            <button className="primary-button" type="submit" disabled={busy} aria-busy={busy}>{value ? t("review.saveChanges") : t("review.publish")}</button>
          </footer>
        </form>
      </div>
    </div>
  );
}