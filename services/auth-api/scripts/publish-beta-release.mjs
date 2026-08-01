import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const prefix = "releases/beta";
export function parseConfig(env) {
  const required = ["R2_RELEASES_ENDPOINT","R2_RELEASES_REGION","R2_RELEASES_BUCKET","R2_RELEASES_ACCESS_KEY_ID","R2_RELEASES_SECRET_ACCESS_KEY","R2_RELEASES_PUBLIC_BASE_URL","TAURI_UPDATER_ENDPOINT","RELEASE_TAG"];
  for (const name of required) if (!env[name]?.trim()) throw new Error(`missing_${name}`);
  const endpoint = secureUrl(env.R2_RELEASES_ENDPOINT, "R2_RELEASES_ENDPOINT");
  const publicBase = secureUrl(env.R2_RELEASES_PUBLIC_BASE_URL, "R2_RELEASES_PUBLIC_BASE_URL");
  const updater = secureUrl(env.TAURI_UPDATER_ENDPOINT, "TAURI_UPDATER_ENDPOINT");
  if (updater.toString() !== new URL(`${prefix}/latest.json`, `${publicBase.toString().replace(/\/$/, "")}/`).toString()) throw new Error("updater_endpoint_mismatch");
  if (!/^v\d+\.\d+\.\d+-beta\.\d+$/.test(env.RELEASE_TAG)) throw new Error("invalid_RELEASE_TAG");
  return { endpoint: endpoint.toString(), publicBase: publicBase.toString().replace(/\/$/, ""), updater, region: env.R2_RELEASES_REGION, bucket: env.R2_RELEASES_BUCKET, accessKeyId: env.R2_RELEASES_ACCESS_KEY_ID, secretAccessKey: env.R2_RELEASES_SECRET_ACCESS_KEY, version: env.RELEASE_TAG.slice(1) };
}

export function discoverArtifacts(directory) {
  const names = fs.readdirSync(directory);
  const installer = exactlyOne(names, (name) => name.endsWith("-setup.exe"), "NSIS installer");
  const archive = exactlyOne(names, (name) => name.endsWith(".nsis.zip"), "updater archive");
  const signature = `${archive}.sig`;
  if (!names.includes(signature)) throw new Error("missing updater signature");
  const checksums = "SHA256SUMS.txt";
  if (!names.includes(checksums)) throw new Error("missing SHA256SUMS.txt");
  return { installer, archive, signature, checksums };
}

export function buildManifest({ version, notes, pubDate, archiveUrl, signature }) {
  if (!/^\d+\.\d+\.\d+-beta\.\d+$/.test(version)) throw new Error("invalid manifest version");
  if (!isTauriSignature(signature) || /[<>]/.test(notes)) throw new Error("invalid manifest content");
  const url = secureUrl(archiveUrl, "artifact_url");
  return { version, notes, pub_date: new Date(pubDate).toISOString(), platforms: { "windows-x86_64": { url: url.toString(), signature: signature.trim() } } };
}

