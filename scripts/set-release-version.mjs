import fs from "node:fs";
import path from "node:path";
import { assertReleaseVersion, readReleaseVersion, root } from "./release/versioning.mjs";

const nextVersion = process.argv[2];
if (!nextVersion) throw new Error("Usage: npm run release:set-version -- <semver>");
const release = readReleaseVersion();
assertReleaseVersion(nextVersion, release.channel);

const packagePath = path.join(root, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
packageJson.version = nextVersion;
fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

for (const relative of ["release/version.json", "src-tauri/tauri.conf.json"]) {
  const target = path.join(root, relative);
  const json = JSON.parse(fs.readFileSync(target, "utf8"));
  json.version = nextVersion;
  fs.writeFileSync(target, `${JSON.stringify(json, null, 2)}\n`);
}
const cargoPath = path.join(root, "src-tauri/Cargo.toml");
const cargo = fs.readFileSync(cargoPath, "utf8").replace(/^version\s*=\s*"[^"]+"/m, `version = "${nextVersion}"`);
fs.writeFileSync(cargoPath, cargo);
console.log(`Synchronized release version to ${nextVersion}. Review and commit the change.`);
