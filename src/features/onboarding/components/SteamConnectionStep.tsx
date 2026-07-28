import { useRef, useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import type { SteamProfile } from "../../../types";
import { useTranslation } from "../../../i18n/TranslationContext";
import type { SteamStepState } from "../onboarding.types";

export function SteamConnectionStep({ state, profile, error, onConnect, onBack, onContinue }: {
  state: SteamStepState; profile?: SteamProfile; error?: string;
  onConnect: (steamId: string, apiKey: string) => Promise<void>; onBack: () => void; onContinue: () => void;
}) {
  const { t } = useTranslation(); const [steamId, setSteamId] = useState(""); const keyRef = useRef<HTMLInputElement>(null);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); const key = keyRef.current?.value ?? "";
    await onConnect(steamId, key); if (keyRef.current) keyRef.current.value = "";
  };
  return <div className="first-launch-step">
    <p className="first-launch-eyebrow">Steam</p><h1>{t("onboarding.steam.title")}</h1><p className="first-launch-lead">{t("onboarding.steam.body")}</p>
    {state === "connected" && profile ? <div className="first-launch-connected"><CheckCircle2/><div><strong dir="auto">{profile.personaName}</strong><span>{t("onboarding.steam.connected")}</span></div></div> :
      <form className="first-launch-form" onSubmit={(event) => void submit(event)}>
        <label>{t("onboarding.steam.id")}<input inputMode="numeric" autoComplete="off" value={steamId} onChange={e => setSteamId(e.target.value)} /></label>
        <label>{t("onboarding.steam.key")}<input ref={keyRef} type="password" autoComplete="off" /></label>
        <p><ShieldCheck size={16}/>{t("onboarding.steam.privacy")}</p>
        {error && <p className="first-launch-error" role="alert">{error}</p>}
        <button className="first-launch-primary" disabled={state === "checking"} type="submit">{state === "checking" ? t("onboarding.steam.checking") : t("onboarding.steam.connect")}</button>
      </form>}
    <div className="first-launch-actions"><button type="button" onClick={onBack}>{t("onboarding.back")}</button><button type="button" onClick={onContinue}>{state === "connected" ? t("onboarding.continue") : t("onboarding.steam.skip")}</button></div>
  </div>;
}
