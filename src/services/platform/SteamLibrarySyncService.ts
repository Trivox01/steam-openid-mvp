import type { SteamLibrarySyncResult } from "../../types";
import type { GameRepository, SyncMetadataRepository } from "../../repositories/contracts";
import { SteamIntegrationError } from "../../integrations/steam/TauriSteamGateway";
import type { SteamProvider } from "./SteamProvider";
import { mergeSteamLibrary } from "./SteamLibraryMerge";
export { mergeSteamLibrary } from "./SteamLibraryMerge";

export class SteamLibrarySyncError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SteamLibrarySyncError";
  }
}

export class SteamLibrarySyncService {
  private activeSync?: Promise<SteamLibrarySyncResult>;

  constructor(
    private provider: SteamProvider,
    private games: GameRepository,
    private metadata: SyncMetadataRepository
  ) {}

  sync() {
    if (this.activeSync) return this.activeSync;
    const operation = this.performSync().finally(() => {
      if (this.activeSync === operation) this.activeSync = undefined;
    });
    this.activeSync = operation;
    return operation;
  }

  getLastSync() {
    return this.metadata.getSyncMetadata("steam");
  }

  private async performSync(): Promise<SteamLibrarySyncResult> {
    try {
      const [remote, local] = await Promise.all([
        this.provider.getOwnedGamesWithMetadata(),
        this.games.getAllGames()
      ]);
      const syncedAt = new Date().toISOString();
      const merged = mergeSteamLibrary(local, remote, syncedAt);
      if (merged.changedGames.length) await this.games.saveGames(merged.changedGames);
      if (import.meta.env.DEV) {
        console.info("[steam-library] merged_into_sqlite", {
          fetched: remote.fetched,
          inserted: merged.inserted,
          updated: merged.updated,
          unchanged: merged.unchanged,
          skipped: remote.skipped + merged.skipped
        });
      }
      await this.metadata.saveSyncMetadata({ source: "steam", status: "success", lastSyncedAt: syncedAt });
      return {
        fetched: remote.fetched,
        inserted: merged.inserted,
        updated: merged.updated,
        unchanged: merged.unchanged,
        skipped: remote.skipped + merged.skipped,
        failed: 0,
        syncedAt,
        warnings: remote.warnings
      };
    } catch (error) {
      const previous = await this.metadata.getSyncMetadata("steam").catch(() => undefined);
      await this.metadata.saveSyncMetadata({
        source: "steam",
        status: "error",
        lastSyncedAt: previous?.lastSyncedAt
      }).catch(() => undefined);
      throw new SteamLibrarySyncError(
        error instanceof SteamIntegrationError ? error.code : "storage_error"
      );
    }
  }
}
