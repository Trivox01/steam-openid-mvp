import { CheckCircle2, ExternalLink, Gamepad2, Link2Off, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { services } from "../../services/compositionRoot";
import { SteamOpenIdClientError } from "../../services/platform/SteamOpenIdClient";
import type { SteamOpenIdIdentity } from "../../types/steamOpenId";
import { HoloPulseLoader } from "../ui/holo-pulse-loader";
import { useTranslation } from "../../i18n/TranslationContext";

type ViewState = "loading" | "idle" | "connecting" | "connected" | "cancelled" | "error";

export function SteamOpenIdAccountSettings() {
  const { t } = useTranslation();
  const service = services.steamOpenId;
  const abortController = useRef<AbortController | undefined>(undefined);
  const [viewState, setViewState] = useState<ViewState>("loading");
  const [identity, setIdentity] = useState<SteamOpenIdIdentity>();
  const [messageKey, setMessageKey] = useState<string>();

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
        setViewState(saved ? "connected" : "idle");
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

  const disconnect = async () => {
    if (!service) return;
    try {
      await service.disconnect();
      setIdentity(undefined);
      setMessageKey(undefined);
      setViewState("idle");
    } catch {
      setViewState("error");
      setMessageKey("steam.openId.disconnectError");
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

  if (viewState === "connected" && identity) {
    return (
      <div className="steam-openid-card">
        <div className="steam-openid-heading">
          <span className="steam-openid-icon steam-openid-icon-success">
            <CheckCircle2 aria-hidden="true" />
          </span>
          <div>
            <strong>{t("steam.openId.connected")}</strong>
            <p>{t("steam.openId.connectedDescription")}</p>
          </div>
        </div>
        <dl className="steam-openid-identity">
          <div>
            <dt>SteamID64</dt>
            <dd dir="ltr">{identity.steamId}</dd>
          </div>
          <div>
            <dt>{t("steam.openId.authenticatedAt")}</dt>
            <dd>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(identity.authenticatedAt))}</dd>
          </div>
        </dl>
        <button className="secondary-button" type="button" onClick={disconnect}>
          <Link2Off size={16} aria-hidden="true" />
          {t("steam.disconnect")}
        </button>
      </div>
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
