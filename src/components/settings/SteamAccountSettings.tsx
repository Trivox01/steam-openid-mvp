import { useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, Gamepad2, Link2Off, RefreshCw, ShieldCheck } from "lucide-react";
import { HoloPulseLoader } from "../ui/holo-pulse-loader";
import { services } from "../../services/compositionRoot";
import { steamProfileToUserProfile } from "../../services/platform/SteamConnectionService";
import type {
  SteamConnectionStatus,
  SteamProfile,
  UserProfile
} from "../../types";
import { ProfileAvatar } from "../ui/ProfileAvatar";
import { useTranslation } from "../../i18n/TranslationContext";
import type { SteamLibrarySyncResult } from "../../types";
import { SteamLibrarySyncError } from "../../services/platform/SteamLibrarySyncService";
import { publishLibraryChange } from "../../services/dataEvents";

export function SteamAccountSettings({
  onProfileChange
}: {
  onProfileChange?: (profile: UserProfile) => void;
}) {
  const { t } = useTranslation();
  const [steamId, setSteamId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [status, setStatus] = useState<SteamConnectionStatus>("disconnected");
  const [profile, setProfile] = useState<SteamProfile>();
  const [message, setMessage] = useState("");
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SteamLibrarySyncResult>();
  const [lastSyncedAt, setLastSyncedAt] = useState<string>();
  const available = services.steam.available;

  useEffect(() => {
    let active = true;
    services.steam
      .getSavedProfile()
      .then((saved) => {
        if (!active || !saved) return;
        setProfile(saved);
        setSteamId(saved.steamId);
        setStatus("connected");
      })
      .catch(() => {
        if (!active) return;
        setStatus("error");
        setMessage(t("steam.loadError"));
      });
    services.steamLibrarySync.getLastSync()
      .then((metadata) => {
        if (active) setLastSyncedAt(metadata?.lastSyncedAt);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [t]);

  const connect = async () => {
    if (!steamId.trim() || !apiKey.trim() || status === "validating") return;
    setStatus("validating");
    setMessage("");
    try {
      const result = await services.steam.connect({ steamId, apiKey });
      if (!result.success || !result.profile) {
        setStatus("error");
        setMessage(result.userMessage ?? t("steam.verificationError"));
        return;
      }
      setProfile(result.profile);
      setSteamId(result.profile.steamId);
      setApiKey("");
      setShowApiKey(false);
      setStatus("connected");
      onProfileChange?.(steamProfileToUserProfile(result.profile));
    } catch {
      setStatus("error");
      setMessage(t("steam.connectionError"));
    }
  };

  const disconnect = async () => {
    try {
      await services.steam.disconnect();
      const fallback = await services.profile.get();
      if (fallback) onProfileChange?.(fallback);
      setProfile(undefined);
      setSteamId("");
      setApiKey("");
      setStatus("disconnected");
      setMessage("");
      setDisconnectOpen(false);
    } catch {
      setStatus("error");
      setMessage(t("steam.disconnectError"));
    }
  };

  const syncLibrary = async () => {
    if (syncing) return;
    setSyncing(true);
    setMessage("");
    setSyncResult(undefined);
    try {
      const result = await services.steamLibrarySync.sync();
      setSyncResult(result);
      setLastSyncedAt(result.syncedAt);
      publishLibraryChange();
    } catch (error) {
      const code = error instanceof SteamLibrarySyncError ? error.code : "unknown";
      const keyByCode: Record<string, Parameters<typeof t>[0]> = {
        api_key_unavailable: "steam.sync.reconnect",
        invalid_api_key: "steam.sync.invalidKey",
        private_library: "steam.sync.privateLibrary",
        rate_limited: "steam.sync.rateLimited",
        no_internet: "steam.sync.network",
        timeout: "steam.sync.timeout"
      };
      setMessage(t(keyByCode[code] ?? "steam.sync.error"));
    } finally {
      setSyncing(false);
    }
  };

  if (!available) {
    return (
      <div className="steam-unavailable" role="status">
        <Gamepad2 aria-hidden="true" />
        <div>
          <strong>{t("steam.desktopRequired")}</strong>
          <p>{t("steam.desktopDescription")}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {profile && status === "connected" ? (
        <div className="steam-library-panel">
          <div className="steam-connected-card">
            <ProfileAvatar
              className="steam-avatar"
              src={profile.avatarMediumUrl || profile.avatarFullUrl || profile.avatarUrl}
              name={profile.personaName}
            />
            <div>
              <span className="connected-badge"><CheckCircle2 /> {t("steam.connected")}</span>
              <strong>{profile.personaName}</strong>
              <small>{profile.steamId}</small>
            </div>
            <button className="secondary-button" type="button" onClick={() => setDisconnectOpen(true)}>
              <Link2Off size={15} /> {t("steam.disconnect")}
            </button>
          </div>
          <div className="steam-sync-row">
            <div>
              <strong>{t("steam.sync.title")}</strong>
              <small>{lastSyncedAt
                ? `${t("steam.sync.lastSync")} ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(lastSyncedAt))}`
                : t("steam.sync.never")}</small>
            </div>
            <button className="primary-button" type="button" onClick={() => void syncLibrary()} disabled={syncing}>
              <RefreshCw size={15} className={syncing ? "steam-sync-spinning" : ""} />
              {syncing ? t("steam.sync.syncing") : t("steam.sync.button")}
            </button>
          </div>
          {syncResult && <p className="steam-sync-result" role="status">{t("steam.sync.result")
            .replace("{fetched}", String(syncResult.fetched))
            .replace("{inserted}", String(syncResult.inserted))
            .replace("{updated}", String(syncResult.updated))
            .replace("{unchanged}", String(syncResult.unchanged))
            .replace("{skipped}", String(syncResult.skipped))}</p>}
        </div>
      ) : (
        <div className="steam-connection-form">
          <label>
            <span>SteamID64</span>
            <input
              inputMode="numeric"
              pattern="[0-9]{17}"
              maxLength={17}
              value={steamId}
              onChange={(event) => setSteamId(event.target.value.replace(/\D/g, ""))}
              placeholder={t("steam.idPlaceholder")}
              dir="ltr"
              disabled={status === "validating"}
              autoComplete="off"
            />
          </label>
          <label>
            <span>{t("steam.apiKey")}</span>
            <span className="secret-input">
              <input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={t("steam.apiPlaceholder")}
                dir="ltr"
                disabled={status === "validating"}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((value) => !value)}
                aria-label={showApiKey ? t("steam.hideKey") : t("steam.showKey")}
                disabled={status === "validating"}
              >
                {showApiKey ? <EyeOff /> : <Eye />}
              </button>
            </span>
          </label>
          <p className="steam-password-notice"><ShieldCheck /> {t("steam.passwordNotice")}</p>
          <button
            className="primary-button steam-connect-button"
            type="button"
            onClick={() => void connect()}
            disabled={!steamId.trim() || !apiKey.trim() || status === "validating"}
          >
            {status === "validating" ? t("steam.testing") : t("steam.test")}
          </button>
          {status === "validating" && (
            <HoloPulseLoader className="steam-connect-loader" size="sm" label={t("steam.contacting")} showDots />
          )}
        </div>
      )}
      {message && <p className="steam-error" role="alert">{message}</p>}
      {disconnectOpen && (
        <div className="dialog-backdrop" onMouseDown={() => setDisconnectOpen(false)}>
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="steam-disconnect-title" onMouseDown={(event) => event.stopPropagation()}>
            <div><Link2Off size={22} /></div>
            <h2 id="steam-disconnect-title">{t("steam.disconnectTitle")}</h2>
            <p>{t("steam.disconnectDescription")}</p>
            <footer>
              <button type="button" onClick={() => setDisconnectOpen(false)}>{t("common.cancel")}</button>
              <button className="danger-button" type="button" onClick={() => void disconnect()}>{t("steam.disconnect")}</button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
