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
import type { SteamAchievementSyncResult, SteamLibrarySyncResult } from "../../types";
import { SteamLibrarySyncError } from "../../services/platform/SteamLibrarySyncService";
import { publishLibraryChange } from "../../services/dataEvents";
import {
  achievementFailureCounts,
  retryableAchievementGameIds
} from "../../services/platform/SteamAchievementSyncCore";

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
  const [achievementSyncing, setAchievementSyncing] = useState(false);
  const [achievementProgress, setAchievementProgress] = useState({ processed: 0, total: 0 });
  const [achievementResult, setAchievementResult] = useState<SteamAchievementSyncResult>();
  const [lastAchievementSync, setLastAchievementSync] = useState<string>();
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
    services.steamAchievementSync.getLastSync()
      .then((metadata) => {
        if (active) setLastAchievementSync(metadata?.lastSyncedAt);
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

  const syncAchievements = async (gameIds?: string[]) => {
    if (achievementSyncing) return;
    setAchievementSyncing(true);
    setAchievementResult(undefined);
    setMessage("");
    try {
      const result = await services.steamAchievementSync.sync({
        gameIds,
        onProgress: (processed, total) => setAchievementProgress({ processed, total })
      });
      setAchievementResult(result);
      if (result.gamesSucceeded > 0) setLastAchievementSync(result.syncedAt);
      publishLibraryChange();
    } catch {
      setMessage(t("steam.sync.error"));
    } finally {
      setAchievementSyncing(false);
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
          <div className="steam-sync-row">
            <div>
              <strong>{t("steam.achievements.title")}</strong>
              <small>{lastAchievementSync
                ? `${t("steam.achievements.lastSync")} ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(lastAchievementSync))}`
                : t("steam.achievements.noData")}</small>
              {achievementSyncing && <small aria-live="polite">{t("steam.achievements.gamesProcessed")
                .replace("{processed}", String(achievementProgress.processed))
                .replace("{total}", String(achievementProgress.total))}</small>}
            </div>
            <button className="primary-button" type="button" onClick={() => void syncAchievements()} disabled={achievementSyncing}>
              <RefreshCw size={15} className={achievementSyncing ? "steam-sync-spinning" : ""} />
              {achievementSyncing ? t("steam.achievements.syncing") : t("steam.achievements.sync")}
            </button>
          </div>
          {achievementResult && (
            <div className={achievementResult.partial ? "steam-sync-warning" : "steam-sync-result"} role="status">
              <span>{t("steam.achievements.result")
                .replace("{games}", String(achievementResult.gamesSucceeded))
                .replace("{inserted}", String(achievementResult.inserted))
                .replace("{updated}", String(achievementResult.updated))
                .replace("{unchanged}", String(achievementResult.unchanged))}</span>
              <small>{t("steam.achievements.fetched").replace("{count}", String(achievementResult.achievementsFetched))}</small>
              <small>{t("steam.achievements.summaryCounts", {
                completed: achievementResult.gamesSucceeded,
                failed: achievementResult.gamesFailed,
                unsupported: achievementResult.gamesUnsupported
              })}</small>
              {achievementResult.partial && <small>{t("steam.achievements.libraryUnaffected")}</small>}
              {achievementResult.gamesSucceeded === 0 && achievementResult.gamesUnsupported > 0 && <small>{t("steam.achievements.noSupported")}</small>}
              {Object.entries(achievementFailureCounts(achievementResult.games)).map(([code, count]) => (
                <small key={code}>{achievementErrorLabel(code, count, t)}</small>
              ))}
              {retryableAchievementGameIds(achievementResult.games).length > 0 && (
                <button type="button" onClick={() => void syncAchievements(
                  retryableAchievementGameIds(achievementResult.games)
                )}>{t("steam.achievements.retryFailedCount", {
                  count: retryableAchievementGameIds(achievementResult.games).length
                })}</button>
              )}
            </div>
          )}
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

function achievementErrorLabel(
  code: string,
  count: number,
  t: ReturnType<typeof useTranslation>["t"]
) {
  const keys: Record<string, Parameters<typeof t>[0]> = {
    no_achievements: "steam.achievements.noSchema",
    game_unsupported: "steam.achievements.unsupportedCount",
    private_library: "steam.achievements.privateCount",
    rate_limited: "steam.achievements.rateLimitedCount",
    timeout: "steam.achievements.temporaryCount",
    no_internet: "steam.achievements.networkCount",
    steam_api_unavailable: "steam.achievements.temporaryCount",
    invalid_response: "steam.achievements.invalidResponseCount",
    invalid_api_key: "steam.achievements.authenticationCount",
    api_key_unavailable: "steam.achievements.authenticationCount"
  };
  return t(keys[code] ?? "steam.achievements.unknownCount", { count });
}
