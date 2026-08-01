import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildManifest, compareVersions, discoverArtifacts, parseConfig } from "../scripts/publish-beta-release.mjs";

const environment = {
  R2_RELEASES_ENDPOINT: "https://account.r2.cloudflarestorage.com",
  R2_RELEASES_REGION: "auto",
  R2_RELEASES_BUCKET: "nexus-assets",
  R2_RELEASES_ACCESS_KEY_ID: "access",
  R2_RELEASES_SECRET_ACCESS_KEY: "secret",
  R2_RELEASES_PUBLIC_BASE_URL: "https://updates.example.test",
  TAURI_UPDATER_ENDPOINT: "https://updates.example.test/releases/beta/latest.json",
  RELEASE_TAG: "v0.1.0-beta.2"
};

test("release configuration requires an exact credential-free HTTPS Beta endpoint", () => {
  assert.equal(parseConfig(environment).version, "0.1.0-beta.2");
  assert.throws(() => parseConfig({ ...environment, TAURI_UPDATER_ENDPOINT: "https://updates.example.test/other/latest.json" }), /mismatch/);
  assert.throws(() => parseConfig({ ...environment, R2_RELEASES_PUBLIC_BASE_URL: "https://user:pass@updates.example.test" }), /invalid/);
});

test("Beta ordering refuses equal, older, and cross-line ambiguity", () => {
  assert.equal(compareVersions("0.1.0-beta.2", "0.1.0-beta.1"), 1);
  assert.equal(compareVersions("0.1.0-beta.1", "0.1.0-beta.1"), 0);
  assert.equal(compareVersions("0.1.0-beta.1", "0.1.0-beta.2"), -1);
  assert.throws(() => compareVersions("stable", "0.1.0-beta.1"));
});

test("artifact discovery fails closed when a signed updater file is absent", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-release-"));
  for (const name of ["Achievement.Nexus_0.1.0-beta.2_x64-setup.exe", "Achievement.Nexus_0.1.0-beta.2_x64-setup.nsis.zip", "SHA256SUMS.txt"]) fs.writeFileSync(path.join(directory, name), "test");
  assert.throws(() => discoverArtifacts(directory), /signature/);
  fs.writeFileSync(path.join(directory, "Achievement.Nexus_0.1.0-beta.2_x64-setup.nsis.zip.sig"), "signature");
  assert.match(discoverArtifacts(directory).archive, /\.nsis\.zip$/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("manifest uses the Tauri Windows target and rejects raw HTML notes", () => {
  const signature = Buffer.from(`untrusted comment: signature\n${"R".repeat(64)}`).toString("base64");
  const manifest = buildManifest({ version: "0.1.0-beta.2", notes: "Beta notes", pubDate: "2026-08-02T00:00:00Z", archiveUrl: "https://updates.example.test/releases/beta/windows-x86_64/0.1.0-beta.2/update.nsis.zip", signature });
  assert.equal(manifest.platforms["windows-x86_64"].signature, signature);
  assert.throws(() => buildManifest({ version: "0.1.0-beta.2", notes: "<b>unsafe</b>", pubDate: new Date(), archiveUrl: "https://updates.example.test/update.zip", signature }));
});
