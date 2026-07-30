import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  AlertCircle,
  Bell,
  Check,
  Database,
  Download,
  Eye,
  Gamepad2,
  Globe2,
  LoaderCircle,
  Monitor,
  PlayCircle,
  RefreshCw,
  RotateCw,
  Trash2
} from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { useTheme, type Theme } from "../state/ThemeContext";
import { useTranslation } from "../i18n/TranslationContext";
import { applicationRefresh, services } from "../services/compositionRoot";
import { defaultPreferences, preferencesEqual } from "../services/settingsPreferences";
import type { UserPreferences, UserProfile } from "../types";
import { ErrorView, LoadingView } from "../components/ui/StateViews";
import { SteamAccountSettings } from "../components/settings/SteamAccountSettings";

type SaveStatus = "idle" | "saving" | "success" | "error";

export type SettingsPageHandle = {
  save: () => Promise<boolean>;
  discard: () => void;
};

type SettingsPageProps = {
  onProfileChange?: (profile: UserProfile) => void;
  onShowOnboarding?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onPreferencesSaved?: (preferences: UserPreferences) => void;
};

export const SettingsPage = forwardRef<SettingsPageHandle, SettingsPageProps>(
  function SettingsPage({ onProfileChange, onShowOnboarding, onDirtyChange, onPreferencesSaved }, ref) {
    const { setTheme } = useTheme();
    const { setLanguage, t } = useTranslation();
    const [saved, setSaved] = useState<UserPreferences>();
    const [draft, setDraft] = useState<UserPreferences>();
    const [refreshStatus, setRefreshStatus] = useState(applicationRefresh.getSnapshot());
    useEffect(() => applicationRefresh.subscribe(setRefreshStatus), []);
    const [loadError, setLoadError] = useState("");
    const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
    const [saveError, setSaveError] = useState("");
    const [syncing, setSyncing] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [resetOpen, setResetOpen] = useState(false);
    const successTimer = useRef<number | null>(null);
    const syncTimer = useRef<number | null>(null);
    const confirmDialogRef = useRef<HTMLDivElement>(null);
    const confirmTriggerRef = useRef<HTMLElement | null>(null);
    const dirty = Boolean(saved && draft && !preferencesEqual(saved, draft));

    useEffect(() => {
      if (!dialogOpen && !resetOpen) return;
      const dialog = confirmDialogRef.current;
      const focusable = [...(dialog?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])];
      focusable[0]?.focus();
      const handleDialogKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setDialogOpen(false);
          setResetOpen(false);
          return;
        }
        if (event.key !== "Tab" || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };
      document.addEventListener("keydown", handleDialogKey);
      return () => {
        document.removeEventListener("keydown", handleDialogKey);
        confirmTriggerRef.current?.focus();
      };
    }, [dialogOpen, resetOpen]);

    const openConfirmDialog = (kind: "delete" | "reset") => {
      confirmTriggerRef.current = document.activeElement as HTMLElement | null;
      if (kind === "delete") setDialogOpen(true);
      else setResetOpen(true);
    };

    const load = useCallback(async () => {
      try {
        const value = await services.settings.get();
        setSaved(value);
        setDraft(value);
        setLoadError("");
      } catch {
        setLoadError(t("settings.loadError"));
      }
    }, [t]);

    useEffect(() => { void load(); }, [load]);
    useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
    useEffect(() => () => {
      if (successTimer.current) window.clearTimeout(successTimer.current);
      if (syncTimer.current) window.clearTimeout(syncTimer.current);
      onDirtyChange?.(false);
    }, [onDirtyChange]);

    useEffect(() => {
      const warnBeforeClose = (event: BeforeUnloadEvent) => {
        if (!dirty) return;
        event.preventDefault();
        event.returnValue = "";
      };
      window.addEventListener("beforeunload", warnBeforeClose);
      return () => window.removeEventListener("beforeunload", warnBeforeClose);
    }, [dirty]);

    const update = (patch: Partial<UserPreferences>) => {
      setDraft((current) => current ? { ...current, ...patch } : current);
      setSaveStatus("idle");
      setSaveError("");
    };

    const toggle = (key: keyof UserPreferences) => {
      const value = draft?.[key];
      if (typeof value === "boolean") update({ [key]: !value });
    };

    const save = useCallback(async () => {
      if (!draft || !saved || saveStatus === "saving") return false;
      if (preferencesEqual(saved, draft)) return true;
      setSaveStatus("saving");
      setSaveError("");
      try {
        await services.settings.save(draft);
        setSaved(draft);
        onPreferencesSaved?.(draft);
        setTheme(draft.theme);
        setLanguage(draft.language);
        setSaveStatus("success");
        if (successTimer.current) window.clearTimeout(successTimer.current);
        successTimer.current = window.setTimeout(() => setSaveStatus("idle"), 1800);
        return true;
      } catch {
        setSaveStatus("error");
        setSaveError(t("settings.saveError"));
        return false;
      }
    }, [draft, onPreferencesSaved, saved, saveStatus, setLanguage, setTheme, t]);

    const discard = useCallback(() => {
      if (!saved) return;
      setDraft(saved);
      setSaveStatus("idle");
      setSaveError("");
    }, [saved]);

    useImperativeHandle(ref, () => ({ save, discard }), [save, discard]);

    useEffect(() => {
      const handleShortcut = (event: KeyboardEvent) => {
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
        event.preventDefault();
        if (dirty && saveStatus !== "saving") void save();
      };
      window.addEventListener("keydown", handleShortcut);
      return () => window.removeEventListener("keydown", handleShortcut);
    }, [dirty, save, saveStatus]);

    const sync = () => {
      setSyncing(true);
      if (syncTimer.current) window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => setSyncing(false), 900);
    };

    const resetDraft = () => {
      if (!saved) return;
      setDraft({ ...defaultPreferences, onboardingCompleted: saved.onboardingCompleted });
      setResetOpen(false);
      setSaveStatus("idle");
    };

    const showOnboarding = async () => {
      if (!saved) return;
      try {
        const next = { ...saved, onboardingCompleted: false };
        await services.settings.save(next);
        setSaved(next);
        onPreferencesSaved?.(next);
        setDraft((current) => current ? { ...current, onboardingCompleted: false } : next);
        onShowOnboarding?.();
      } catch {
        setSaveStatus("error");
        setSaveError(t("settings.saveError"));
      }
    };

    if (loadError) return <ErrorView message={loadError} onRetry={() => void load()} />;
    if (!draft || !saved) return <LoadingView />;

    const saveLabel = saveStatus === "saving"
      ? t("settings.saving")
      : saveStatus === "success"
        ? t("settings.saved")
        : saveStatus === "error"
          ? t("settings.tryAgain")
          : t("common.save");

    return (
      <section className="content-page settings-page">
        <PageHeader eyebrow={t("settings.eyebrow")} title={t("settings.title")} description={t("settings.description")} />
        <div className="settings-layout">
          <SettingsSection className="steam-settings-section" icon={Gamepad2} title={t("steam.title")} description={t("steam.description")}>
            <SteamAccountSettings onProfileChange={onProfileChange} />
          </SettingsSection>
          <SettingsSection icon={Monitor} title={t("settings.appearance")} description={t("settings.appearanceDescription")}>
            <div className="choice-grid">{(["light", "dark", "system"] as Theme[]).map((option) => <button type="button" key={option} className={draft.theme === option ? "active" : ""} onClick={() => update({ theme: option })}><span className={`theme-preview ${option}`}><i /><i /><i /></span><strong>{t(`settings.theme.${option}`)}</strong></button>)}</div>
          </SettingsSection>
          <SettingsSection icon={Globe2} title={t("settings.language")} description={t("settings.languageDescription")}>
            <div className="language-options">{(["en", "ar"] as const).map((language) => <button type="button" key={language} className={draft.language === language ? "active" : ""} onClick={() => update({ language })}><span>{language.toUpperCase()}</span><strong>{t(`settings.language.${language}`)}</strong><i /></button>)}</div>
          </SettingsSection>
          <SettingsSection icon={RotateCw} title={t("settings.general")} description={t("settings.generalDescription")}>
            {/* TODO(system integration): Apply persisted startup/tray values to Windows APIs. */}
            <SettingToggle label={t("settings.launch")} description={t("settings.launchDescription")} checked={draft.launchAtStartup} onChange={() => toggle("launchAtStartup")} />
            <SettingToggle label={t("settings.tray")} description={t("settings.trayDescription")} checked={draft.minimizeToTray} onChange={() => toggle("minimizeToTray")} />
            <SettingToggle label={t("settings.updates")} description={t("settings.updatesDescription")} checked={draft.autoCheckForUpdates} onChange={() => toggle("autoCheckForUpdates")} />
          </SettingsSection>
          <SettingsSection icon={Bell} title={t("settings.notifications")} description={t("settings.notificationsDescription")}>
            <SettingToggle label={t("settings.notificationsEnable")} description={t("settings.notificationsEnableDescription")} checked={draft.notificationsEnabled} onChange={() => toggle("notificationsEnabled")} />
          </SettingsSection>
          <SettingsSection icon={Eye} title={t("settings.privacy")} description={t("settings.privacyDescription")}>
            <SettingToggle label={t("settings.hidePlaytime")} description={t("settings.hidePlaytimeDescription")} checked={draft.hidePlaytime} onChange={() => toggle("hidePlaytime")} />
            <SettingToggle label={t("settings.hideGames")} description={t("settings.hideGamesDescription")} checked={draft.hideHiddenGames} onChange={() => toggle("hideHiddenGames")} />
          </SettingsSection>
          <SettingsSection icon={Database} title={t("settings.data")} description={t("settings.dataDescription")}>
            <div className="data-actions">
              <button type="button" aria-busy={refreshStatus.status === "refreshing"}
                disabled={refreshStatus.status === "refreshing"}
                onClick={() => void applicationRefresh.refreshAll()}>
                <RefreshCw className={refreshStatus.status === "refreshing" ? "spinning" : ""} size={16} />
                {t(refreshStatus.status === "refreshing" ? "settings.refreshingAll" : "settings.refreshAll")}
              </button>
              <button type="button" onClick={() => void showOnboarding()}><PlayCircle size={16} />{t("settings.onboarding")}</button>
              <button type="button" onClick={sync} disabled={syncing}><RefreshCw className={syncing ? "spinning" : ""} size={16} />{syncing ? t("settings.syncing") : t("settings.sync")}</button>
              <button type="button" onClick={() => window.alert(t("settings.exportFuture"))}><Download size={16} />{t("settings.export")}</button>
              <button type="button" onClick={() => openConfirmDialog("reset")}><RotateCw size={16} />{t("settings.reset")}</button>
              <button type="button" className="danger" onClick={() => openConfirmDialog("delete")}><Trash2 size={16} />{t("settings.delete")}</button>
            </div>
            <p className="sr-only" role="status" aria-live="polite">
              {refreshStatus.status === "success" ? t("settings.refreshAllSuccess")
                : refreshStatus.status === "partial" ? t("settings.refreshAllPartial") : ""}
            </p>
            {refreshStatus.status !== "idle" && refreshStatus.status !== "refreshing" && (
              <div className="refresh-details" role="status" aria-live="polite">
                <strong>{t("settings.refreshSummary", {
                  completed: refreshStatus.results.filter((item) => item.status === "success").length,
                  total: refreshStatus.results.length
                })}</strong>
                {refreshStatus.results.some((item) => item.status === "failed") && (
                  <ul>
                    {refreshStatus.results.filter((item) => item.status === "failed").map((item) => (
                      <li key={item.id}>{t("settings.refreshSourceFailed", {
                        source: t(`settings.refreshSource.${item.id}`)
                      })}</li>
                    ))}
                  </ul>
                )}
                {refreshStatus.results.some((item) => item.status === "skipped") && (
                  <p>{t("settings.refreshSkipped", {
                    count: refreshStatus.results.filter((item) => item.status === "skipped").length
                  })}</p>
                )}
                {refreshStatus.results.some((item) => item.status === "failed") && (
                  <button type="button" className="secondary-button"
                    onClick={() => void applicationRefresh.retryFailedOnly()}>
                    <RefreshCw size={15} />{t("settings.retryFailed")}
                  </button>
                )}
              </div>
            )}
          </SettingsSection>
        </div>

        <div className={`settings-save-bar ${dirty ? "is-dirty" : ""}`} role="status" aria-live="polite">
          <div className="settings-save-state">
            {dirty ? <span className="unsaved-dot" /> : saveStatus === "success" ? <Check size={17} /> : null}
            <span>{dirty ? t("settings.unsaved") : saveStatus === "success" ? t("settings.saved") : ""}</span>
            <small>{t("settings.shortcut")}</small>
          </div>
          <div className="settings-save-actions">
            <button type="button" className="secondary-button" onClick={discard} disabled={!dirty || saveStatus === "saving"}>{t("settings.discard")}</button>
            <button type="button" className={`primary-button save-settings-button ${saveStatus}`} onClick={() => void save()} disabled={!dirty || saveStatus === "saving"}>
              {saveStatus === "saving" && <LoaderCircle className="spinning" size={16} />}
              {saveStatus === "success" && <Check size={16} />}
              {saveStatus === "error" && <AlertCircle size={16} />}
              {saveLabel}
            </button>
          </div>
        </div>
        {saveError && <p className="settings-save-error" role="alert">{saveError}</p>}

        {dialogOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={() => setDialogOpen(false)}><div ref={confirmDialogRef} className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title" onMouseDown={(event) => event.stopPropagation()}><div><Trash2 size={22} /></div><h2 id="delete-title">{t("settings.deleteTitle")}</h2><p>{t("settings.deleteDescription")}</p><footer><button type="button" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</button><button type="button" className="danger-button" onClick={() => setDialogOpen(false)}>{t("settings.confirmPreview")}</button></footer></div></div>}
        {resetOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={() => setResetOpen(false)}><div ref={confirmDialogRef} className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-title" onMouseDown={(event) => event.stopPropagation()}><div><RotateCw size={22} /></div><h2 id="reset-title">{t("settings.resetTitle")}</h2><p>{t("settings.resetDescription")}</p><footer><button type="button" onClick={() => setResetOpen(false)}>{t("common.cancel")}</button><button type="button" className="danger-button" onClick={resetDraft}>{t("settings.reset")}</button></footer></div></div>}
      </section>
    );
  }
);

function SettingsSection({ icon: Icon, title, description, children, className }: { icon: typeof Monitor; title: string; description: string; children: ReactNode; className?: string }) {
  return <article className={`panel settings-section ${className ?? ""}`}><header><div><Icon size={18} /></div><span><h2>{title}</h2><p>{description}</p></span></header><div className="settings-content">{children}</div></article>;
}

function SettingToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: () => void }) {
  return <button type="button" className="setting-toggle" onClick={onChange} role="switch" aria-checked={checked}><span><strong>{label}</strong><small>{description}</small></span><i className={checked ? "checked" : ""}><b /></i></button>;
}
