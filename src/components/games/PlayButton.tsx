import { useEffect, useState, type MouseEvent } from "react";
import { CircleAlert, CircleCheck, LoaderCircle, Play, WifiOff } from "lucide-react";
import { useTranslation } from "../../i18n/TranslationContext";
import { gameLauncher } from "../../services/compositionRoot";
import type { GameLaunchSnapshot } from "../../services/GameLauncherService";

export function PlayButton({ appId, title, compact = false }: { appId?: string; title: string; compact?: boolean }) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<GameLaunchSnapshot>(() => gameLauncher.getSnapshot(appId ?? ""));
  useEffect(() => gameLauncher.subscribe(appId ?? "", setSnapshot), [appId]);
  const launching = snapshot.status === "launching";
  const disabled = !appId || launching || snapshot.status === "gameUnavailable";
  const key = `gameLauncher.${snapshot.result === "launchRequested" ? "launchRequested" : snapshot.status}`;
  const label = t(key, { title });
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (appId) void gameLauncher.launch(appId);
  };
  return <button
    type="button"
    className={`nexus-play-button ${compact ? "nexus-play-button--compact" : ""}`}
    onClick={onClick}
    disabled={disabled}
    aria-busy={launching || undefined}
    aria-label={label}
    title={label}
    data-status={snapshot.status}
  >
    <LaunchIcon snapshot={snapshot} />
    {!compact && <span>{label}</span>}
  </button>;
}

function LaunchIcon({ snapshot }: { snapshot: GameLaunchSnapshot }) {
  if (snapshot.status === "launching") return <LoaderCircle className="nexus-play-button__spinner" aria-hidden="true" />;
  if (snapshot.status === "running" || snapshot.status === "alreadyRunning") return <CircleCheck aria-hidden="true" />;
  if (snapshot.status === "offline") return <WifiOff aria-hidden="true" />;
  if (["steamUnavailable", "steamNotInstalled", "gameUnavailable", "launchFailed"].includes(snapshot.status)) return <CircleAlert aria-hidden="true" />;
  return <Play aria-hidden="true" fill="currentColor" />;
}
