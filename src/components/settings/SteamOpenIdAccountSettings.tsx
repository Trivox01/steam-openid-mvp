import { CheckCircle2, ExternalLink, Gamepad2, LogOut, RefreshCw, Repeat2, ShieldAlert, WifiOff, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { services } from "../../services/compositionRoot";
import { SteamOpenIdClientError } from "../../services/platform/SteamOpenIdClient";
import type { SteamOpenIdIdentity } from "../../types/steamOpenId";
import { HoloPulseLoader } from "../ui/holo-pulse-loader";
import { useTranslation } from "../../i18n/TranslationContext";

type ViewState = "loading" | "idle" | "connecting" | "connected" | "offline" | "cancelled" | "error";
type AccountAction = "signOut" | "changeAccount";

export function SteamOpenIdAccountSettings() {
  const { t } = useTranslation();
  const service = services.steamOpenId;
  const abortController = useRef<AbortController | undefined>(undefined);
  const [viewState, setViewState] = useState<ViewState>("loading");
  const [identity, setIdentity] = useState<SteamOpenIdIdentity>();
  const [messageKey, setMessageKey] = useState<string>();
  const [accountAction, setAccountAction] = useState<AccountAction>();
  const [processingAccountAction, setProcessingAccountAction] = useState(false);

  useEffect(() => {
    let active = true;
    if (!service) {
      setViewState("error");
      setMessageKey("steam.openId.unavailable");
      return;
    }

    service.getSavedIdentity()
      .then((saved) => {
        if (!active) return;
        setIdentity(saved);
        const authState = service.getAuthenticationState();
        setViewState(saved
          ? authState === "authenticated" ? "connected"
            : authState === "recoverable" ? "offline" : "idle"
          : "idle");
      })
      .catch(() => {
        if (!active) return;
        setViewState("error");
        setMessageKey("steam.openId.loadError");
      });

    return () => {
      active = false;
      abortController.current?.abort();
    };
  }, [service]);

  useEffect(() => service?.subscribeAuthenticationState((authState) => {
    setViewState((current) => {
      if (current === "connecting") return current;
      if (authState === "authenticated" && identity) return "connected";
      if (authState === "recoverable" && identity) return "offline";
      return authState === "authentication_required" ? "idle" : current;
    });
  }), [identity, service]);

  const connect = useCallback(async () => {
    if (!service || viewState === "connecting") return;
    const controller = new AbortController();
    abortController.current = controller;
    setViewState("connecting");
    setMessageKey(undefined);

    try {
      const result = await service.signIn(controller.signal);
      if (result.status === "verified") {
        setIdentity(result.identity);
        setViewState("connected");
        return;
      }
      setViewState(result.status === "cancelled" ? "cancelled" : "error");
      setMessageKey(`steam.openId.${result.status}`);
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        setViewState("cancelled");
        setMessageKey("steam.openId.cancelled");
      } else if (error instanceof SteamOpenIdClientError) {
        setViewState("error");
        setMessageKey({
          network: "steam.openId.connectionError",
          http: "steam.openId.backendError",
          malformed: "steam.openId.malformedResponse",
          timeout: "steam.openId.timeout"
        }[error.kind]);
      } else {
        setViewState("error");
        setMessageKey("steam.openId.connectionError");
      }
    } finally {
      if (abortController.current === controller) abortController.current = undefined;
    }
  }, [service, viewState]);

  const cancel = () => abortController.current?.abort();

  const confirmAccountAction = async () => {
    if (!service || !accountAction || processingAccountAction) return;
    const action = accountAction;
    abortController.current?.abort();
    setProcessingAccountAction(true);
    setMessageKey(undefined);
    try {
      await service.signOut(action === "changeAccount" ? "change_account" : "user_logout");
      setIdentity(undefined);
      setAccountAction(undefined);
      if (action === "changeAccount") {
        setProcessingAccountAction(false);
        await connect();
      } else {
        setViewState("idle");
      }
    } catch {
      setViewState("connected");
      setMessageKey("steam.openId.disconnectError");
      setAccountAction(undefined);
    } finally {
      setProcessingAccountAction(false);
    }
  };

  if (viewState === "loading") {
    return (
      <div className="steam-openid-status" role="status" aria-live="polite">
        <HoloPulseLoader size="sm" />
        <p>{t("steam.openId.loading")}</p>
      </div>
    );
  }

  if (!service) {
    return (
      <div className="steam-unavailable" role="alert">
        <Gamepad2 aria-hidden="true" />
        <div>
          <strong>{t("steam.desktopRequired")}</strong>
          <p>{t(messageKey ?? "steam.openId.unavailable")}</p>
        </div>
      </div>
    );
  }

  if ((viewState === "connected" || viewState === "offline") && identity) {
    const offline = viewState === "offline";
    return (
      <>
        <div className="steam-openid-card">
          <div className="steam-openid-heading">
            <span className={`steam-openid-icon ${offline ? "steam-openid-icon-offline" : "steam-openid-icon-success"}`}>
              {offline ? <WifiOff aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
            </span>
            <div>
              <strong>{t(offline ? "steam.openId.offline" : "steam.openId.connected")}</strong>
              <p>{t(offline ? "steam.openId.offlineDescription" : "steam.openId.connectedDescription")}</p>
            </div>
          </div>
          <dl className="steam-openid-identity">
            <div>
              <dt>{t("steam.accountId")}</dt>
              <dd dir="ltr">{identity.steamId}</dd>
            </div>
            <div>
              <dt>{t("steam.openId.authenticatedAt")}</dt>
              <dd>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(identity.authenticatedAt))}</dd>
            </div>
          </dl>
          {messageKey ? <p className="form-error" role="alert">{t(messageKey)}</p> : null}
          <div className="steam-openid-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={processingAccountAction}
              onClick={() => setAccountAction("changeAccount")}
            >
              <Repeat2 size={16} aria-hidden="true" />
              {t("steam.openId.changeAccount")}
            </button>
            <button
              className="danger-button"
              type="button"
              disabled={processingAccountAction}
              onClick={() => setAccountAction("signOut")}
            >
              <LogOut size={16} aria-hidden="true" />
              {t("steam.openId.signOut")}
            </button>
          </div>
        </div>
        {accountAction ? (
          <SteamAccountActionDialog
            action={accountAction}
            processing={processingAccountAction}
            onCancel={() => {
              if (!processingAccountAction) setAccountAction(undefined);
            }}
            onConfirm={confirmAccountAction}
          />
        ) : null}
      </>
    );
  }

  return (
    <div className="steam-openid-card">
      <div className="steam-openid-heading">
        <span className="steam-openid-icon">
          <Gamepad2 aria-hidden="true" />
        </span>
        <div>
          <strong>{t("steam.openId.title")}</strong>
          <p>{t("steam.openId.description")}</p>
        </div>
      </div>

      {viewState === "connecting" ? (
        <div className="steam-openid-status" role="status" aria-live="polite">
          <HoloPulseLoader size="sm" />
          <div>
            <strong>{t("steam.openId.waiting")}</strong>
            <p>{t("steam.openId.browserHint")}</p>
          </div>
          <button className="secondary-button" type="button" onClick={cancel}>
            <X size={16} aria-hidden="true" />
            {t("steam.openId.cancel")}
          </button>
        </div>
      ) : (
        <>
          {messageKey ? (
            <p className={viewState === "cancelled" ? "form-message" : "form-error"} role="alert">
              {t(messageKey)}
            </p>
          ) : null}
          <div className="steam-openid-actions">
            <button className="primary-button" type="button" onClick={connect}>
              {viewState === "error" || viewState === "cancelled"
                ? <RefreshCw size={16} aria-hidden="true" />
                : <ExternalLink size={16} aria-hidden="true" />}
              {viewState === "error" || viewState === "cancelled"
                ? t("steam.openId.retry")
                : t("steam.openId.signIn")}
            </button>
          </div>
        </>
      )}
      <p className="steam-password-notice">{t("steam.openId.securityNotice")}</p>
    </div>
  );
}

