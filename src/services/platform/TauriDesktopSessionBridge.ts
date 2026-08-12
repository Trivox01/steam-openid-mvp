import { invoke } from "@tauri-apps/api/core";
import type { SteamBackendSession } from "../../types/steamOpenId";

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
  store(credential: string): Promise<void>;
  refresh(baseUrl: string): Promise<SteamBackendSession>;
  logout(baseUrl: string): Promise<void>;
}

export class TauriDesktopSessionBridge implements DesktopSessionBridge {
  async store(credential: string) {
    try { await invoke("store_desktop_session_credential", { credential }); }
    catch (error) { throw bridgeError(error); }
  }

  async refresh(baseUrl: string) {
    try {
      const value = await invoke<unknown>("restore_desktop_session", { baseUrl });
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
