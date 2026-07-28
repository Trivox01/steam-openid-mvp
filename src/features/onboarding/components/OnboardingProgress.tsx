import { onboardingSteps, type OnboardingStep } from "../onboarding.types";
import { stepIndex } from "../onboardingFlow";
import { useTranslation } from "../../../i18n/TranslationContext";

export function OnboardingProgress({ step }: { step: OnboardingStep }) {
  const { t } = useTranslation();
  const current = stepIndex(step);
  return <ol className="first-launch-progress" aria-label={t("onboarding.progress", { current: current + 1, total: 4 })}>
    {onboardingSteps.map((item, index) => <li key={item} className={index <= current ? "active" : ""}><span>{index + 1}</span><small>{t(`onboarding.step.${item}`)}</small></li>)}
  </ol>;
}

