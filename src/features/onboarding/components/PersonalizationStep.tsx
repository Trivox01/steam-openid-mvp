import { Monitor, Moon, Sun } from "lucide-react";
import type { UserPreferences } from "../../../types";
import { useTranslation } from "../../../i18n/TranslationContext";

export function PersonalizationStep({ preferences, onChange, onBack, onNext }: {
  preferences: UserPreferences; onChange: (next: UserPreferences) => Promise<void>; onBack: () => void; onNext: () => void;
}) {
  const { t } = useTranslation();
  return <div className="first-launch-step">
    <p className="first-launch-eyebrow">{t("onboarding.personalize.eyebrow")}</p><h1 className="nexus-display-title">{t("onboarding.personalize.title")}</h1>
    <div className="first-launch-options">
      <fieldset><legend>{t("settings.language")}</legend><div className="first-launch-choice">
        {(["en","ar"] as const).map(language => <button type="button" aria-pressed={preferences.language === language} onClick={() => void onChange({...preferences, language})} key={language}>{t(`settings.language.${language}`)}</button>)}
      </div></fieldset>
      <fieldset><legend>{t("settings.appearance")}</legend><div className="first-launch-choice">
        {(["dark","light","system"] as const).map((theme, index) => { const Icon = [Moon,Sun,Monitor][index]; return <button type="button" aria-pressed={preferences.theme === theme} onClick={() => void onChange({...preferences, theme})} key={theme}><Icon size={18}/>{t(`settings.theme.${theme}`)}</button>; })}
      </div></fieldset>
    </div>
    <div className="first-launch-preview"><span/><span/><span/><strong>{t("onboarding.personalize.preview")}</strong></div>
    <div className="first-launch-actions"><button type="button" onClick={onBack}>{t("onboarding.back")}</button><button autoFocus className="first-launch-primary" type="button" onClick={onNext}>{t("onboarding.continue")}</button></div>
  </div>;
}
