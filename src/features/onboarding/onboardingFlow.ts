import type { UserPreferences } from "../../types";
import { onboardingSteps, type OnboardingStep } from "./onboarding.types.ts";

export const shouldShowOnboarding = (completed: boolean) => completed !== true;
export const stepIndex = (step: OnboardingStep) => onboardingSteps.indexOf(step);
export const moveStep = (step: OnboardingStep, delta: -1 | 1): OnboardingStep =>
  onboardingSteps[Math.min(onboardingSteps.length - 1, Math.max(0, stepIndex(step) + delta))];
export const completeOnboardingPreferences = (preferences: UserPreferences): UserPreferences => ({
  ...preferences,
  onboardingCompleted: true
});
export const directionForLanguage = (language: UserPreferences["language"]) => language === "ar" ? "rtl" : "ltr";
export const vortexMode = (webglAvailable: boolean, reducedMotion: boolean) =>
  webglAvailable && !reducedMotion ? "animated" : "static";
export const steamErrorTranslationKey = (code?: string) => ({
  invalid_steam_id: "onboarding.steam.error.invalidId",
  empty_api_key: "onboarding.steam.error.invalidKey",
  invalid_api_key: "onboarding.steam.error.invalidKey",
  private_profile: "onboarding.steam.error.private",
  network_error: "onboarding.steam.error.network",
  timeout: "onboarding.steam.error.timeout",
  rate_limited: "onboarding.steam.error.rateLimit"
}[code ?? ""] ?? "onboarding.steam.error.generic");
