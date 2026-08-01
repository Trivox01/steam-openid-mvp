import fs from "node:fs";
import path from "node:path";
import { readReleaseVersion, root } from "./versioning.mjs";

const publicKey = process.env.TAURI_UPDATER_PUBLIC_KEY?.trim();
const endpoint = process.env.TAURI_UPDATER_ENDPOINT?.trim();
if (!publicKey) throw new Error("TAURI_UPDATER_PUBLIC_KEY is required");
if (!endpoint?.startsWith("https://")) throw new Error("TAURI_UPDATER_ENDPOINT must be an HTTPS URL");
const release = readReleaseVersion();
if (release.channel !== "beta") throw new Error("Only beta updater configuration is accepted in Phase 5.1");
const config = {
  plugins: { updater: { pubkey: publicKey, endpoints: [endpoint], windows: { installMode: "passive" } } }
};
fs.writeFileSync(path.join(root, "src-tauri/tauri.release.conf.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
console.log("Generated trusted-runner updater configuration (public key only).");
