import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ApplicationRefreshCoordinator } from "../src/services/ApplicationRefreshCoordinator.ts";

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
assert.deepEqual(partial.failedTasks, ["failure"]);

const rust = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
assert.match(rust, /TrayIconBuilder::with_id\("achievement-nexus-tray"\)/);
assert.match(rust, /"open-nexus"/);
assert.match(rust, /"check-for-updates"/);
assert.match(rust, /"quit-nexus"/);
assert.match(rust, /api\.prevent_close\(\)/);

console.log("Tray and application refresh validation passed.");
