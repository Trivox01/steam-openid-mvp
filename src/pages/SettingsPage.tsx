import { useState, type ReactNode } from "react";
import { Bell, Database, Download, Eye, Globe2, Monitor, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { useTheme, type Theme } from "../state/ThemeContext";

type ToggleSettings = Record<string, boolean>;
const initialToggles: ToggleSettings = {
  launchWindows: false, minimizeTray: true, autoUpdates: true,
  achievementNotifications: true, completionNotifications: true, weeklyReminder: true,
  hidePlaytime: false, hideHiddenGames: true
};

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [language, setLanguage] = useState("English");
  const [toggles, setToggles] = useState(initialToggles);
  const [syncing, setSyncing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const toggle = (key: string) => setToggles((current) => ({ ...current, [key]: !current[key] }));
  const sync = () => { setSyncing(true); window.setTimeout(() => setSyncing(false), 900); };

  return (
    <section className="content-page">
      <PageHeader eyebrow="PREFERENCES" title="Settings" description="Personalize how Achievement Nexus looks and behaves." />
      <div className="settings-layout">
        <SettingsSection icon={Monitor} title="Appearance" description="Choose the interface theme for this device.">
          <div className="choice-grid">{(["light", "dark", "system"] as Theme[]).map((option) => <button key={option} className={theme === option ? "active" : ""} onClick={() => setTheme(option)}><span className={`theme-preview ${option}`}><i /><i /><i /></span><strong>{capitalize(option)}</strong></button>)}</div>
        </SettingsSection>
        <SettingsSection icon={Globe2} title="Language" description="Select your preferred interface language.">
          <div className="language-options">{["English", "Arabic"].map((item) => <button key={item} className={language === item ? "active" : ""} onClick={() => setLanguage(item)}><span>{item === "English" ? "EN" : "AR"}</span><strong>{item}</strong><i /></button>)}</div>
        </SettingsSection>
        <SettingsSection icon={RotateCw} title="General" description="Control startup and application behavior.">
          <SettingToggle label="Launch with Windows" description="Start Achievement Nexus when you sign in." checked={toggles.launchWindows} onChange={() => toggle("launchWindows")} />
          <SettingToggle label="Minimize to system tray" description="Keep the app available in the background." checked={toggles.minimizeTray} onChange={() => toggle("minimizeTray")} />
          <SettingToggle label="Check for updates automatically" description="Look for new versions in the background." checked={toggles.autoUpdates} onChange={() => toggle("autoUpdates")} />
        </SettingsSection>
        <SettingsSection icon={Bell} title="Notifications" description="Choose which progress events notify you.">
          <SettingToggle label="Achievement unlocked" description="Show a notification when an achievement unlocks." checked={toggles.achievementNotifications} onChange={() => toggle("achievementNotifications")} />
          <SettingToggle label="Game completed" description="Celebrate when a game reaches 100%." checked={toggles.completionNotifications} onChange={() => toggle("completionNotifications")} />
          <SettingToggle label="Weekly goal reminder" description="Remind you before your weekly goal resets." checked={toggles.weeklyReminder} onChange={() => toggle("weeklyReminder")} />
        </SettingsSection>
        <SettingsSection icon={Eye} title="Privacy" description="Control what is visible in your local profile.">
          <SettingToggle label="Hide playtime" description="Do not display total hours in the interface." checked={toggles.hidePlaytime} onChange={() => toggle("hidePlaytime")} />
          <SettingToggle label="Hide hidden games" description="Exclude marked games from your library." checked={toggles.hideHiddenGames} onChange={() => toggle("hideHiddenGames")} />
        </SettingsSection>
        <SettingsSection icon={Database} title="Data" description="Manage your local mock library data.">
          <div className="data-actions"><button onClick={sync} disabled={syncing}><RefreshCw className={syncing ? "spinning" : ""} size={16} />{syncing ? "Syncing..." : "Sync mock data"}</button><button onClick={() => window.alert("Export will be available with local persistence.")}><Download size={16} />Export data</button><button className="danger" onClick={() => setDialogOpen(true)}><Trash2 size={16} />Delete data</button></div>
        </SettingsSection>
      </div>
      {dialogOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={() => setDialogOpen(false)}><div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title" onMouseDown={(event) => event.stopPropagation()}><div><Trash2 size={22} /></div><h2 id="delete-title">Delete local data?</h2><p>This is a preview only. No data will actually be deleted during this phase.</p><footer><button onClick={() => setDialogOpen(false)}>Cancel</button><button className="danger-button" onClick={() => setDialogOpen(false)}>Confirm preview</button></footer></div></div>}
    </section>
  );
}

function SettingsSection({ icon: Icon, title, description, children }: { icon: typeof Monitor; title: string; description: string; children: ReactNode }) {
  return <article className="panel settings-section"><header><div><Icon size={18} /></div><span><h2>{title}</h2><p>{description}</p></span></header><div className="settings-content">{children}</div></article>;
}
function SettingToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: () => void }) {
  return <button className="setting-toggle" onClick={onChange} role="switch" aria-checked={checked}><span><strong>{label}</strong><small>{description}</small></span><i className={checked ? "checked" : ""}><b /></i></button>;
}
function capitalize(value: string) { return value[0].toUpperCase() + value.slice(1); }
