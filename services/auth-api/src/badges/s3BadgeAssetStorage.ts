import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type { S3BadgeStorageConfig } from "../config.ts";
import {
  BadgeAssetNotFoundError,
  type BadgeAssetStorage,
  type ValidatedBadgeAsset
} from "./badgeAssetStorage.ts";
import { BadgeError } from "./contracts.ts";

const CACHE_CONTROL = "public, max-age=31536000, immutable";

export interface S3CommandClient {
  send(command: unknown): Promise<unknown>;
}

export class S3BadgeAssetStorage implements BadgeAssetStorage {
  private readonly client: S3CommandClient;
  private readonly config: S3BadgeStorageConfig;

  constructor(config: S3BadgeStorageConfig, client?: S3CommandClient) {
    this.config = config;
    this.client = client ?? new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      },
      forcePathStyle: true,
      maxAttempts: 2,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 3_000,
        requestTimeout: 10_000
      })
    });
  }

  async upload(asset: ValidatedBadgeAsset) {
    const extension = asset.contentType === "image/png" ? "png" : "webp";
    const key = `${this.config.keyPrefix}/${randomUUID()}.${extension}`;
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: asset.bytes,
      ContentType: asset.contentType,
      CacheControl: CACHE_CONTROL,
      ContentLength: asset.bytes.length,
      IfNoneMatch: "*"
    }));
    return key;
  }

  async read(storageKey: string) {
    assertObjectKey(storageKey, this.config.keyPrefix);
    try {
      const response = await this.client.send(new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: storageKey
      })) as { Body?: { transformToByteArray(): Promise<Uint8Array> } };
      if (!response.Body) throw new BadgeAssetNotFoundError();
      return Buffer.from(await response.Body.transformToByteArray());
    } catch (error) {
      if (isMissingObject(error)) throw new BadgeAssetNotFoundError();
      throw error;
    }
  }

  async delete(storageKey: string) {
    assertObjectKey(storageKey, this.config.keyPrefix);
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: storageKey
    }));
  }

  async exists(storageKey: string) {
    assertObjectKey(storageKey, this.config.keyPrefix);
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: storageKey
      }));
      return true;
    } catch (error) {
      if (isMissingObject(error)) return false;
      throw error;
    }
  }

  publicUrl(storageKey: string) {
    if (!this.config.publicBaseUrl) return undefined;
    assertObjectKey(storageKey, this.config.keyPrefix);
    return `${this.config.publicBaseUrl}/${storageKey
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
  }
}

export function assertObjectKey(value: string, prefix: string) {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`^${escapedPrefix}/[0-9a-f-]{36}\\.(png|webp)$`).test(value)) {
    throw new BadgeError("INVALID_ASSET_KEY");
  }
}

function isMissingObject(error: unknown) {
  if (error instanceof BadgeAssetNotFoundError) return true;
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.$metadata?.httpStatusCode === 404;
}
