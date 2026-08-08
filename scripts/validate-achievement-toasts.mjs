import assert from "node:assert/strict";
import fs from "node:fs";
import { AchievementToastCoordinator } from "../src/features/achievement-toasts/AchievementToastCoordinator.ts";
import { trustedUnlockTransitions } from "../src/features/achievement-toasts/syncDelta.ts";

globalThis.window = globalThis;
let clock = 1_000;
const coordinator = new AchievementToastCoordinator(() => clock);
coordinator.configure({ notificationsEnabled: true, soundEnabled: false });
const event = (id) => ({ eventId: id, appId: "10", achievementId: id, name: `Achievement ${id}`, source: "test_preview" });

assert.equal(coordinator.enqueue(event("one")), true, "enqueue accepts a valid event");
assert.equal(coordinator.getSnapshot().active?.achievementId, "one", "first event becomes active");
assert.equal(coordinator.enqueue(event("one")), false, "duplicate event is rejected");
assert.equal(coordinator.enqueue(event("two")), true, "second event is queued");
coordinator.pause("hover");
assert.equal(coordinator.getSnapshot().paused, true, "hover pauses timeout");
coordinator.resume("hover");
assert.equal(coordinator.getSnapshot().paused, false, "hover leave resumes timeout");
coordinator.pause("focus");
assert.equal(coordinator.getSnapshot().paused, true, "focus pauses timeout");
coordinator.resume("focus");
coordinator.dismiss();
assert.equal(coordinator.getSnapshot().active?.achievementId, "two", "dismiss advances FIFO queue");

for (let index = 0; index < 20; index += 1) coordinator.enqueue(event(`burst-${index}`));
assert.equal(coordinator.getSnapshot().queued, 8, "queue is bounded");
assert.ok(coordinator.getSnapshot().overflow > 0, "burst overflow is summarized");
coordinator.setAppVisible(false);
assert.equal(coordinator.getSnapshot().active, undefined, "background policy defers the active toast");
coordinator.setAppVisible(true);
assert.ok(coordinator.getSnapshot().active, "restore presents the deferred event");
coordinator.configure({ notificationsEnabled: false, soundEnabled: false });
assert.equal(coordinator.getSnapshot().active, undefined, "disabling notifications clears presentation");
assert.equal(coordinator.enqueue(event("disabled")), false, "disabled notifications reject presentation");
assert.equal(coordinator.isSoundEnabled(), false, "sound remains disabled by default");

const timeoutCoordinator = new AchievementToastCoordinator();
timeoutCoordinator.configure({ notificationsEnabled: true, soundEnabled: false });
timeoutCoordinator.enqueue(event("timeout"));
await new Promise((resolve) => setTimeout(resolve, 6_100));
assert.equal(timeoutCoordinator.getSnapshot().active, undefined, "active toast dismisses after its timeout");

const locked = { id: "a", externalId: "ACH_A", gameId: "g", title: "A", description: "", iconUrl: "", rarityPercentage: 0, points: 0, unlocked: false, unlockStateKnown: true };
const unlocked = { ...locked, unlocked: true, unlockedAt: "2026-08-08T10:00:00Z", globalUnlockPercent: 8.4 };
assert.equal(trustedUnlockTransitions("10", [], [unlocked]).length, 0, "initial import establishes baseline without notifications");
assert.equal(trustedUnlockTransitions("10", [{ ...locked, unlockStateKnown: false }], [unlocked]).length, 0, "unknown baseline is suppressed");
assert.equal(trustedUnlockTransitions("10", [locked], [unlocked]).length, 1, "trusted locked-to-unlocked transition emits once");
assert.equal(trustedUnlockTransitions("10", [unlocked], [unlocked]).length, 0, "repeated sync is suppressed");

const host = fs.readFileSync(new URL("../src/features/achievement-toasts/AchievementToastHost.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/styles/index.css", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
assert.match(host, /role="status"/);
assert.match(host, /onMouseEnter/);
assert.match(host, /onFocusCapture/);
assert.match(host, /AchievementIcon/);
assert.doesNotMatch(host, /dangerouslySetInnerHTML/);
assert.equal((app.match(/<AchievementToastHost/g) ?? []).length, 1, "one ToastHost is mounted in the app shell");
assert.match(css, /prefers-reduced-motion:reduce/);
assert.match(css, /forced-colors:active/);
assert.match(css, /max-width:520px/);

console.log("Achievement Toast coordinator, baseline, queue, accessibility and responsive validation passed.");
