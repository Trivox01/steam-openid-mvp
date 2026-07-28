import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { UserPreferences } from "../../types";
import { services } from "../../services/compositionRoot";
import { publishLibraryChange } from "../../services/dataEvents";
import { useTranslation } from "../../i18n/TranslationContext";
import { InteractiveNeuralVortexBackground } from "../../components/ui/InteractiveNeuralVortexBackground";
import { moveStep, steamErrorTranslationKey } from "./onboardingFlow";
import type { OnboardingState } from "./onboarding.types";
import { OnboardingProgress } from "./components/OnboardingProgress";
import { WelcomeStep } from "./components/WelcomeStep";
import { PersonalizationStep } from "./components/PersonalizationStep";
import { SteamConnectionStep } from "./components/SteamConnectionStep";
import { LibrarySyncStep } from "./components/LibrarySyncStep";

export function FirstLaunchExperience({ preferences, onPreferencesChange, onComplete }: {
  preferences: UserPreferences; onPreferencesChange: (next: UserPreferences) => Promise<void>; onComplete: (next: UserPreferences) => Promise<void>;
}) {
  const { t } = useTranslation(); const reduce = useReducedMotion();
  const [state, setState] = useState<OnboardingState>({ step:"welcome", preferences, steamState:"disconnected", syncState:"idle" });
  const [finishing, setFinishing] = useState(false);
  useEffect(() => { services.steam.getSavedProfile().then(profile => { if (profile) setState(s => ({...s, profile, steamState:"connected"})); }).catch(() => undefined); }, []);
  const next = () => setState(s => ({...s, step: moveStep(s.step, 1)}));
  const back = () => setState(s => ({...s, step: moveStep(s.step, -1)}));
  const changePreferences = async (nextPreferences: UserPreferences) => { setState(s => ({...s, preferences:nextPreferences})); await onPreferencesChange(nextPreferences); };
  const connect = async (steamId: string, apiKey: string) => {
    setState(s => ({...s, steamState:"checking", steamErrorCode:undefined}));
    try { const result = await services.steam.connect({steamId, apiKey}); setState(s => result.success && result.profile ? {...s, steamState:"connected", profile:result.profile} : {...s, steamState:"error", steamErrorCode:result.errorCode}); }
    catch { setState(s => ({...s, steamState:"error", steamErrorCode:"network_error"})); }
  };
  const sync = async () => {
    setState(s => ({...s, syncState:"syncing"}));
    try { const result = await services.steamLibrarySync.sync(); publishLibraryChange(); setState(s => ({...s, syncState:"success", syncResult:result})); }
    catch { setState(s => ({...s, syncState:"error"})); }
  };
  const finish = async () => { setFinishing(true); try { await onComplete(state.preferences); } finally { setFinishing(false); } };
  return <main className="first-launch-shell"><InteractiveNeuralVortexBackground/><div className="first-launch-scrim"/>
    <section className="first-launch-panel"><OnboardingProgress step={state.step}/>
      <AnimatePresence mode="wait" initial={false}><motion.div key={state.step} initial={reduce?false:{opacity:0,y:12}} animate={{opacity:1,y:0}} exit={{opacity:0,y:reduce?0:-8}} transition={{duration:reduce?0:.22}}>
        {state.step==="welcome" && <WelcomeStep onNext={next}/>}
        {state.step==="personalization" && <PersonalizationStep preferences={state.preferences} onChange={changePreferences} onBack={back} onNext={next}/>}
        {state.step==="steam" && <SteamConnectionStep state={state.steamState} profile={state.profile} error={state.steamErrorCode?t(steamErrorTranslationKey(state.steamErrorCode)):undefined} onConnect={connect} onBack={back} onContinue={next}/>}
        {state.step==="library" && <LibrarySyncStep profile={state.profile} preferences={state.preferences} state={state.syncState} result={state.syncResult} error={state.syncState==="error"?t("onboarding.library.error"):undefined} onSync={sync} onBack={back} onFinish={finish} finishing={finishing}/>}
      </motion.div></AnimatePresence>
    </section></main>;
}
