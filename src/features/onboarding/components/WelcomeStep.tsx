import { Sparkles } from "lucide-react";
import { useTranslation } from "../../../i18n/TranslationContext";

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation();
  return <div className="first-launch-step">
    <div className="first-launch-mark"><Sparkles /></div>
    <p className="first-launch-eyebrow">Achievement Nexus</p>
    <h1 className="nexus-display-title">{t("onboarding.welcome.title")}</h1>
    <p className="first-launch-lead">{t("onboarding.welcome.body")}</p>
    <button autoFocus className="first-launch-primary" type="button" onClick={onNext}>{t("onboarding.welcome.start")}</button>
  </div>;
}
