import assert from "node:assert/strict";
import { AchievementSoundService, installAchievementAudioUnlock } from "../src/features/achievement-toasts/AchievementSoundService.ts";
import { AchievementToastCoordinator } from "../src/features/achievement-toasts/AchievementToastCoordinator.ts";
import { AchievementToastSoundController } from "../src/features/achievement-toasts/AchievementToastSoundController.ts";
import fs from "node:fs";

globalThis.window = globalThis;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
let time = 1_000;
const calls = { preload: 0, play: 0, stop: 0, dispose: 0, volumes: [] };
const audio = {
  preload: async () => { calls.preload += 1; },
  play: async (volume) => { calls.play += 1; calls.volumes.push(volume); },
  stop: () => { calls.stop += 1; },
  dispose: () => { calls.dispose += 1; }
};
const sound = new AchievementSoundService(audio, () => time, 900);
assert.equal(await sound.play(), false, "disabled sound does not play");
sound.configure({ enabled: true, volume: 0 });
assert.equal(await sound.play(), false, "volume zero is silent");
sound.configure({ enabled: true, volume: 50 });
assert.equal(await sound.play(), true, "enabled sound plays at medium volume");
assert.equal(calls.preload, 1, "audio preloads once");
assert.equal(calls.volumes.at(-1), 0.5, "volume 50 maps to element volume 0.5");
time += 901;
sound.configure({ enabled: true, volume: 100 });
assert.equal(await sound.play(), true, "volume 100 plays after cooldown");
assert.equal(calls.volumes.at(-1), 1, "volume 100 maps to element volume 1");
assert.equal(await sound.play(), false, "cooldown prevents overlap");
time += 901;
assert.equal(await sound.play(), true, "sound resumes after cooldown");
assert.ok(calls.stop >= 2, "current sound is stopped before replay");
sound.cleanup();
assert.equal(calls.dispose, 1, "cleanup releases audio");

const preloadFailure = new AchievementSoundService({ ...audio, preload: async () => { throw new Error("blocked"); } });
preloadFailure.configure({ enabled: true, volume: 70 });
assert.equal(await preloadFailure.play(), false, "preload failure is non-blocking");
const playFailure = new AchievementSoundService({ ...audio, play: async () => { throw new Error("blocked"); } });
playFailure.configure({ enabled: true, volume: 70 });
assert.equal(await playFailure.play(), false, "play failure is non-blocking");

let releasePreload;
const preloadGate = new Promise((resolve) => { releasePreload = resolve; });
const raceCalls = { preload: 0, play: 0 };
const raceSound = new AchievementSoundService({
  preload: async () => { raceCalls.preload += 1; await preloadGate; },
  play: async () => { raceCalls.play += 1; },
  stop: () => {},
  dispose: () => {}
}, () => 2_000, 0);
raceSound.configure({ enabled: true, volume: 70 });
const startupPreload = raceSound.preload();
const playDuringPreload = raceSound.play();
await flush();
assert.equal(raceCalls.play, 0, "play waits for the in-flight preload");
releasePreload();
assert.equal(await startupPreload, true);
assert.equal(await playDuringPreload, true, "the first toast is not dropped during startup preload");
assert.equal(raceCalls.preload, 1, "concurrent preload is shared");
assert.equal(raceCalls.play, 1);

let unlocked = false;
let unlockCalls = 0;
const autoplayDiagnostics = [];
const autoplaySound = new AchievementSoundService({
  preload: async () => {},
  unlock: async () => { unlockCalls += 1; unlocked = true; },
  play: async () => { if (!unlocked) { const error = new Error("details must not be logged"); error.name = "NotAllowedError"; throw error; } },
  stop: () => {},
  dispose: () => {}
}, () => 3_000, 0, (diagnostic) => autoplayDiagnostics.push(diagnostic));
autoplaySound.configure({ enabled: true, volume: 50 });
assert.equal(await autoplaySound.play(), false, "autoplay rejection remains non-blocking");
const interactionTarget = new EventTarget();
const removeUnlockListeners = installAchievementAudioUnlock(autoplaySound, interactionTarget);
interactionTarget.dispatchEvent(new Event("pointerdown"));
interactionTarget.dispatchEvent(new Event("click"));
await flush();
assert.equal(unlockCalls, 1, "audio unlock runs once on the first interaction");
interactionTarget.dispatchEvent(new Event("keydown"));
await flush();
assert.equal(unlockCalls, 1, "successful unlock removes all global interaction listeners");
assert.equal(await autoplaySound.play(), true, "automatic playback works after interaction unlock");
removeUnlockListeners();
assert.ok(autoplayDiagnostics.some((entry) => entry.event === "play" && entry.outcome === "failure" && entry.reason === "NotAllowedError"));
assert.ok(autoplayDiagnostics.some((entry) => entry.event === "unlock" && entry.outcome === "success"));
assert.ok(autoplayDiagnostics.some((entry) => entry.event === "play" && entry.outcome === "success"));
assert.equal(JSON.stringify(autoplayDiagnostics).includes("details must not be logged"), false, "diagnostics exclude error messages and stacks");
assert.deepEqual(autoplaySound.getSettings(), { enabled: true, volume: 50 }, "service settings match configured UI values");