function SteamAccountActionDialog({
  action,
  processing,
  onCancel,
  onConfirm
}: {
  action: AccountAction;
  processing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const cancelButton = useRef<HTMLButtonElement>(null);
  const isSignOut = action === "signOut";

  useEffect(() => {
    cancelButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !processing) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel, processing]);

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={() => {
        if (!processing) onCancel();
      }}
    >
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={processing}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div><ShieldAlert size={22} aria-hidden="true" /></div>
        <h2 id={titleId}>
          {t(isSignOut
            ? "steam.openId.signOutDialog.title"
            : "steam.openId.changeAccountDialog.title")}
        </h2>
        <p>
          {t(isSignOut
            ? "steam.openId.signOutDialog.message"
            : "steam.openId.changeAccountDialog.message")}
        </p>
        <footer>
          <button
            ref={cancelButton}
            type="button"
            disabled={processing}
            onClick={onCancel}
          >
            {t("steam.openId.dialog.cancel")}
          </button>
          <button
            className={isSignOut ? "danger-button" : "primary-button"}
            type="button"
            disabled={processing}
            onClick={onConfirm}
          >
            {processing
              ? t("steam.openId.processing")
              : t(isSignOut
                ? "steam.openId.signOutDialog.confirm"
                : "steam.openId.changeAccountDialog.confirm")}
          </button>
        </footer>
      </div>
    </div>
  );
}
