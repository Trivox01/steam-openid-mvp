import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sessionSummaryPreview } from "../src/features/session-summaries/previewFixtures.ts";
import { formatSessionSummaryDuration, sessionSummaryPluralKey } from "../src/features/session-summaries/sessionSummaryFormatting.ts";
import { mergeUnseenSummaries } from "../src/services/sessionSummaryQueue.ts";
import { gameSession as arSession } from "../src/locales/ar/gameSession.ts";
import { gameSession as enSession } from "../src/locales/en/gameSession.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [modal, store, app, details, css, migration, rust, en, ar] = await Promise.all([
  read("src/features/session-summaries/SessionSummaryModal.tsx"),
  read("src/services/GameSessionSummaryStore.ts"),
  read("src/App.tsx"),
  read("src/pages/GameDetailsPage.tsx"),
  read("src/styles/index.css"),
  read("src-tauri/migrations/011_game_session_summaries.sql"),
  read("src-tauri/src/game_session.rs"),
  read("src/locales/en/gameSession.ts"),
  read("src/locales/ar/gameSession.ts")
]);

for (const kind of ["none", "one", "five", "long", "arabic"]) {
  const fixture = sessionSummaryPreview(kind);
  assert.equal(fixture.unlockedCount, fixture.achievementsUnlocked.length, `${kind} count stays honest`);
  assert.ok(fixture.durationSeconds > 0, `${kind} has duration`);
}
assert.equal(sessionSummaryPreview("none").progressAfter, undefined, "unavailable progress is omitted");
assert.equal(sessionSummaryPreview("five").achievementsUnlocked.length, 5, "five-achievement overflow fixture exists");
assert.match(sessionSummaryPreview("arabic").gameName, /[\u0600-\u06ff]/, "Arabic fixture exists");
const queued = Array.from({ length: 8 }, (_, index) => ({
  ...sessionSummaryPreview("none"),
  sessionId: `queue-${index}`,
  endedAtMs: index
}));
assert.equal(mergeUnseenSummaries([], queued).length, 6, "unseen queue is bounded");
assert.equal(mergeUnseenSummaries([], queued)[0].sessionId, "queue-7", "latest summary appears first");
assert.equal(mergeUnseenSummaries([queued[7]], [queued[7]]).length, 1, "duplicate events do not duplicate a modal");
const translator = (dictionary) => (key, values = {}) => dictionary[key].replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name]));
assert.equal(formatSessionSummaryDuration(5_400, "en", translator(enSession)), "1h 30m", "English duration stays compact");
assert.equal(formatSessionSummaryDuration(5_400, "ar", translator(arSession)), "ساعة واحدة و30 دقيقة", "Arabic duration is natural");
assert.equal(sessionSummaryPluralKey("sessionSummary.achievements", 2, "ar"), "sessionSummary.achievements.two", "Arabic dual form is selected");
assert.equal(sessionSummaryPluralKey("sessionSummary.achievements", 5, "ar"), "sessionSummary.achievements.few", "Arabic few form is selected");

assert.match(migration, /PRIMARY KEY \(session_id, achievement_id\)/, "achievement relation is normalized");
assert.match(migration, /seen_at INTEGER/, "unseen summaries survive restart");
assert.match(rust, /source='steam'.*is_unlocked=1.*unlocked_at IS NOT NULL/s, "only trusted Steam unlock times are associated");
assert.match(rust, /BETWEEN \?2 AND \?3/, "unlock time is constrained to the session window");
assert.match(rust, /achievements_synced_at[\s\S]*>= s\.ended_at/, "end progress requires a post-session snapshot");
assert.match(rust, /already_generated/, "summary generation is idempotent");
assert.match(rust, /query_game_session_summaries/, "summaries use a bounded batch query");
assert.match(store, /maxUnseen = 6/, "unseen queue is bounded");
assert.match(store, /nexus:\/\/app-visibility-changed/, "foreground state controls presentation");
assert.match(app, /<SessionSummaryHost onOpenGame=\{openGame\}/, "summary host is mounted once");
assert.match(details, /<RecentGameSessions appId=\{game.appId\}/, "Game Details includes recent sessions");
assert.match(modal, /aria-modal="true"/, "modal semantics are present");
assert.match(modal, /event.key === "Escape"/, "Escape closes the modal");
assert.match(modal, /event.key !== "Tab"/, "keyboard focus is trapped");
assert.match(modal, /previousFocus\?\.focus\(\)/, "focus is restored");
assert.doesNotMatch(modal, /fetch\(|steamArtworkSources/, "summary UI does not introduce network requests");
assert.match(css, /@media\(max-width:620px\).*session-summary/s, "narrow layout exists");
assert.match(css, /@media\(forced-colors:active\).*session-summary/s, "forced colors are supported");
assert.match(css, /prefers-reduced-motion:reduce.*session-summary/s, "reduced motion is supported");
for (const key of ["sessionSummary.complete", "sessionSummary.done", "sessionSummary.recentTitle"]) {
  assert.ok(en.includes(`"${key}"`), `English includes ${key}`);
  assert.ok(ar.includes(`"${key}"`), `Arabic includes ${key}`);
}

console.log("Post-game session summary validation passed.");
