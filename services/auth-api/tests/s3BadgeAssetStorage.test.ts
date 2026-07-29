import assert from "node:assert/strict";
import test from "node:test";
import type { S3BadgeStorageConfig } from "../src/config.ts";
import {
  BadgeAssetNotFoundError,
  type ValidatedBadgeAsset
} from "../src/badges/badgeAssetStorage.ts";
import {
  S3BadgeAssetStorage,
  type S3CommandClient
} from "../src/badges/s3BadgeAssetStorage.ts";

const config: S3BadgeStorageConfig = {
  endpoint: "https://objects.example.test",
  region: "eu-west-1",
  bucket: "achievement-nexus-staging",
  accessKeyId: "access-key-must-not-leak",
  secretAccessKey: "secret-key-must-not-leak",
  publicBaseUrl: "https://cdn.example.test",
  keyPrefix: "tenant-a/badges/staging"
};

const asset: ValidatedBadgeAsset = {
  contentType: "image/png",
  bytes: Buffer.from("safe-image"),
  width: 64,
  height: 64,
  isSquare: true
};

class FakeClient implements S3CommandClient {
  readonly commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  private readonly responder: (name: string) => unknown;
  constructor(responder: (name: string) => unknown = () => ({})) {
    this.responder = responder;
  }
  async send(command: unknown) {
    const candidate = command as {
      constructor: { name: string };
      input: Record<string, unknown>;
    };
    this.commands.push({ name: candidate.constructor.name, input: candidate.input });
    return this.responder(candidate.constructor.name);
  }
}

test("S3 upload uses a server UUID key and immutable public object metadata", async () => {
  const client = new FakeClient();
  const storage = new S3BadgeAssetStorage(config, client);
  const key = await storage.upload(asset);
  assert.match(key, /^tenant-a\/badges\/staging\/[0-9a-f-]{36}\.png$/);
  const put = client.commands[0];
  assert.equal(put.name, "PutObjectCommand");
  assert.equal(put.input.Bucket, config.bucket);
  assert.equal(put.input.Key, key);
  assert.equal(put.input.ContentType, "image/png");
  assert.equal(put.input.IfNoneMatch, "*");
  assert.match(String(put.input.CacheControl), /immutable/);
  assert.equal(String(put.input.Key).includes("safe-image"), false);
});

test("S3 failures propagate without leaking configured credentials", async () => {
  const client: S3CommandClient = {
    async send() {
      throw new Error("storage unavailable");
    }
  };
  const storage = new S3BadgeAssetStorage(config, client);
  await assert.rejects(
    storage.upload(asset),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return !message.includes(config.accessKeyId) &&
        !message.includes(config.secretAccessKey);
    }
  );
});

test("S3 read, missing-object detection, existence and delete are bounded to the prefix", async () => {
  const key = "tenant-a/badges/staging/00000000-0000-4000-8000-000000000001.webp";
  const client = new FakeClient((name) => {
    if (name === "GetObjectCommand") {
      return { Body: { async transformToByteArray() { return Uint8Array.from([1, 2]); } } };
    }
    return {};
  });
  const storage = new S3BadgeAssetStorage(config, client);
  assert.deepEqual(await storage.read(key), Buffer.from([1, 2]));
  assert.equal(await storage.exists(key), true);
  await storage.delete(key);
  assert.deepEqual(
    client.commands.map((command) => command.name),
    ["GetObjectCommand", "HeadObjectCommand", "DeleteObjectCommand"]
  );
  await assert.rejects(storage.read("../outside.png"), /INVALID_ASSET_KEY/);
});

test("S3 missing objects return an explicit not-found result and a stable encoded URL", async () => {
  const key = "tenant-a/badges/staging/00000000-0000-4000-8000-000000000002.png";
  const missing = Object.assign(new Error("missing"), {
    name: "NoSuchKey",
    $metadata: { httpStatusCode: 404 }
  });
  const storage = new S3BadgeAssetStorage(config, {
    async send() { throw missing; }
  });
  await assert.rejects(
    storage.read(key),
    (error: unknown) => error instanceof BadgeAssetNotFoundError
  );
  assert.equal(await storage.exists(key), false);
  assert.equal(
    storage.publicUrl(key),
    "https://cdn.example.test/tenant-a/badges/staging/00000000-0000-4000-8000-000000000002.png"
  );
});

test("S3 treats legacy local metadata as missing without accepting arbitrary keys", async () => {
  const client = new FakeClient();
  const storage = new S3BadgeAssetStorage(config, client);
  const legacyKey = "00000000-0000-4000-8000-000000000006.png";
  assert.equal(await storage.exists(legacyKey), false);
  await assert.rejects(
    storage.read(legacyKey),
    (error: unknown) => error instanceof BadgeAssetNotFoundError
  );
  await storage.delete(legacyKey);
  assert.equal(storage.publicUrl(legacyKey), undefined);
  assert.equal(client.commands.length, 0);
  await assert.rejects(storage.exists("../outside.png"), /INVALID_ASSET_KEY/);
});
