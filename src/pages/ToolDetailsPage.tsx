import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, ExternalLink, Package, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/environment";
import { inspectToolUrl } from "../features/tools/safeToolUrl";
import type { NexusTool } from "../features/tools/types";
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
  useEffect(() => {
    const controller = new AbortController();
    services.tools?.get(slug, controller.signal).then(setTool).catch(() => setError(true));
    return () => controller.abort();
  }, [slug]);
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
      {tool.coverUrl && <img className="tool-details__cover" src={tool.coverUrl} alt="" decoding="async" />}
      <div>
        {tool.iconUrl ? <img className="tool-details__icon" src={tool.iconUrl} alt="" decoding="async" /> : <Package className="tool-details__icon" />}
        <div className="tool-card__badges">{tool.category && <span>{tool.category.name}</span>}{tool.badges.map((badge) => <span className={`tool-badge tool-badge--${badge.color}`} key={badge.id}>{badge.name}</span>)}</div>
        <h1 dir="auto">{tool.name}</h1><p>{tool.shortDescription}</p>
        <div className="tool-details__meta"><span dir="auto">{t("tools.by", { developer: tool.developerName })}</span><span dir="ltr">{t("tools.version", { version: tool.version })}</span><span>{t(`tools.trust.${tool.downloadTrust}`)}</span></div>
        <button className="tool-download" type="button" onClick={() => requestOpen(tool.externalDownloadUrl)}><Download />{t("tools.download")}</button>
      </div>
    </header>
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
