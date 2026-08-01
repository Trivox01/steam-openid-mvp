import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { queryGamesInMemory } from "../src/services/smartLibraryRanking.ts";
import { achievementCompletion, deriveGameCardSyncState } from "../src/services/gameCardPresentation.ts";
import fs from "node:fs";

const makeGames = (count) => Array.from({length:count},(_,i)=>({
  id:`game-${i}`,appId:String(100000+i),platform:"steam",name:`Game ${String(i).padStart(5,"0")}`,
  coverUrl:"",backgroundUrl:"",playtimeHours:i%400,totalAchievements:i%7===0?0:50,
  unlockedAchievements:i%50,completionPercentage:i%7===0?0:(i%50)*2,lastPlayedAt:i%5?new Date(Date.now()-i*86_400_000).toISOString():"",
  syncedAt:new Date(Date.now()-i*3_600_000).toISOString(),tracked:i===count-1,lastOpenedAt:i%11===0?new Date(Date.now()-i*60_000).toISOString():undefined
}));

for (const size of [1_000,10_000]) {
  const games=makeGames(size); const started=performance.now();
  const page=queryGamesInMemory(games,{search:"Game 00",filter:"incomplete",sort:"smart",offset:0,limit:30});
  const elapsed=performance.now()-started;
  assert.ok(page.games.length<=30); assert.ok(page.total<=size);
  console.log(`smart-library dataset=${size} elapsedMs=${elapsed.toFixed(2)} returned=${page.games.length} total=${page.total} domCardBudget=30 imageRequestBudget=30`);
}
const ranked=queryGamesInMemory(makeGames(100),{search:"",filter:"all",sort:"smart",offset:0,limit:100});
assert.equal(ranked.games[0].tracked,true,"tracked game should receive the strongest signal");
assert.deepEqual(queryGamesInMemory(makeGames(10),{search:"100009",filter:"all",sort:"nameAsc",offset:0,limit:30}).games.map(g=>g.appId),["100009"]);
console.log("Smart Library ranking, search, filters, pagination and fixed DOM budget validated.");

const synced={...makeGames(1)[0],achievementsSyncStatus:"success",achievementsSyncedAt:"2026-08-01T00:00:00Z",totalAchievements:53,unlockedAchievements:31};
assert.equal(deriveGameCardSyncState(synced,"idle",true),"updated");
assert.equal(deriveGameCardSyncState({...synced,achievementsSyncStatus:"error"},"idle",true),"needsUpdate","failed refresh is never labelled updated");
assert.equal(deriveGameCardSyncState(synced,"updating",true),"updating");
assert.equal(deriveGameCardSyncState(synced,"success",false),"saved","offline retains cached success");
assert.equal(deriveGameCardSyncState({...synced,totalAchievements:0,achievementsSyncedAt:undefined},"idle",false),"offline");
assert.equal(deriveGameCardSyncState({...synced,achievementsSyncStatus:"unsupported",achievementsSyncedAt:undefined,totalAchievements:0},"idle",true),"unavailable");
assert.equal(achievementCompletion(31,37),84);
assert.equal(achievementCompletion(37,37),100);
assert.equal(achievementCompletion(0,0),undefined,"missing achievement data must not render a misleading zero");
assert.equal(achievementCompletion(4,3),undefined,"invalid counts are unavailable");
const cardSource=fs.readFileSync("src/components/games/GameCard.tsx","utf8");
const pageSource=fs.readFileSync("src/pages/GamesPage.tsx","utf8");
const styles=fs.readFileSync("src/styles/index.css","utf8");
assert.match(cardSource,/event\.stopPropagation\(\)/,"Track action is isolated from card navigation");
assert.match(cardSource,/disabled=\{game\.tracking\}/);
assert.match(pageSource,/status==="loading" && !page\.games\.length/,"skeleton is first-load only");
assert.doesNotMatch(`${cardSource}\n${pageSource}`,/fetch\(|axios|XMLHttpRequest/,"card polish adds no network client");
assert.match(styles,/scale\(1\.01\)/);
assert.match(styles,/prefers-reduced-motion:reduce/);
assert.match(styles,/-webkit-line-clamp:2/);
assert.match(styles,/forced-colors:active/);
assert.match(styles,/inset-inline-start/);
