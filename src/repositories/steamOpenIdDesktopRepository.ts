import { invoke } from "@tauri-apps/api/core";
import type {
  SteamOpenIdDesktopState,
  SteamOpenIdIdentity
} from "../types/steamOpenId";

export class SteamOpenIdDesktopRepository {
  async getState(): Promise<SteamOpenIdDesktopState> {
    const stored = await invoke<unknown | null>("get_steam_openid_desktop_state");
    const state = normalizeState(stored);
    if (state) return state;
    const created = { deviceId: crypto.randomUUID() };
    await this.save(created);
    return created;
  }

  async saveIdentity(identity: SteamOpenIdIdentity) {
    const state = await this.getState();
    await this.save({ deviceId: state.deviceId, identity });
  }

  async clearIdentity() {
    const state = await this.getState();
    await this.save({ deviceId: state.deviceId });
  }

  private save(value: SteamOpenIdDesktopState) {
    return invoke<void>("save_steam_openid_desktop_state", { value });
  }
}

function normalizeState(value: unknown): SteamOpenIdDesktopState | undefined {
  if (
    !isRecord(value) ||
    typeof value.deviceId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.deviceId)
  ) return undefined;
  const identity = isRecord(value.identity) &&
    /^\d{17}$/.test(String(value.identity.steamId)) &&
    typeof value.identity.authenticatedAt === "string" &&
    Number.isFinite(Date.parse(value.identity.authenticatedAt)) &&
    value.identity.authMethod === "steam_openid"
      ? value.identity as unknown as SteamOpenIdIdentity
      : undefined;
  return { deviceId: value.deviceId, ...(identity ? { identity } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
