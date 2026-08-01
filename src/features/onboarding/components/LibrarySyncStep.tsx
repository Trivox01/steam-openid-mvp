import type { SteamLibrarySyncResult, SteamProfile, UserPreferences } from "../../../types";
import { useTranslation } from "../../../i18n/TranslationContext";
import type { SyncStepState } from "../onboarding.types";

export function LibrarySyncStep({ profile, preferences, state, result, error, onSync, onBack, onFinish, finishing }: {
  profile?: SteamProfile; preferences: UserPreferences; state: SyncStepState; result?: SteamLibrarySyncResult; error?: string;
  onSync: () => Promise<void>; onBack: () => void; onFinish: () => Promise<void>; finishing: boolean;
}) {
  const { t } = useTranslation();
  return <div className="first-launch-step">
    <p className="first-launch-eyebrow">{t("onboarding.library.eyebrow")}</p><h1 className="nexus-display-title">{result ? t("onboarding.library.ready") : t("onboarding.library.title")}</h1>
    <p className="first-launch-lead">{profile ? t("onboarding.library.connectedBody") : t("onboarding.library.skippedBody")}</p>
    {profile && !result && <button className="first-launch-primary" type="button" disabled={state === "syncing"} onClick={() => void onSync()}>{state === "syncing" ? t("onboarding.library.syncing") : t("onboarding.library.sync")}</button>}
    {result && <dl className="first-launch-summary"><div><dt>{t("onboarding.library.received")}</dt><dd>{result.fetched}</dd></div><div><dt>{t("onboarding.library.new")}</dt><dd>{result.inserted}</dd></div><div><dt>{t("onboarding.library.updated")}</dt><dd>{result.updated}</dd></div><div><dt>{t("onboarding.library.skipped")}</dt><dd>{result.skipped}</dd></div></dl>}
    <ul className="first-launch-facts"><li>{t(`settings.theme.${preferences.theme}`)}</li><li>{t(`settings.language.${preferences.language}`)}</li>{profile && <li dir="auto">{profile.personaName}</li>}</ul>
    {error && <p className="first-launch-error" role="alert">{error}</p>}<p className="first-launch-note">{t("onboarding.library.achievementsLater")}</p>
    <div className="first-launch-actions"><button type="button" onClick={onBack}>{t("onboarding.back")}</button>{state === "error" && <button type="button" onClick={() => void onSync()}>{t("onboarding.retry")}</button>}<button autoFocus className="first-launch-primary" disabled={finishing} type="button" onClick={() => void onFinish()}>{finishing ? t("onboarding.saving") : t("onboarding.enter")}</button></div>
  </div>;
}