export function compareVersions(left, right) {
  const parse = (value) => { const match = /^(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/.exec(value); if (!match) throw new Error("invalid beta version"); return match.slice(1).map(Number); };
  const a = parse(left), b = parse(right);
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return Math.sign(a[index] - b[index]);
  return 0;
}

async function publish() {
  const config = parseConfig(process.env);
  const directory = path.resolve("src-tauri/target/release/bundle/nsis");
  const files = discoverArtifacts(directory);
  if (![files.installer, files.archive].every((name) => name.includes(config.version) && /x64|x86_64/i.test(name))) throw new Error("artifact name must contain version and x64 architecture");
  const notesPath = path.resolve(`docs/releases/${config.version}.md`);
  if (!fs.existsSync(notesPath)) throw new Error("missing versioned release notes");
  const notes = fs.readFileSync(notesPath, "utf8").trim();
  const client = new S3Client({ endpoint: config.endpoint, region: config.region, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
  const existing = await readExistingManifest(client, config.bucket);
  if (existing && compareVersions(config.version, existing.version) <= 0) throw new Error("beta channel refuses an equal or older version");
  const versionPrefix = `${prefix}/windows-x86_64/${config.version}`;
  for (const name of Object.values(files)) await uploadAndVerify(client, config.bucket, `${versionPrefix}/${name}`, path.join(directory, name), contentType(name), name === files.checksums ? "no-cache" : "public, max-age=31536000, immutable");
  const signature = fs.readFileSync(path.join(directory, files.signature), "utf8");
  const archiveUrl = `${config.publicBase}/${versionPrefix}/${encodeURIComponent(files.archive)}`;
  await verifyPublicArtifact(archiveUrl);
  const manifest = buildManifest({ version: config.version, notes, pubDate: new Date(), archiveUrl, signature });
  const manifestPath = path.join(directory, "latest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: `${prefix}/latest.json`, Body: fs.readFileSync(manifestPath), ContentType: "application/json; charset=utf-8", CacheControl: "no-cache, max-age=0, must-revalidate" }));
  await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: `${prefix}/latest.json` }));
  await verifyPublicManifest(config.updater, config.version, archiveUrl);
  console.log(`Published signed Beta channel metadata for ${config.version}.`);
}

async function uploadAndVerify(client, bucket, key, file, type, cacheControl) {
  const body = fs.readFileSync(file);
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: type, CacheControl: cacheControl, Metadata: { sha256: crypto.createHash("sha256").update(body).digest("hex") } }));
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  const digest = crypto.createHash("sha256").update(body).digest("hex");
  if (head.ContentLength !== body.length || head.Metadata?.sha256 !== digest) throw new Error(`upload verification failed: ${path.basename(file)}`);
}
async function verifyPublicArtifact(url) { const response = await fetch(url, { method: "HEAD", redirect: "error" }); if (!response.ok || response.headers.get("content-type") !== "application/zip" || !/immutable/i.test(response.headers.get("cache-control") ?? "")) throw new Error("public updater artifact verification failed"); }
async function verifyPublicManifest(url, version, archiveUrl) { const response = await fetch(url, { headers: { accept: "application/json" }, redirect: "error", cache: "no-store" }); if (!response.ok || !/application\/json/i.test(response.headers.get("content-type") ?? "") || !/no-cache|max-age=0/i.test(response.headers.get("cache-control") ?? "")) throw new Error("public manifest headers invalid"); const manifest = await response.json(); if (manifest.version !== version || manifest.platforms?.["windows-x86_64"]?.url !== archiveUrl || !isTauriSignature(manifest.platforms?.["windows-x86_64"]?.signature ?? "")) throw new Error("public manifest content invalid"); }
async function readExistingManifest(client, bucket) { try { const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `${prefix}/latest.json` })); return JSON.parse(await response.Body.transformToString()); } catch (error) { if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return undefined; throw error; } }
function secureUrl(value, name) { let url; try { url = new URL(value); } catch { throw new Error(`invalid_${name}`); } if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || isPrivateHost(url.hostname)) throw new Error(`invalid_${name}`); return url; }
function isPrivateHost(host) { const value = host.toLowerCase(); return value === "localhost" || value === "::1" || value.endsWith(".local") || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value); }
function isTauriSignature(value) { try { const decoded = Buffer.from(value.trim(), "base64").toString("utf8"); return decoded.includes("untrusted comment:") && /^R[A-Za-z0-9+/=]{40,}$/m.test(decoded); } catch { return false; } }
function exactlyOne(names, predicate, label) { const found = names.filter(predicate); if (found.length !== 1) throw new Error(`expected one ${label}, found ${found.length}`); return found[0]; }
function contentType(name) { if (name.endsWith(".exe")) return "application/vnd.microsoft.portable-executable"; if (name.endsWith(".zip")) return "application/zip"; return "text/plain; charset=utf-8"; }

if (process.argv[1] === fileURLToPath(import.meta.url)) publish().catch((error) => { console.error(error instanceof Error ? error.message : "beta release publish failed"); process.exitCode = 1; });
