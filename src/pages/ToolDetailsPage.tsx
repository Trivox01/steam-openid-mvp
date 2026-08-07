import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, ExternalLink, Trash2, X } from "lucide-react";
import { ToolImage } from "../features/tools/ToolImage";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/environment";
import { inspectToolUrl } from "../features/tools/safeToolUrl";
import type { NexusTool, ToolRatingSummary } from "../features/tools/types";
import { RatingSummaryView, StarPicker } from "../features/tools/ToolRating";
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
      if (services.steamOpenId?.getActiveSession()) {
        services.tools.myRating(tool.id).then((value) => { if (!controller.signal.aborted) setMine(value); }).catch(() => undefined);
      }
    }
    return () => controller.abort();
  }, [tool, signedIn, slug]);
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
  if (error) return <ErrorView message={t("tools.loadError")} onRetry={() => location.reload()} />;
  if (!tool) return <LoadingView label={t("state.loading")} />;
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
      <div>
        <ToolImage className="tool-details__icon" src={tool.iconUrl} eager />
        <div className="tool-card__badges">{tool.category && <span>{tool.category.name}</span>}{tool.badges.map((badge) => <span className={`tool-badge tool-badge--${badge.color}`} key={badge.id}>{badge.name}</span>)}</div>
        <h1 dir="auto">{tool.name}</h1><p>{tool.shortDescription}</p>
        <div className="tool-details__meta"><span dir="auto">{t("tools.by", { developer: tool.developerName })}</span><span dir="ltr">{t("tools.version", { version: tool.version })}</span><span>{t(`tools.trust.${tool.downloadTrust}`)}</span></div>
        <button className="tool-download" type="button" onClick={() => requestOpen(tool.externalDownloadUrl)}><Download />{t("tools.download")}</button>
      </div>
    </header>
    <section className="tool-details__ratings">
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
    <section className="tool-details__description">
      <p>{tool.fullDescription}</p><dl><div><dt>{t("tools.domain")}</dt><dd dir="ltr">{tool.downloadDomain}</dd></div><div><dt>{t("tools.updated", { date: "" }).trim()}</dt><dd>{new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(tool.updatedAt))}</dd></div></dl>
      {tool.officialWebsiteUrl && <button type="button" className="secondary-button" onClick={() => requestOpen(tool.officialWebsiteUrl!)}><ExternalLink />{t("tools.website")}</button>}
      {openError && !target && <p role="alert">{t("tools.openError")}</p>}
    </section>
    {target && <ExternalLinkDialog domain={target.domain} busy={opening} error={openError} onCancel={() => setTarget(undefined)} onContinue={() => void open()} />}
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
