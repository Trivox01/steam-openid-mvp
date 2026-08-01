import { useEffect, useRef, useState } from "react";
import { Download, RefreshCw, Sparkles, X } from "lucide-react";
import { useTranslation } from "../../i18n/TranslationContext";
import { updateCoordinator } from "./UpdateCoordinator";
import { currentReleaseVersion, hasSeenRelease, markReleaseSeen, releaseNotes } from "./releaseNotes";

export function UpdateExperience({ autoCheck }: { autoCheck: boolean }) {
  const { language, t } = useTranslation();
  const [snapshot, setSnapshot] = useState(updateCoordinator.getSnapshot());
  const [whatsNew, setWhatsNew] = useState(() => !hasSeenRelease());
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => updateCoordinator.subscribe(setSnapshot), []);
  useEffect(() => { if (autoCheck) void updateCoordinator.check("automatic"); }, [autoCheck]);
  useEffect(() => { if (whatsNew || snapshot.status === "available") closeRef.current?.focus(); }, [snapshot.status, whatsNew]);
  const updateOpen = snapshot.status === "available" || snapshot.status === "downloading" || snapshot.status === "ready" || snapshot.status === "installing" || snapshot.status === "error";
  if (!whatsNew && !updateOpen) return null;
  const notes = releaseNotes[currentReleaseVersion][language];
  const closeWhatsNew = () => { markReleaseSeen(); setWhatsNew(false); };
  return <div className="dialog-backdrop update-backdrop" role="presentation">
    <section className="confirm-dialog update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title">
      <button ref={closeRef} type="button" className="update-dialog-close" aria-label={t("common.close")} onClick={updateOpen ? () => updateCoordinator.later() : closeWhatsNew}><X size={18} /></button>
      <div className="update-dialog-icon">{updateOpen ? <Download size={22} /> : <Sparkles size={22} />}</div>
      <h2 id="update-dialog-title">{updateOpen ? t("updates.availableTitle", { version: snapshot.version ?? "" }) : notes.title}</h2>
      {updateOpen ? <p>{snapshot.notes || t("updates.availableBody")}</p> : <><p>{notes.summary}</p><ul>{notes.items.map((item) => <li key={item}>{item}</li>)}</ul></>}
      {(snapshot.status === "downloading" || snapshot.status === "installing") && <div className="update-progress" role="progressbar" aria-label={t("updates.progress")} aria-valuenow={snapshot.progress}><span style={{ width: `${snapshot.progress ?? 12}%` }} /></div>}
      {snapshot.status === "error" && <p role="alert">{t("updates.failed")}</p>}
      <footer>
        {updateOpen ? <>
          <button type="button" disabled={snapshot.status === "downloading" || snapshot.status === "installing"} onClick={() => updateCoordinator.later()}>{t("updates.later")}</button>
          <button className="primary-button" type="button" aria-busy={snapshot.status === "downloading" || snapshot.status === "installing"} disabled={snapshot.status !== "available" && snapshot.status !== "error"} onClick={() => void updateCoordinator.downloadAndInstall()}><RefreshCw className={snapshot.status === "downloading" ? "spinning" : ""} size={16} />{snapshot.status === "downloading" ? t("updates.downloading") : snapshot.status === "installing" ? t("updates.installing") : t("updates.install")}</button>
        </> : <button className="primary-button" type="button" onClick={closeWhatsNew}>{t("updates.continue")}</button>}
      </footer>
    </section>
  </div>;
}
