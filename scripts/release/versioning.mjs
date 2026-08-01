import fs from "node:fs";
import path from "node:path";

export const root = path.resolve(import.meta.dirname, "../..");
export const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function readReleaseVersion() {
  return JSON.parse(fs.readFileSync(path.join(root, "release/version.json"), "utf8"));
}

export function readProjectVersions() {
  const packageVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  const tauriVersion = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8")).version;
  const cargo = fs.readFileSync(path.join(root, "src-tauri/Cargo.toml"), "utf8");
  const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  return { packageVersion, tauriVersion, cargoVersion };
}

export function assertReleaseVersion(version, channel) {
  if (!semverPattern.test(version)) throw new Error(`Invalid SemVer: ${version}`);
  if (!["development", "staging", "beta", "stable"].includes(channel)) throw new Error(`Invalid channel: ${channel}`);
  if (channel === "beta" && !/-beta\.\d+$/.test(version)) throw new Error("Beta versions must end with -beta.N");
  if (channel === "stable" && version.includes("-")) throw new Error("Stable versions cannot be prereleases");
}

export function assertTag(version, tag) {
  if (tag !== `v${version}`) throw new Error(`Tag ${tag} does not match v${version}`);
}
