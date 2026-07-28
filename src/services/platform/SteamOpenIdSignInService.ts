import type {
  SteamOpenIdDesktopState,
  SteamOpenIdFinalStatus,
  SteamOpenIdIdentity,
  SteamOpenIdStatus
} from "../../types/steamOpenId";
import type { SteamOpenIdApi } from "./SteamOpenIdClient";

export interface SteamOpenIdStateStore {
  getState(): Promise<SteamOpenIdDesktopState>;
  saveIdentity(identity: SteamOpenIdIdentity): Promise<void>;
  clearIdentity(): Promise<void>;
}

export interface ExternalUrlOpener {
  open(url: string): Promise<void>;
}

export type SteamOpenIdSignInResult =
  | { status: "verified"; identity: SteamOpenIdIdentity }
  | { status: Exclude<SteamOpenIdFinalStatus, "verified">; errorCode?: string };

export class SteamOpenIdSignInService {
  private readonly api: SteamOpenIdApi;
  private readonly store: SteamOpenIdStateStore;
  private readonly opener: ExternalUrlOpener;
  private readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;

  constructor(
    api: SteamOpenIdApi,
    store: SteamOpenIdStateStore,
    opener: ExternalUrlOpener,
    wait: (milliseconds: number, signal: AbortSignal) => Promise<void> =
      abortableWait
  ) {
    this.api = api;
    this.store = store;
    this.opener = opener;
    this.wait = wait;
  }

  getSavedIdentity() {
    return this.store.getState().then((state) => state.identity);
  }

  disconnect() {
    return this.store.clearIdentity();
  }

  async signIn(signal: AbortSignal): Promise<SteamOpenIdSignInResult> {
    signal.throwIfAborted();
    const { deviceId } = await this.store.getState();
    const started = await this.api.start(deviceId, signal);
    signal.throwIfAborted();
    await this.opener.open(started.steamLoginUrl);
    signal.throwIfAborted();

    while (!signal.aborted && Date.now() < Date.parse(started.expiresAt)) {
      await this.wait(started.pollingInterval, signal);
      const status = await this.api.status({
        authRequestId: started.authRequestId,
        pollSecret: started.pollSecret,
        deviceId
      }, signal);
      const final = await this.handleStatus(status);
      if (final) return final;
    }
    if (signal.aborted) throw new DOMException("cancelled", "AbortError");
    return { status: "expired" };
  }

  private async handleStatus(
    status: SteamOpenIdStatus
  ): Promise<SteamOpenIdSignInResult | undefined> {
    if (status.status === "pending") return undefined;
    if (status.status === "verified") {
      const identity: SteamOpenIdIdentity = {
        steamId: status.steamId,
        authenticatedAt: status.authenticatedAt,
        authMethod: "steam_openid"
      };
      await this.store.saveIdentity(identity);
      return { status: "verified", identity };
    }
    return {
      status: status.status,
      ...(status.status === "failed" && status.errorCode
        ? { errorCode: status.errorCode }
        : {})
    };
  }
}

function abortableWait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("cancelled", "AbortError"));
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("cancelled", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
