import type { BadgeRepository } from "./badgeRepository.ts";
import type {
  BadgeAssetStorage,
  ValidatedBadgeAsset
} from "./badgeAssetStorage.ts";

export async function persistBadgeAsset(
  repository: BadgeRepository,
  storage: BadgeAssetStorage,
  asset: ValidatedBadgeAsset,
  actorUserId: string
) {
  const storageKey = await storage.upload(asset);
  try {
    return await repository.saveAsset({
      storageKey,
      contentType: asset.contentType,
      byteSize: asset.bytes.length,
      width: asset.width,
      height: asset.height,
      isSquare: asset.isSquare
    }, actorUserId);
  } catch (error) {
    await storage.delete(storageKey).catch(async () => {
      await repository.enqueueAssetCleanup({
        storageKey,
        reason: "metadata_rollback"
      }).catch(() => undefined);
    });
    throw error;
  }
}

export async function removeUnusedBadgeAsset(
  repository: BadgeRepository,
  storage: BadgeAssetStorage,
  assetId: string,
  actorUserId: string,
  reason: "icon_replaced" | "asset_deleted"
) {
  const storageKey = await repository.deleteUnusedAsset(assetId, actorUserId);
  if (!storageKey) return false;
  await storage.delete(storageKey).catch(async () => {
    await repository.enqueueAssetCleanup({ storageKey, assetId, reason });
  });
  return true;
}
