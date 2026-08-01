import fs from "node:fs";
import path from "node:path";
import { readReleaseVersion, root } from "./versioning.mjs";

const publicKey = process.env.TAURI_UPDATER_PUBLIC_KEY?.trim();
const endpoint = process.env.TAURI_UPDATER_ENDPOINT?.trim();
if (!publicKey) throw new Error("TAURI_UPDATER_PUBLIC_KEY is required");
try {
  const decoded = Buffer.from(publicKey, "base64").toString("utf8");
  if (!decoded.includes("untrusted comment:") || !/^RW[A-Za-z0-9+/=]{40,}$/m.test(decoded)) throw new Error();
} catch { throw new Error("TAURI_UPDATER_PUBLIC_KEY is not a valid Tauri updater public key"); }
let endpointUrl;
try { endpointUrl = new URL(endpoint); } catch { throw new Error("TAURI_UPDATER_ENDPOINT must be a valid URL"); }
if (endpointUrl.protocol !== "https:" || endpointUrl.username || endpointUrl.password || endpointUrl.search || endpointUrl.hash) throw new Error("TAURI_UPDATER_ENDPOINT must be credential-free HTTPS");
if (!endpointUrl.pathname.endsWith("/releases/beta/latest.json")) throw new Error("TAURI_UPDATER_ENDPOINT must target /releases/beta/latest.json");
const release = readReleaseVersion();
if (release.channel !== "beta") throw new Error("Only beta updater configuration is accepted in Phase 5.1");
const config = {
  app: { security: { csp: addConnectOrigin(JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8")).app.security.csp, endpointUrl.origin) } },
  plugins: { updater: { pubkey: publicKey, endpoints: [endpointUrl.toString()], windows: { installMode: "passive" } } }
};
fs.writeFileSync(path.join(root, "src-tauri/tauri.release.conf.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
console.log("Generated trusted-runner updater configuration (public key only).");

function addConnectOrigin(csp, origin) {
  const directives = csp.split(";").map((part) => part.trim()).filter(Boolean);
  const index = directives.findIndex((part) => part.startsWith("connect-src "));
  if (index < 0) throw new Error("Base CSP has no connect-src directive");
  const values = directives[index].split(/\s+/);
  if (!values.includes(origin)) values.push(origin);
  directives[index] = values.join(" ");
  return `${directives.join("; ")};`;
}