globalThis.document = { visibilityState: "hidden" };
const backgroundDiagnostics = [];
const backgroundSound = new AchievementSoundService(audio, () => 4_000, 0, (diagnostic) => backgroundDiagnostics.push(diagnostic));
backgroundSound.configure({ enabled: true, volume: 70 });
assert.ok(backgroundDiagnostics.every((entry) => entry.appState === "background"), "diagnostics report background state without user data");
delete globalThis.document;

let controllerTime = 5_000;
const controllerCalls = { play: 0 };
const controllerAudio = { preload: async () => {}, play: async () => { controllerCalls.play += 1; }, stop: () => {}, dispose: () => {} };
const coordinator = new AchievementToastCoordinator(() => controllerTime);
const controllerSound = new AchievementSoundService(controllerAudio, () => controllerTime, 0);
const controller = new AchievementToastSoundController(coordinator, controllerSound);
controller.configure({ enabled: true, volume: 70 });
const event = (id, soundMode = "default") => ({ eventId: id, appId: "10", achievementId: id, name: id, source: "test_preview", sound: soundMode });
assert.equal(coordinator.enqueue(event("accepted")), true);
await flush();
assert.equal(controllerCalls.play, 1, "accepted active toast triggers sound");
assert.equal(coordinator.enqueue(event("accepted")), false);
await flush();
assert.equal(controllerCalls.play, 1, "duplicate rejection triggers no sound");
coordinator.dismiss();
coordinator.enqueue(event("silent", "silent"));
await flush();
assert.equal(controllerCalls.play, 1, "silent preview triggers no sound");
coordinator.clear();
coordinator.setAppVisible(false);
coordinator.enqueue(event("background"));
await flush();
assert.equal(controllerCalls.play, 1, "background queue is silent");
coordinator.setAppVisible(true);
await flush();
assert.equal(controllerCalls.play, 2, "restore plays once when toast becomes active");
coordinator.clear();
for (let index = 0; index < 10; index += 1) coordinator.enqueue(event(`burst-${index}`));
await flush();
assert.equal(controllerCalls.play, 3, "burst starts with one summary sound");
for (let index = 0; index < 8; index += 1) { coordinator.dismiss(); await flush(); }
assert.equal(controllerCalls.play, 3, "burst queue does not produce audio spam");
coordinator.configure({ notificationsEnabled: false, soundEnabled: true });
assert.equal(coordinator.enqueue(event("notifications-off")), false);
await flush();
assert.equal(controllerCalls.play, 3, "notifications off means no sound");
controller.cleanup();

const settingsPage = fs.readFileSync(new URL("../src/pages/SettingsPage.tsx", import.meta.url), "utf8");
const compositionRoot = fs.readFileSync(new URL("../src/services/compositionRoot.ts", import.meta.url), "utf8");
const soundAsset = fs.statSync(new URL("../src/assets/audio/achievement-unlocked.mp3", import.meta.url));
const soundServiceSource = fs.readFileSync(new URL("../src/features/achievement-toasts/AchievementSoundService.ts", import.meta.url), "utf8");
assert.match(settingsPage, /type="range" min="0" max="100" step="5"/);
assert.match(settingsPage, /previewAchievementToastSound/);
assert.match(settingsPage, /previewAchievementToastSilent/);
assert.match(settingsPage, /previewAchievementToastQueue/);
assert.match(settingsPage, /previewAchievementToastBurst/);
assert.match(compositionRoot, /createHtmlAudioPort\(achievementUnlockSound\)/);
assert.equal(soundAsset.size, 18_432, "official sound asset stays compact");
assert.doesNotMatch(soundServiceSource, /https?:\/\/|getUserMedia|enumerateDevices|setSinkId/);
assert.match(soundServiceSource, /assetResolved/);
assert.match(soundServiceSource, /appState/);
assert.match(soundServiceSource, /installAchievementAudioUnlock/);

console.log("Achievement Sound asset, preload race, autoplay unlock, diagnostics, settings, cooldown, background, duplicate and burst policies validated.");
