import type {
  SteamOpenIdDesktopState,
  SteamBackendSession,
  SteamOpenIdFinalStatus,
  SteamOpenIdIdentity,
  SteamOpenIdStatus
} from "../../types/steamOpenId";
import type { SteamOpenIdApi } from "./SteamOpenIdClient";
import {
  DesktopSessionBridgeError,
  type DesktopSessionBridge
} from "./TauriDesktopSessionBridge.ts";

export interface SteamOpenIdStateStore {
  getState(): Promise<SteamOpenIdDesktopState>;
  saveIdentity(identity: SteamOpenIdIdentity): Promise<void>;
  clearAuthenticatedSteamIdentity(): Promise<void>;
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
  private readonly desktopSessions: DesktopSessionBridge;
  private readonly baseUrl: string;
  private readonly request: typeof fetch;
  private activeSignIn?: AbortController;
  private activeSession?: SteamBackendSession;
  private refreshFlight?: Promise<SteamBackendSession | undefined>;
  private readonly sessionListeners = new Set<
    (session: SteamBackendSession | undefined) => void
  >();

  constructor(
    api: SteamOpenIdApi,
    store: SteamOpenIdStateStore,
    opener: ExternalUrlOpener,
    desktopSessions: DesktopSessionBridge,
    baseUrl: string,
    wait: (milliseconds: number, signal: AbortSignal) => Promise<void> =
      abortableWait,
    request: typeof fetch = fetch
  ) {
    this.api = api;
    this.store = store;
    this.opener = opener;
    this.desktopSessions = desktopSessions;
    this.baseUrl = baseUrl;
    this.wait = wait;
    this.request = request;
  }

  getSavedIdentity() {
    return this.store.getState().then((state) => state.identity);
  }

  getActiveSession() {
    if (
      this.activeSession &&
      Date.parse(this.activeSession.expiresAt) > Date.now()
    ) return this.activeSession;
    return undefined;
  }

  subscribeSession(
    listener: (session: SteamBackendSession | undefined) => void
  ) {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  expireSession() {
    this.clearActiveSession();
  }

  async restoreSession() {
    try {
      await this.refreshSession();
      return this.activeSession ? "restored" as const : "signed_out" as const;
    } catch (error) {
      if (error instanceof DesktopSessionBridgeError && error.kind === "network") {
        return "offline" as const;
      }
      if (error instanceof DesktopSessionBridgeError &&
          ["invalid", "account_not_active", "none"].includes(error.kind)) {
        await this.store.clearAuthenticatedSteamIdentity().catch(() => undefined);
      }
      return error instanceof DesktopSessionBridgeError && error.kind === "account_not_active"
        ? "account_not_active" as const : "signed_out" as const;
    }
  }

  async refreshSession() {
    if (!this.refreshFlight) {
      this.refreshFlight = this.desktopSessions.refresh(this.baseUrl)
        .then((session) => {
          this.activeSession = session;
          this.notifySession();
          return session;
        })
        .catch((error) => {
          if (error instanceof DesktopSessionBridgeError &&
              (error.kind === "invalid" || error.kind === "account_not_active" || error.kind === "none")) {
            this.clearActiveSession();
            void this.store.clearAuthenticatedSteamIdentity().catch(() => undefined);
          }
          throw error;
        })
        .finally(() => { this.refreshFlight = undefined; });
    }
    return this.refreshFlight;
  }

  async authenticatedFetch(url: string, init: RequestInit = {}, optional = false) {
    let session = this.getActiveSession();
    if (!session && !optional) {
      try { session = await this.refreshSession(); }
      catch (error) {
        if (error instanceof DesktopSessionBridgeError && error.kind === "account_not_active") {
          return Response.json({ error: "ACCOUNT_NOT_ACTIVE" }, { status: 403 });
        }
        if (error instanceof DesktopSessionBridgeError &&
            ["none", "invalid"].includes(error.kind)) {
          return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
        }
        throw error;
      }
    }
    const execute = (current?: SteamBackendSession) => this.request(url, {
      ...init,
      headers: { ...init.headers, ...(current ? { authorization: `Bearer ${current.token}` } : {}) }
    });
    let response = await execute(session);
    if (response.status !== 401 || !session) return response;
    let refreshed: SteamBackendSession | undefined;
    try { refreshed = await this.refreshSession(); }
    catch (error) {
      if (error instanceof DesktopSessionBridgeError && error.kind === "account_not_active") {
        return Response.json({ error: "ACCOUNT_NOT_ACTIVE" }, { status: 403 });
      }
      if (error instanceof DesktopSessionBridgeError &&
          ["none", "invalid"].includes(error.kind)) {
        return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
      }
      throw error;
    }
    response = await execute(refreshed);
    if (response.status === 401) this.clearActiveSession();
    return response;
  }

  async signOut() {
    this.activeSignIn?.abort();
    try { await this.desktopSessions.logout(this.baseUrl); } catch { /* local Rust command deletes first */ }
    try { await this.store.clearAuthenticatedSteamIdentity(); }
    finally { this.clearActiveSession(); }
  }

  async signIn(signal: AbortSignal): Promise<SteamOpenIdSignInResult> {
    const operation = new AbortController();
    this.activeSignIn?.abort();
    this.activeSignIn = operation;
    const activeSignal = AbortSignal.any([signal, operation.signal]);
    try {
      activeSignal.throwIfAborted();
      const { deviceId } = await this.store.getState();
      const started = await this.api.start(deviceId, activeSignal);
      activeSignal.throwIfAborted();
      await this.opener.open(started.steamLoginUrl);
      activeSignal.throwIfAborted();

      while (
        !activeSignal.aborted &&
        Date.now() < Date.parse(started.expiresAt)
      ) {
        await this.wait(started.pollingInterval, activeSignal);
        const status = await this.api.status({
          authRequestId: started.authRequestId,
          pollSecret: started.pollSecret,
          deviceId
        }, activeSignal);
        const final = await this.handleStatus(status);
        if (final) return final;
      }
      if (activeSignal.aborted) {
        throw new DOMException("cancelled", "AbortError");
      }
      return { status: "expired" };
    } finally {
      if (this.activeSignIn === operation) this.activeSignIn = undefined;
    }
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
      await this.desktopSessions.store(status.refreshCredential);
      try { await this.store.saveIdentity(identity); }
      catch (error) {
        await this.desktopSessions.logout(this.baseUrl).catch(() => undefined);
        throw error;
      }
      this.activeSession = {
        token: status.sessionToken,
        expiresAt: status.sessionExpiresAt
      };
      this.notifySession();
      return { status: "verified", identity };
    }
    return {
      status: status.status,
      ...(status.status === "failed" && status.errorCode
        ? { errorCode: status.errorCode }
        : {})
    };
  }

  private clearActiveSession() {
    if (!this.activeSession) return;
    this.activeSession = undefined;
    this.notifySession();
  }

  private notifySession() {
    for (const listener of this.sessionListeners) {
      listener(this.activeSession);
    }
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
