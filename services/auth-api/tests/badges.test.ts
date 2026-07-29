import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryBadgeRepository } from "../src/badges/badgeRepository.ts";
import { BadgeService, parseBadgeListQuery } from "../src/badges/badgeService.ts";
import {
  MAX_BADGE_ASSET_BYTES,
  MemoryBadgeAssetStorage,
  validateBadgeAsset
} from "../src/badges/badgeAssetStorage.ts";

const draft = {
  slug: "bug-hunter",
  displayName: "Bug Hunter",
  description: "Reported a verified issue.",
  category: "community",
  rarity: "rare",
  priority: 50,
  isActive: true,
  isVisible: true,
  grantMode: "manual"
};

test("badge definitions create, filter, update, reactivate, and archive", async () => {
  const repository = new InMemoryBadgeRepository();
  const service = new BadgeService(repository);
  const badge = await service.create(draft, "actor");
  assert.equal((await service.list(parseBadgeListQuery(new URLSearchParams("search=bug")))).total, 1);
  const inactive = await service.update(badge.id, { ...draft, isActive: false }, "actor");
  assert.equal(inactive.isActive, false);
  await service.update(badge.id, { ...draft, isActive: true }, "actor");
  assert.equal(repository.auditEvents.at(-1)?.action, "badge.reactivated");
  const archived = await service.archive(badge.id, "actor");
  assert.ok(archived.archivedAt);
  await assert.rejects(service.update(badge.id, draft, "actor"), /BADGE_ARCHIVED/);
});

test("badge validation rejects unsafe slugs, dates, duplicate slugs, and unlisted sorting", async () => {
  const service = new BadgeService(new InMemoryBadgeRepository());
  assert.throws(() => service.create({ ...draft, slug: "../owner" }, "actor"), /INVALID_BADGE_SLUG/);
  assert.throws(() => service.create({ ...draft, startsAt: "2026-08-01", endsAt: "2026-07-01" }, "actor"), /INVALID_BADGE_DATES/);
  await service.create(draft, "actor");
  await assert.rejects(service.create(draft, "actor"), /badge_slug_conflict/);
  assert.throws(() => parseBadgeListQuery(new URLSearchParams("sort=DROP TABLE")), /INVALID_BADGE/);
});

test("asset validation uses magic bytes, MIME, size and dimensions", async () => {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.write("IHDR", 12, "ascii");
  png.writeUInt32BE(64, 16);
  png.writeUInt32BE(64, 20);
  const validated = validateBadgeAsset(png, "image/png");
  assert.equal(validated.isSquare, true);
  assert.throws(() => validateBadgeAsset(png, "image/webp"), /ASSET_MIME_MISMATCH/);
  assert.throws(() => validateBadgeAsset(Buffer.alloc(MAX_BADGE_ASSET_BYTES + 1), "image/png"), /INVALID_ASSET_SIZE/);
  const storage = new MemoryBadgeAssetStorage();
  const key = await storage.upload(validated);
  assert.match(key, /^[0-9a-f-]{36}\.png$/);
  assert.deepEqual(await storage.read(key), png);
});

test("asset deletion is soft, audited, and rejects an asset referenced by a badge", async () => {
  const repository = new InMemoryBadgeRepository();
  const asset = await repository.saveAsset({
    storageKey: "00000000-0000-4000-8000-000000000000.png",
    contentType: "image/png", byteSize: 24, width: 64, height: 64, isSquare: true
  }, "actor");
  const service = new BadgeService(repository);
  await service.create({ ...draft, iconAssetId: asset.id }, "actor");
  await assert.rejects(repository.deleteUnusedAsset(asset.id, "actor"), /badge_asset_in_use/);
  const unused = await repository.saveAsset({
    storageKey: "00000000-0000-4000-8000-000000000001.png",
    contentType: "image/png", byteSize: 24, width: 64, height: 64, isSquare: true
  }, "actor");
  assert.equal(await repository.deleteUnusedAsset(unused.id, "actor"), unused.storageKey);
  assert.equal(repository.auditEvents.at(-1)?.action, "badge.asset_deleted");
});
