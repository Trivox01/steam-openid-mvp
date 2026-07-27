import { useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, Gamepad2, Link2Off, ShieldCheck } from "lucide-react";
import { HoloPulseLoader } from "../ui/holo-pulse-loader";
import { services } from "../../services/compositionRoot";
import { steamProfileToUserProfile } from "../../services/platform/SteamConnectionService";
import type {
  SteamConnectionStatus,
  SteamProfile,
  UserProfile
} from "../../types";
import { ProfileAvatar } from "../ui/ProfileAvatar";

export function SteamAccountSettings({
  onProfileChange
}: {
  onProfileChange?: (profile: UserProfile) => void;
}) {
  const [steamId, setSteamId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [status, setStatus] = useState<SteamConnectionStatus>("disconnected");
  const [profile, setProfile] = useState<SteamProfile>();
  const [message, setMessage] = useState("");
  const [disconnectOpen, setDisconnectOpen] = useState(false);
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
        setMessage("The saved Steam profile could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, []);

  const connect = async () => {
    if (!steamId.trim() || !apiKey.trim() || status === "validating") return;
    setStatus("validating");
    setMessage("");
    try {
      const result = await services.steam.connect({ steamId, apiKey });
      if (!result.success || !result.profile) {
        setStatus("error");
        setMessage(result.userMessage ?? "Steam connection could not be verified.");
        return;
      }
      setProfile(result.profile);
      setSteamId(result.profile.steamId);
      setApiKey("");
      setShowApiKey(false);
      setStatus("connected");
      onProfileChange?.(steamProfileToUserProfile(result.profile));
    } catch (error: unknown) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Steam connection could not be completed."
      );
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
    } catch (error: unknown) {
      setStatus("error");
      setMessage(
        error instanceof Error ? error.message : "Steam could not be disconnected."
      );
    }
  };

  if (!available) {
    return (
      <div className="steam-unavailable" role="status">
        <Gamepad2 aria-hidden="true" />
        <div>
          <strong>Desktop application required</strong>
          <p>Steam account connection is available only inside Achievement Nexus for Tauri.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {profile && status === "connected" ? (
        <div className="steam-connected-card">
          <ProfileAvatar
            className="steam-avatar"
            src={profile.avatarMediumUrl || profile.avatarFullUrl || profile.avatarUrl}
            name={profile.personaName}
          />
          <div>
            <span className="connected-badge"><CheckCircle2 /> Connected</span>
            <strong>{profile.personaName}</strong>
            <small>{profile.steamId}</small>
          </div>
          <button className="secondary-button" type="button" onClick={() => setDisconnectOpen(true)}>
            <Link2Off size={15} /> Disconnect
          </button>
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
              placeholder="17-digit SteamID64"
              disabled={status === "validating"}
              autoComplete="off"
            />
          </label>
          <label>
            <span>Steam Web API Key</span>
            <span className="secret-input">
              <input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="Enter your Web API key"
                disabled={status === "validating"}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((value) => !value)}
                aria-label={showApiKey ? "Hide Steam API key" : "Show Steam API key"}
                disabled={status === "validating"}
              >
                {showApiKey ? <EyeOff /> : <Eye />}
              </button>
            </span>
          </label>
          <p className="steam-password-notice"><ShieldCheck /> Achievement Nexus never asks for your Steam password.</p>
          <button
            className="primary-button steam-connect-button"
            type="button"
            onClick={() => void connect()}
            disabled={!steamId.trim() || !apiKey.trim() || status === "validating"}
          >
            {status === "validating" ? "Testing connection…" : "Test connection"}
          </button>
          {status === "validating" && (
            <HoloPulseLoader className="steam-connect-loader" size="sm" label="Contacting Steam" showDots />
          )}
        </div>
      )}
      {message && <p className="steam-error" role="alert">{message}</p>}
      {disconnectOpen && (
        <div className="dialog-backdrop" onMouseDown={() => setDisconnectOpen(false)}>
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="steam-disconnect-title" onMouseDown={(event) => event.stopPropagation()}>
            <div><Link2Off size={22} /></div>
            <h2 id="steam-disconnect-title">Disconnect Steam?</h2>
            <p>The saved Steam profile and in-memory API key will be removed. Your local game data will remain.</p>
            <footer>
              <button type="button" onClick={() => setDisconnectOpen(false)}>Cancel</button>
              <button className="danger-button" type="button" onClick={() => void disconnect()}>Disconnect</button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
