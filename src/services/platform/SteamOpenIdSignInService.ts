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
import {
  desktopSessionDiagnostics,
  type DesktopLogoutReason,
  type DesktopRefreshTrigger
} from "./DesktopSessionDiagnostics.ts";

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

export type DesktopAuthenticationState =
  | "authentication_required"
  | "recoverable"
  | "authenticated";

export type DesktopNetworkRecoveryResult =
  | "restored"
  | "offline"
  | "signed_out"
  | "skipped";

export interface BootHealthPreflightPolicy {
  budgetMs: number;
  backoffMs: readonly number[];
  now: () => number;
}

const DEFAULT_BOOT_HEALTH_PREFLIGHT: BootHealthPreflightPolicy = {
  budgetMs: 30_000,
  backoffMs: [500, 1_000, 2_000, 3_000, 5_000],
  now: Date.now
};

export class SteamOpenIdSignInService {
  private readonly api: SteamOpenIdApi;
  private readonly store: SteamOpenIdStateStore;
  private readonly opener: ExternalUrlOpener;
  private readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private readonly desktopSessions: DesktopSessionBridge;
  private readonly baseUrl: string;
  private readonly request: typeof fetch;
  private readonly bootHealth: BootHealthPreflightPolicy;
  private activeSignIn?: AbortController;
  private activeSession?: SteamBackendSession;
  private refreshFlight?: Promise<SteamBackendSession | undefined>;
  private recoveryFlight?: Promise<DesktopNetworkRecoveryResult>;
  private authState: DesktopAuthenticationState = "authentication_required";
  private logoutInProgress = false;
  private readonly sessionListeners = new Set<
    (session: SteamBackendSession | undefined) => void
  >();
  private readonly authStateListeners = new Set<
    (state: DesktopAuthenticationState) => void
  >();

