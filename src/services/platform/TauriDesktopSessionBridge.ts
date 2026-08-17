import { invoke } from "@tauri-apps/api/core";
import type { SteamBackendSession } from "../../types/steamOpenId";
import {
  desktopSessionDiagnostics,
  type DesktopRefreshTrigger
} from "./DesktopSessionDiagnostics.ts";

export interface DesktopSessionDiagnosticContext {
  bootId: string;
  authOperationId: string;
  trigger: DesktopRefreshTrigger;
}

export type DesktopSessionBridgeErrorKind =
  | "none"
  | "network"
  | "invalid"
  | "account_not_active"
  | "secure_storage"
  | "server";

export class DesktopSessionBridgeError extends Error {
  readonly kind: DesktopSessionBridgeErrorKind;
  constructor(kind: DesktopSessionBridgeErrorKind) {
    super(kind);
    this.kind = kind;
    this.name = "DesktopSessionBridgeError";
  }
}

export interface DesktopSessionBridge {
  store(credential: string, context?: DesktopSessionDiagnosticContext): Promise<void>;
  hasCredential(): Promise<boolean>;
  health(baseUrl: string): Promise<boolean>;
  refresh(baseUrl: string, context?: DesktopSessionDiagnosticContext): Promise<SteamBackendSession>;
  logout(baseUrl: string): Promise<void>;
}

export class TauriDesktopSessionBridge implements DesktopSessionBridge {
  async store(credential: string, context?: DesktopSessionDiagnosticContext) {
    const operationId = context?.authOperationId ?? desktopSessionDiagnostics.operationId();
    const trigger = context?.trigger ?? "other";
    desktopSessionDiagnostics.record("desktop_credential_write_started", operationId, { trigger });
    try {
      await invoke("store_desktop_session_credential", { credential });
      desktopSessionDiagnostics.record("desktop_credential_write_succeeded", operationId, { trigger });
    } catch (error) {
      desktopSessionDiagnostics.record("desktop_credential_write_failed", operationId, { trigger });
      throw bridgeError(error);
    }
  }

  async hasCredential() {
    try { return await invoke<boolean>("has_desktop_session_credential"); }
    catch (error) { throw bridgeError(error); }
  }

  async health(baseUrl: string) {
    try {
      return await invoke<boolean>("probe_desktop_session_backend_health", { baseUrl });
    } catch {
      return false;
    }
  }

  async refresh(baseUrl: string, context?: DesktopSessionDiagnosticContext) {
    try {
      const value = await invoke<unknown>("restore_desktop_session", { baseUrl, diagnostic: context });
      if (!isRecord(value) || typeof value.sessionToken !== "string" ||
          typeof value.sessionExpiresAt !== "string" ||
          !Number.isFinite(Date.parse(value.sessionExpiresAt))) {
        throw new DesktopSessionBridgeError("server");
      }
      return { token: value.sessionToken, expiresAt: value.sessionExpiresAt };
    } catch (error) {
      if (error instanceof DesktopSessionBridgeError) throw error;
      throw bridgeError(error);
    }
  }

  async logout(baseUrl: string) {
    try { await invoke("logout_desktop_session", { baseUrl }); }
    catch (error) { throw bridgeError(error); }
  }
}

function bridgeError(error: unknown) {
  const value = String(error).toLowerCase();
  if (value.includes("no_credential")) return new DesktopSessionBridgeError("none");
  if (value.includes("network")) return new DesktopSessionBridgeError("network");
  if (value.includes("account_not_active")) return new DesktopSessionBridgeError("account_not_active");
  if (value.includes("secure_storage")) return new DesktopSessionBridgeError("secure_storage");
  if (value.includes("invalid")) return new DesktopSessionBridgeError("invalid");
  return new DesktopSessionBridgeError("server");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
