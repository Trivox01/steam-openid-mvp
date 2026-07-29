import type { AuthApiConfig } from "../config.ts";
import {
  LocalBadgeAssetStorage,
  MemoryBadgeAssetStorage,
  type BadgeAssetStorage
} from "./badgeAssetStorage.ts";
import { S3BadgeAssetStorage } from "./s3BadgeAssetStorage.ts";

export function createBadgeAssetStorage(config: AuthApiConfig): BadgeAssetStorage {
  const driver = config.badgeStorageDriver ??
    (config.nodeEnv === "test" ? "memory" : "local");
  if (driver === "memory") return new MemoryBadgeAssetStorage();
  if (driver === "local") {
    return new LocalBadgeAssetStorage(
      config.badgeAssetDirectory ?? "./var/badge-assets"
    );
  }
  if (!config.s3BadgeStorage) throw new Error("invalid_badge_storage_configuration");
  return new S3BadgeAssetStorage(config.s3BadgeStorage);
}
