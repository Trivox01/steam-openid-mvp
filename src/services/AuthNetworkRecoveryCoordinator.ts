import type { SteamOpenIdSignInService } from "./platform/SteamOpenIdSignInService.ts";

interface NetworkEventSource {
  addEventListener(type: "online" | "offline", listener: () => void): void;
  removeEventListener(type: "online" | "offline", listener: () => void): void;
}

export function installAuthNetworkRecovery(
  service: SteamOpenIdSignInService,
  events: NetworkEventSource = window,
  isOnline: () => boolean = () => navigator.onLine
) {
  let recoveryArmed = !isOnline() || service.getAuthenticationState() === "recoverable";

  const onOffline = () => { recoveryArmed = true; };
  const onOnline = () => {
    if (!recoveryArmed) return;
    recoveryArmed = false;
    void service.recoverSessionAfterNetwork();
  };
  const unsubscribeAuthenticationState = service.subscribeAuthenticationState((state) => {
    if (state === "recoverable") recoveryArmed = true;
    else recoveryArmed = false;
  });

  events.addEventListener("offline", onOffline);
  events.addEventListener("online", onOnline);
  return () => {
    unsubscribeAuthenticationState();
    events.removeEventListener("offline", onOffline);
    events.removeEventListener("online", onOnline);
  };
}
