import type { GameId, Platform } from "./index";
import type { GameCardSyncState } from "../services/gameCardPresentation";

export type GameCardStatus =
  | "notStarted"
  | "playing"
  | "completed"
  | "backlog"
  | "abandoned";

export type GameCardAccent = {
  accentPrimary: string;
  accentSecondary?: string;
  accentText?: string;
  backgroundDominant?: string;
};

export type GameCardData = {
  id: GameId;
  platformGameId?: string;
  title: string;
  coverUrl?: string;
  backgroundUrl?: string;
  iconUrl?: string;
  platform: Platform | string;
  playtimeMinutes: number;
  unlockedAchievements: number;
  totalAchievements: number;
  completionPercent: number;
  lastPlayedAt?: string | null;
  favorite: boolean;
  tracked?: boolean;
  hidden: boolean;
  status: GameCardStatus;
  syncState?: GameCardSyncState;
  achievementCompletion?: number;
  tracking?: boolean;
  accent?: GameCardAccent;
};

export type GameCardActions = {
  onOpen: (id: GameId) => void;
  onViewAchievements?: (id: GameId) => void;
  onViewDetails?: (id: GameId) => void;
  onFavoriteChange?: (id: GameId, favorite: boolean) => void;
  onTrackedChange?: (id: GameId, tracked: boolean) => void | Promise<void>;
};
