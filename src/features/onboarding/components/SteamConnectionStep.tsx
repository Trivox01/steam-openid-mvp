import { CheckCircle2, ExternalLink, ShieldCheck } from "lucide-react";
import type { SteamProfile } from "../../../types";
import { useTranslation } from "../../../i18n/TranslationContext";
import type { SteamStepState } from "../onboarding.types";

export function SteamConnectionStep({ state, profile, error, onConnect, onBack, onContinue }: {
  state: SteamStepState; profile?: SteamProfile; error?: string;
  onConnect: () => Promise<void>; onBack: () => void; onContinue: () => void;
}) {
  const { t } = useTranslation();
  return <div className="first-launch-step">
    <p className="first-launch-eyebrow">Steam</p><h1 className="nexus-display-title">{t("onboarding.steam.title")}</h1><p className="first-launch-lead">{t("onboarding.steam.body")}</p>
    {state === "connected" && profile ? <div className="first-launch-connected"><CheckCircle2/><div><strong dir="auto">{profile.personaName}</strong><span>{t("onboarding.steam.connected")}</span></div></div> :
      <div className="first-launch-form">
        <p><ShieldCheck size={16}/>{t("steam.openId.securityNotice")}</p>
        {error && <p className="first-launch-error" role="alert">{error}</p>}
        <button className="first-launch-primary" disabled={state === "checking"} type="button" onClick={() => void onConnect()}><ExternalLink size={16}/>{state === "checking" ? t("onboarding.steam.checking") : t("steam.openId.signIn")}</button>
      </div>}
    <div className="first-launch-actions"><button type="button" onClick={onBack}>{t("onboarding.back")}</button><button type="button" onClick={onContinue}>{state === "connected" ? t("onboarding.continue") : t("onboarding.steam.skip")}</button></div>
  </div>;
}