  constructor(
    api: SteamOpenIdApi,
    store: SteamOpenIdStateStore,
    opener: ExternalUrlOpener,
    desktopSessions: DesktopSessionBridge,
    baseUrl: string,
    wait: (milliseconds: number, signal: AbortSignal) => Promise<void> =
      abortableWait,
    request: typeof fetch = fetch,
    bootHealth: Partial<BootHealthPreflightPolicy> = {}
  ) {
    this.api = api;
    this.store = store;
    this.opener = opener;
    this.desktopSessions = desktopSessions;
    this.baseUrl = baseUrl;
    this.wait = wait;
    this.request = request;
    this.bootHealth = {
      ...DEFAULT_BOOT_HEALTH_PREFLIGHT,
      ...bootHealth
    };
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

  getAuthenticationState() {
    return this.authState;
  }

  subscribeAuthenticationState(
    listener: (state: DesktopAuthenticationState) => void
  ) {
    this.authStateListeners.add(listener);
    return () => { this.authStateListeners.delete(listener); };
  }

  subscribeSession(
    listener: (session: SteamBackendSession | undefined) => void
  ) {
    this.sessionListeners.add(listener);
    return () => { this.sessionListeners.delete(listener); };
  }

  expireSession() {
    this.clearActiveSession();
    this.setAuthenticationState("recoverable");
  }

  async restoreSession(trigger: DesktopRefreshTrigger = "boot_restore") {
    const operationId = desktopSessionDiagnostics.operationId();
    desktopSessionDiagnostics.record("desktop_restore_started", operationId, { trigger });
    if (trigger === "boot_restore") {
      try {
        if (!await this.desktopSessions.hasCredential()) {
          this.setAuthenticationState("authentication_required");
          return "signed_out" as const;
        }
      } catch {
        this.setAuthenticationState("recoverable");
        return "offline" as const;
      }
    }
    try {
      await this.refreshSession(trigger, operationId);
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

  async refreshSession(
    trigger: DesktopRefreshTrigger = "other",
    operationId = desktopSessionDiagnostics.operationId()
  ) {
    if (!this.refreshFlight) {
      desktopSessionDiagnostics.record("desktop_refresh_started", operationId, { trigger });
      this.refreshFlight = this.refreshAfterHealthPreflight(trigger, operationId)
        .then((session) => {
          this.activeSession = session;
          this.setAuthenticationState("authenticated");
          this.notifySession();
          desktopSessionDiagnostics.record("desktop_refresh_completed", operationId, { trigger });
          return session;
        })
        .catch((error) => {
          desktopSessionDiagnostics.record("desktop_refresh_failed", operationId, { trigger });
          if (error instanceof DesktopSessionBridgeError &&
              (error.kind === "invalid" || error.kind === "account_not_active" || error.kind === "none")) {
            this.clearActiveSession();
            this.setAuthenticationState("authentication_required");
            void this.store.clearAuthenticatedSteamIdentity().catch(() => undefined);
          } else if (error instanceof DesktopSessionBridgeError && error.kind === "network" &&
              (trigger === "boot_restore" || trigger === "access_token_expired" ||
                trigger === "network_recovered")) {
            this.clearActiveSession();
            this.setAuthenticationState("recoverable");
          }
          throw error;
        })
        .finally(() => { this.refreshFlight = undefined; });
    }
    return this.refreshFlight;
  }

  private async refreshAfterHealthPreflight(
    trigger: DesktopRefreshTrigger,
    operationId: string
  ) {
    if (trigger === "boot_restore" || trigger === "access_token_expired" ||
        trigger === "network_recovered") {
      await this.waitForBackendHealth(operationId, trigger);
    }
    return this.desktopSessions.refresh(this.baseUrl, {
      bootId: desktopSessionDiagnostics.bootId,
      authOperationId: operationId,
      trigger
    });
  }

  private async waitForBackendHealth(
    operationId: string,
    trigger: Extract<
      DesktopRefreshTrigger,
      "boot_restore" | "access_token_expired" | "network_recovered"
    >
  ) {
    const startedAt = this.bootHealth.now();
    const deadline = startedAt + this.bootHealth.budgetMs;
    let attempt = 0;
    desktopSessionDiagnostics.record("desktop_health_preflight_started", operationId, {
      trigger
    });
    while (this.bootHealth.now() < deadline) {
      let healthy = false;
      try {
        healthy = await this.desktopSessions.health(this.baseUrl);
      } catch {
        healthy = false;
      }
      if (healthy) {
        desktopSessionDiagnostics.record("desktop_health_preflight_completed", operationId, {
          trigger
        });
        return;
      }
      const remaining = deadline - this.bootHealth.now();
      if (remaining <= 0) break;
      const configuredDelay = this.bootHealth.backoffMs[
        Math.min(attempt, this.bootHealth.backoffMs.length - 1)
      ] ?? remaining;
      const delay = Math.min(configuredDelay, remaining);
      if (delay <= 0) break;
      attempt += 1;
      await this.wait(delay, new AbortController().signal);
    }
    desktopSessionDiagnostics.record("desktop_health_preflight_exhausted", operationId, {
      trigger
    });
    throw new DesktopSessionBridgeError("network");
  }

  async recoverSessionAfterNetwork(): Promise<DesktopNetworkRecoveryResult> {
    if (this.recoveryFlight) return this.recoveryFlight;
    if (this.logoutInProgress || this.authState !== "recoverable" || this.getActiveSession()) {
      return "skipped";
    }
    const attempt = (async (): Promise<DesktopNetworkRecoveryResult> => {
      let credentialPresent = false;
      try { credentialPresent = await this.desktopSessions.hasCredential(); }
      catch { return "offline"; }
      if (!credentialPresent) {
        this.setAuthenticationState("authentication_required");
        return "signed_out";
      }
      if (this.logoutInProgress || this.authState !== "recoverable" || this.getActiveSession()) {
        return "skipped";
      }
      try {
        await this.refreshSession("network_recovered");
        return this.getActiveSession() ? "restored" : "signed_out";
      } catch (error) {
        return error instanceof DesktopSessionBridgeError && error.kind === "network"
          ? "offline"
          : "signed_out";
      }
    })();
    const trackedAttempt = attempt.finally(() => {
      if (this.recoveryFlight === trackedAttempt) this.recoveryFlight = undefined;
    });
    this.recoveryFlight = trackedAttempt;
    return trackedAttempt;
  }

  async authenticatedFetch(url: string, init: RequestInit = {}, optional = false) {
    let session = this.getActiveSession();
    if (!session && !optional) {
      try { session = await this.refreshSession("authenticated_request_missing_session"); }
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
    try { refreshed = await this.refreshSession("authenticated_request_401"); }
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

  async signOut(reason: DesktopLogoutReason = "user_logout") {
    const operationId = desktopSessionDiagnostics.operationId();
    desktopSessionDiagnostics.record("desktop_logout_started", operationId, { logoutReason: reason });
    this.activeSignIn?.abort();
    this.logoutInProgress = true;
    try {
      await this.desktopSessions.logout(this.baseUrl);
      desktopSessionDiagnostics.record("desktop_logout_completed", operationId, { logoutReason: reason });
    } catch {
      desktopSessionDiagnostics.record("desktop_logout_failed", operationId, { logoutReason: reason });
      // Local Rust command deletes before its best-effort server request.
    }
    try { await this.store.clearAuthenticatedSteamIdentity(); }
    finally {
      this.clearActiveSession();
      this.setAuthenticationState("authentication_required");
      this.logoutInProgress = false;
    }
  }

  async signIn(signal: AbortSignal): Promise<SteamOpenIdSignInResult> {
    const authOperationId = desktopSessionDiagnostics.operationId();
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
        const final = await this.handleStatus(status, authOperationId);
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
    status: SteamOpenIdStatus,
    authOperationId: string
  ): Promise<SteamOpenIdSignInResult | undefined> {
    if (status.status === "pending") return undefined;
    if (status.status === "verified") {
      const identity: SteamOpenIdIdentity = {
        steamId: status.steamId,
        authenticatedAt: status.authenticatedAt,
        authMethod: "steam_openid"
      };
      await this.desktopSessions.store(status.refreshCredential, {
        bootId: desktopSessionDiagnostics.bootId,
        authOperationId,
        trigger: "other"
      });
      try { await this.store.saveIdentity(identity); }
      catch (error) {
        await this.desktopSessions.logout(this.baseUrl).catch(() => undefined);
        throw error;
      }
      this.activeSession = {
        token: status.sessionToken,
        expiresAt: status.sessionExpiresAt
      };
      this.setAuthenticationState("authenticated");
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


  private setAuthenticationState(state: DesktopAuthenticationState) {
    if (this.authState === state) return;
    this.authState = state;
    for (const listener of this.authStateListeners) listener(state);
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
