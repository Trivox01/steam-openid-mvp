import fs from "node:fs";
import assert from "node:assert/strict";

const workflow = fs.readFileSync(".github/workflows/windows-beta-draft.yml", "utf8");
const configScript = fs.readFileSync("scripts/release/create-updater-config.mjs", "utf8");
const publisher = fs.readFileSync("services/auth-api/scripts/publish-beta-release.mjs", "utf8");
const channels = JSON.parse(fs.readFileSync("release/channels.json", "utf8"));

for (const name of ["R2_RELEASES_ENDPOINT","R2_RELEASES_REGION","R2_RELEASES_BUCKET","R2_RELEASES_ACCESS_KEY_ID","R2_RELEASES_SECRET_ACCESS_KEY","R2_RELEASES_PUBLIC_BASE_URL","TAURI_UPDATER_ENDPOINT","TAURI_SIGNING_PRIVATE_KEY","TAURI_SIGNING_PRIVATE_KEY_PASSWORD","TAURI_UPDATER_PUBLIC_KEY"]) assert.match(workflow, new RegExp(name));
assert.match(workflow, /environment:\s*beta-release/);
assert.doesNotMatch(workflow, /pull_request:/);
assert.match(workflow, /releaseDraft:\s*true/);
assert.match(workflow, /prerelease:\s*true/);
assert.equal(channels.channels.beta.endpointSource, "TAURI_UPDATER_ENDPOINT");
assert.doesNotMatch(JSON.stringify(channels), /githubusercontent/);
assert.match(configScript, /credential-free HTTPS/);
assert.match(configScript, /connect-src/);
assert.match(publisher, /const prefix = "releases\/beta"/);
assert.match(publisher, /windows-x86_64/);
assert.match(publisher, /max-age=31536000, immutable/);
assert.match(publisher, /no-cache, max-age=0, must-revalidate/);
const manifestUpload = publisher.lastIndexOf("PutObjectCommand");
const artifactUpload = publisher.indexOf("uploadAndVerify");
assert.ok(manifestUpload > artifactUpload, "latest.json must be uploaded after versioned artifacts");
console.log("Private GitHub Draft and public R2 Beta channel validation passed.");
