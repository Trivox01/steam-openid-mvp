import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ApplicationRefreshCoordinator,
  RefreshHandlerError,
  skipped
} from "../src/services/ApplicationRefreshCoordinator.ts";

const coordinator = new ApplicationRefreshCoordinator();
let running = 0;
let peak = 0;
const task = async () => {
  running += 1;
  peak = Math.max(peak, running);
  await Promise.resolve();
  running -= 1;
};
coordinator.register({ id: "one", run: task });
coordinator.register({ id: "two", run: task });
const first = coordinator.refreshAll();
const duplicate = coordinator.refreshAll();
assert.equal(first, duplicate, "concurrent refresh calls must share one operation");
assert.equal((await first).status, "success");
assert.equal(peak, 2, "independent refresh handlers must run in parallel");

coordinator.register({ id: "failure", run: async () => { throw new Error("expected"); } });
const partial = await coordinator.refreshAll();
assert.equal(partial.status, "partial");
assert.deepEqual(
  partial.results.filter((item) => item.status === "failed").map((item) => item.id),
  ["failure"]
);
assert.equal(partial.results.find((item) => item.id === "failure")?.reason, "request_failed");

let failedAttempts = 0;
let successfulAttempts = 0;
const retryCoordinator = new ApplicationRefreshCoordinator();
retryCoordinator.register({
  id: "offline",
  run: async () => {
    failedAttempts += 1;
    if (failedAttempts === 1) throw new RefreshHandlerError("network", 503);
  }
});
retryCoordinator.register({
  id: "stable",
  run: async () => { successfulAttempts += 1; }
});
const offline = await retryCoordinator.refreshAll();
assert.equal(offline.status, "partial");
assert.equal(offline.results[0].statusCode, 503);
await retryCoordinator.retryFailedOnly();
assert.equal(failedAttempts, 2, "retry must rerun a failed handler");
assert.equal(successfulAttempts, 1, "retry must not rerun successful handlers");

const optionalCoordinator = new ApplicationRefreshCoordinator();
optionalCoordinator.register({
  id: "steam-library",
  run: async () => skipped("steam_credentials_unavailable")
});
optionalCoordinator.register({
  id: "authorization",
  run: async () => skipped("session_expired")
});
const optional = await optionalCoordinator.refreshAll();
assert.equal(optional.status, "success");
assert.equal(optional.results.every((item) => item.status === "skipped"), true);

const preservedData = ["existing-game"];
const preservationCoordinator = new ApplicationRefreshCoordinator();
preservationCoordinator.register({
  id: "remote",
  run: async () => { throw new RefreshHandlerError("network"); }
});
await preservationCoordinator.refreshAll();
assert.deepEqual(preservedData, ["existing-game"], "failed refresh must preserve old data");

const rust = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const composition = await readFile(new URL("../src/services/compositionRoot.ts", import.meta.url), "utf8");
assert.match(rust, /TrayIconBuilder::with_id\("achievement-nexus-tray"\)/);
assert.match(rust, /"open-nexus"/);
assert.match(rust, /"check-for-updates"/);
assert.match(rust, /"quit-nexus"/);
assert.match(rust, /api\.prevent_close\(\)/);
assert.match(composition, /getActiveSession\(\)/);
assert.match(composition, /skipped\("session_expired"\)/);
assert.doesNotMatch(composition, /hasApiKey|steam_credentials_unavailable/);
assert.doesNotMatch(composition, /id:\s*"updater"/);

console.log("Tray and application refresh validation passed.");
