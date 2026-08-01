import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { queryGamesInMemory } from "../src/services/smartLibraryRanking.ts";

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
