import type { AuthApiConfig, S3BadgeStorageConfig } from "../config.ts";
import { createBadgeAssetStorage } from "../badges/badgeAssetStorageFactory.ts";
import type { BadgeAssetStorage, ValidatedBadgeAsset } from "../badges/badgeAssetStorage.ts";
import { S3BadgeAssetStorage } from "../badges/s3BadgeAssetStorage.ts";

export type ToolAssetKind = "icon" | "cover";
export interface ToolAssetStorages { icon: BadgeAssetStorage; cover: BadgeAssetStorage; routed: BadgeAssetStorage }

export function createToolAssetStorages(config: AuthApiConfig): ToolAssetStorages {
  if (config.badgeStorageDriver !== "s3" || !config.s3BadgeStorage) {
    const shared = createBadgeAssetStorage(config);
    return { icon: shared, cover: shared, routed: shared };
  }
  const icon = new S3BadgeAssetStorage(toolStorageConfig(config.s3BadgeStorage, "icons"));
  const cover = new S3BadgeAssetStorage(toolStorageConfig(config.s3BadgeStorage, "covers"));
  return { icon, cover, routed: new RoutedStorage(icon, cover) };
}

export function toolStorageConfig(config: S3BadgeStorageConfig, kind: "icons" | "covers"): S3BadgeStorageConfig {
  const match = config.keyPrefix.match(/^(.*?)(?:badges)\/(development|test|staging|production)$/);
  const base = match?.[1] ?? "";
  const environment = match?.[2] ?? "production";
  return { ...config, keyPrefix: `${base}tools/${environment}/${kind}` };
}

class RoutedStorage implements BadgeAssetStorage {
  private readonly icon: BadgeAssetStorage;
  private readonly cover: BadgeAssetStorage;
  constructor(icon: BadgeAssetStorage, cover: BadgeAssetStorage) { this.icon = icon; this.cover = cover; }
  upload(_asset: ValidatedBadgeAsset): Promise<string> { throw new Error("tool_asset_kind_required"); }
  read(key: string) { return this.forKey(key).read(key); }
  delete(key: string) { return this.forKey(key).delete(key); }
  exists(key: string) { return this.forKey(key).exists(key); }
  publicUrl(key: string) { return this.forKey(key).publicUrl(key); }
  private forKey(key: string) { return key.includes("/covers/") ? this.cover : this.icon; }
}
