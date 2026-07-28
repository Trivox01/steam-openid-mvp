import { LockKeyhole, ShieldX } from "lucide-react";
import { useAuthorization } from "./AuthorizationContext";
import { LoadingView, ErrorView } from "../../components/ui/StateViews";
import { useTranslation } from "../../i18n/TranslationContext";
import { DeveloperCenterPage } from "../../pages/DeveloperCenterPage";

export function DeveloperCenterRoute({
  onOpenSettings
}: {
  onOpenSettings: () => void;
}) {
  const { state, retry } = useAuthorization();
  const { t } = useTranslation();

  if (state.status === "idle" || state.status === "loading") {
    return <LoadingView size="md" label={t("developer.loading")} />;
  }
  if (state.status === "error") {
    return <ErrorView message={t("developer.error")} onRetry={retry} />;
  }
  if (state.status === "unauthorized") {
    return (
      <AccessState
        icon={LockKeyhole}
        title={t("developer.sessionRequired")}
        description={t("developer.sessionRequiredDescription")}
        action={t("developer.openSteamSettings")}
        onAction={onOpenSettings}
      />
    );
  }
  if (state.status === "forbidden") {
    return (
      <AccessState
        icon={ShieldX}
        title={t("developer.forbidden")}
        description={t("developer.forbiddenDescription")}
      />
    );
  }
  return <DeveloperCenterPage snapshot={state.snapshot} />;
}

function AccessState({
  icon: Icon,
  title,
  description,
  action,
  onAction
}: {
  icon: typeof LockKeyhole;
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <section className="developer-access-state" aria-labelledby="developer-access-title">
      <span><Icon aria-hidden="true" /></span>
      <h1 id="developer-access-title">{title}</h1>
      <p>{description}</p>
      {action && onAction ? (
        <button className="primary-button" type="button" onClick={onAction}>
          {action}
        </button>
      ) : null}
    </section>
  );
}
