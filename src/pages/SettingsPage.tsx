import { useEffect, useState, type ReactNode } from "react";
import { Bell, Database, Download, Eye, Gamepad2, Globe2, Monitor, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { useTheme, type Theme } from "../state/ThemeContext";
import { services } from "../services/compositionRoot";
import { defaultPreferences } from "../services/initializationService";
import type { UserPreferences } from "../types";
import { ErrorView, LoadingView } from "../components/ui/StateViews";
import { SteamAccountSettings } from "../components/settings/SteamAccountSettings";

export function SettingsPage({ onProfileChange }: { onProfileChange?: (profile: import("../types").UserProfile) => void }) {
  const { theme, setTheme } = useTheme();
  const [preferences, setPreferences] = useState<UserPreferences>();
  const [loadError, setLoadError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const load = async () => { try { const value=await services.settings.get(); setPreferences(value); setTheme(value.theme); setLoadError(""); } catch(error:unknown){setLoadError(error instanceof Error?error.message:"Unable to load preferences.")} };
  useEffect(() => { void load(); }, []);
  const update = (patch: Partial<UserPreferences>) => {
    if (!preferences) return;
    const next={...preferences,...patch}; setPreferences(next); if(patch.theme)setTheme(patch.theme);
    void services.settings.save(next).catch((error:unknown)=>setLoadError(error instanceof Error?error.message:"Unable to save preferences."));
  };
  const toggle = (key: keyof UserPreferences) => { const value=preferences?.[key]; if(typeof value==="boolean")update({[key]:!value}); };
  const sync = () => { setSyncing(true); window.setTimeout(() => setSyncing(false), 900); };
  const reset = async () => { await services.settings.reset(); await services.settings.save(defaultPreferences); setPreferences(defaultPreferences); setTheme(defaultPreferences.theme); setResetOpen(false); };
  if (loadError) return <ErrorView message={loadError} onRetry={() => void load()} />;
  if (!preferences) return <LoadingView />;

  return (
    <section className="content-page">
      <PageHeader eyebrow="PREFERENCES" title="Settings" description="Personalize how Achievement Nexus looks and behaves." />
      <div className="settings-layout">
        <SettingsSection className="steam-settings-section" icon={Gamepad2} title="Steam Account" description="Connect a Steam profile using the official read-only Web API.">
          <SteamAccountSettings onProfileChange={onProfileChange} />
        </SettingsSection>
        <SettingsSection icon={Monitor} title="Appearance" description="Choose the interface theme for this device.">
          <div className="choice-grid">{(["light", "dark", "system"] as Theme[]).map((option) => <button key={option} className={theme === option ? "active" : ""} onClick={() => update({theme:option})}><span className={`theme-preview ${option}`}><i /><i /><i /></span><strong>{capitalize(option)}</strong></button>)}</div>
        </SettingsSection>
        <SettingsSection icon={Globe2} title="Language" description="Select your preferred interface language.">
          <div className="language-options">{(["English", "Arabic"] as const).map((item) => <button key={item} className={preferences.language === item ? "active" : ""} onClick={() => update({language:item})}><span>{item === "English" ? "EN" : "AR"}</span><strong>{item}</strong><i /></button>)}</div>
        </SettingsSection>
        <SettingsSection icon={RotateCw} title="General" description="Control startup and application behavior.">
          <SettingToggle label="Launch with Windows" description="Start Achievement Nexus when you sign in." checked={preferences.launchAtStartup} onChange={() => toggle("launchAtStartup")} />
          <SettingToggle label="Minimize to system tray" description="Keep the app available in the background." checked={preferences.minimizeToTray} onChange={() => toggle("minimizeToTray")} />
          <SettingToggle label="Check for updates automatically" description="Look for new versions in the background." checked={preferences.automaticUpdates} onChange={() => toggle("automaticUpdates")} />
        </SettingsSection>
        <SettingsSection icon={Bell} title="Notifications" description="Choose which progress events notify you.">
          <SettingToggle label="Achievement unlocked" description="Show a notification when an achievement unlocks." checked={preferences.achievementNotifications} onChange={() => toggle("achievementNotifications")} />
          <SettingToggle label="Game completed" description="Celebrate when a game reaches 100%." checked={preferences.completionNotifications} onChange={() => toggle("completionNotifications")} />
          <SettingToggle label="Weekly goal reminder" description="Remind you before your weekly goal resets." checked={preferences.weeklyGoalReminder} onChange={() => toggle("weeklyGoalReminder")} />
        </SettingsSection>
        <SettingsSection icon={Eye} title="Privacy" description="Control what is visible in your local profile.">
          <SettingToggle label="Hide playtime" description="Do not display total hours in the interface." checked={preferences.hidePlaytime} onChange={() => toggle("hidePlaytime")} />
          <SettingToggle label="Hide hidden games" description="Exclude marked games from your library." checked={preferences.hideHiddenGames} onChange={() => toggle("hideHiddenGames")} />
        </SettingsSection>
        <SettingsSection icon={Database} title="Data" description="Manage your local mock library data.">
          <div className="data-actions"><button onClick={sync} disabled={syncing}><RefreshCw className={syncing ? "spinning" : ""} size={16} />{syncing ? "Syncing..." : "Sync local data"}</button><button onClick={() => window.alert("Export will be available in a future phase.")}><Download size={16} />Export data</button><button onClick={() => setResetOpen(true)}><RotateCw size={16} />Reset preferences</button><button className="danger" onClick={() => setDialogOpen(true)}><Trash2 size={16} />Delete data</button></div>
        </SettingsSection>
      </div>
      {dialogOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={() => setDialogOpen(false)}><div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title" onMouseDown={(event) => event.stopPropagation()}><div><Trash2 size={22} /></div><h2 id="delete-title">Delete local data?</h2><p>This is a preview only. No data will actually be deleted during this phase.</p><footer><button onClick={() => setDialogOpen(false)}>Cancel</button><button className="danger-button" onClick={() => setDialogOpen(false)}>Confirm preview</button></footer></div></div>}
      {resetOpen && <div className="dialog-backdrop" onMouseDown={() => setResetOpen(false)}><div className="confirm-dialog" role="dialog" aria-modal="true" onMouseDown={(event)=>event.stopPropagation()}><div><RotateCw size={22}/></div><h2>Reset preferences?</h2><p>Appearance, language, notifications, privacy, and general settings will return to their defaults.</p><footer><button onClick={()=>setResetOpen(false)}>Cancel</button><button className="danger-button" onClick={()=>void reset()}>Reset preferences</button></footer></div></div>}
    </section>
  );
}

function SettingsSection({ icon: Icon, title, description, children, className }: { icon: typeof Monitor; title: string; description: string; children: ReactNode; className?: string }) {
  return <article className={`panel settings-section ${className ?? ""}`}><header><div><Icon size={18} /></div><span><h2>{title}</h2><p>{description}</p></span></header><div className="settings-content">{children}</div></article>;
}
function SettingToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: () => void }) {
  return <button className="setting-toggle" onClick={onChange} role="switch" aria-checked={checked}><span><strong>{label}</strong><small>{description}</small></span><i className={checked ? "checked" : ""}><b /></i></button>;
}
function capitalize(value: string) { return value[0].toUpperCase() + value.slice(1); }
