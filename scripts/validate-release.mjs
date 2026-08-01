import fs from "node:fs";
import path from "node:path";
import { assertReleaseVersion, assertTag, readProjectVersions, readReleaseVersion, root } from "./release/versioning.mjs";

const release = readReleaseVersion();
assertReleaseVersion(release.version, release.channel);
const versions = readProjectVersions();
for (const [source, version] of Object.entries(versions)) {
  if (version !== release.version) throw new Error(`${source} (${version}) differs from release/version.json (${release.version})`);
}
const channels = JSON.parse(fs.readFileSync(path.join(root, "release/channels.json"), "utf8"));
if (channels.active !== release.channel) throw new Error("Active channel differs from release/version.json");
const enabled = Object.entries(channels.channels).filter(([, value]) => value.enabled).map(([name]) => name);
if (enabled.length !== 1 || enabled[0] !== "beta") throw new Error("Phase 5.1 permits the beta channel only");
if (process.env.RELEASE_TAG) assertTag(release.version, process.env.RELEASE_TAG);
console.log(`Release metadata valid: ${release.version} (${release.channel})`);
