import { useEffect, useState } from "react";
import type { ActiveGameSession } from "../services/GameSessionStore";
import { gameSessionStore } from "../services/compositionRoot";

export interface GameSessionView {
  session?: ActiveGameSession;
  isRunning: boolean;
  elapsedSeconds: number;
}

export function useGameSession(appId?: string): GameSessionView {
  const [, setTick] = useState(0);
  useEffect(
    () => gameSessionStore.subscribe(() => setTick((value) => value + 1)),
    []
  );
  const session = appId ? gameSessionStore.find(appId) : undefined;
  return {
    session,
    isRunning: Boolean(session),
    elapsedSeconds: appId ? gameSessionStore.elapsedSeconds(appId) : 0
  };
}

export function formatSessionClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remaining = safe % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(remaining)}`
    : `${pad(minutes)}:${pad(remaining)}`;
}

export function formatSessionDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${safe}s`;
}