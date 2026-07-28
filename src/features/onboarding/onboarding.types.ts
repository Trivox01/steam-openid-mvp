import type { SteamLibrarySyncResult, SteamProfile, UserPreferences } from "../../types";

export const onboardingSteps = ["welcome", "personalization", "steam", "library"] as const;
export type OnboardingStep = (typeof onboardingSteps)[number];
export type SteamStepState = "disconnected" | "checking" | "connected" | "error";
export type SyncStepState = "idle" | "syncing" | "success" | "error";

export interface OnboardingState {
  step: OnboardingStep;
  preferences: UserPreferences;
  steamState: SteamStepState;
  profile?: SteamProfile;
  steamErrorCode?: string;
  syncState: SyncStepState;
  syncResult?: SteamLibrarySyncResult;
}

