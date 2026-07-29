import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BadgeError } from "./contracts.ts";

export const MAX_BADGE_ASSET_BYTES = 2 * 1024 * 1024;

export interface ValidatedBadgeAsset {
  contentType: "image/png" | "image/webp";
  bytes: Buffer;
  width: number;
  height: number;
  isSquare: boolean;
}

export interface BadgeAssetStorage {
  upload(asset: ValidatedBadgeAsset): Promise<string>;
  read(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
}

export class LocalBadgeAssetStorage implements BadgeAssetStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async upload(asset: ValidatedBadgeAsset) {
    await mkdir(this.root, { recursive: true });
    const extension = asset.contentType === "image/png" ? "png" : "webp";
    const storageKey = `${randomUUID()}.${extension}`;
    await writeFile(join(this.root, storageKey), asset.bytes, { flag: "wx" });
    return storageKey;
  }

  read(storageKey: string) {
    assertStorageKey(storageKey);
    return readFile(join(this.root, storageKey));
  }

  async delete(storageKey: string) {
    assertStorageKey(storageKey);
    await unlink(join(this.root, storageKey));
  }
}

export class MemoryBadgeAssetStorage implements BadgeAssetStorage {
  readonly files = new Map<string, Buffer>();
  async upload(asset: ValidatedBadgeAsset) {
    const key = `${randomUUID()}.${asset.contentType === "image/png" ? "png" : "webp"}`;
    this.files.set(key, Buffer.from(asset.bytes));
    return key;
  }
  async read(key: string) {
    const value = this.files.get(key);
    if (!value) throw new Error("asset_not_found");
    return Buffer.from(value);
  }
  async delete(key: string) { this.files.delete(key); }
}

export function validateBadgeAsset(
  bytes: Buffer,
  declaredContentType: string | undefined
): ValidatedBadgeAsset {
  if (!bytes.length || bytes.length > MAX_BADGE_ASSET_BYTES) {
    throw new BadgeError("INVALID_ASSET_SIZE");
  }
  const png = parsePng(bytes);
  const webp = png ? undefined : parseWebp(bytes);
  const parsed = png ?? webp;
  if (!parsed) throw new BadgeError("INVALID_ASSET_FORMAT");
  if (declaredContentType !== parsed.contentType) {
    throw new BadgeError("ASSET_MIME_MISMATCH");
  }
  if (
    parsed.width < 16 || parsed.height < 16 ||
    parsed.width > 2048 || parsed.height > 2048
  ) throw new BadgeError("INVALID_ASSET_DIMENSIONS");
  return { ...parsed, bytes, isSquare: parsed.width === parsed.height };
}

function parsePng(bytes: Buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return undefined;
  if (bytes.toString("ascii", 12, 16) !== "IHDR") return undefined;
  return {
    contentType: "image/png" as const,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

function parseWebp(bytes: Buffer) {
  if (
    bytes.length < 30 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP"
  ) return undefined;
  const format = bytes.toString("ascii", 12, 16);
  if (format === "VP8X") {
    return {
      contentType: "image/webp" as const,
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3)
    };
  }
  if (format === "VP8L" && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return {
      contentType: "image/webp" as const,
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1
    };
  }
  return undefined;
}

function assertStorageKey(value: string) {
  if (!/^[0-9a-f-]{36}\.(png|webp)$/.test(value)) {
    throw new BadgeError("INVALID_ASSET_KEY");
  }
}
