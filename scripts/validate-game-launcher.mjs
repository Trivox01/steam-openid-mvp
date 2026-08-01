import assert from "node:assert/strict";
import fs from "node:fs";
import {GameLauncherService} from "../src/services/GameLauncherService.ts";

assert.equal(GameLauncherService.buildUri("run","2807960"),"steam://run/2807960");
assert.equal(GameLauncherService.buildUri("install","578080"),"steam://install/578080");
assert.equal(GameLauncherService.buildUri("store","2913300"),"steam://store/2913300");
for(const invalid of ["","0","-1","12.3","1/2","4294967296","abc"])assert.throws(()=>GameLauncherService.buildLaunchUri(invalid),/invalid_app_id/);

const probe=(steamStatus,installed)=>({getState:async()=>({steamStatus,installed}),invalidate:async()=>undefined});
const calls=[];let resolveOpen;
const launcher=new GameLauncherService({open:(uri)=>{calls.push(uri);return new Promise(resolve=>{resolveOpen=resolve})}},probe("installed",true),undefined,undefined,0);
assert.equal((await launcher.refresh("578080","owned")).availability,"installed");
const first=launcher.act("578080","owned"),duplicate=launcher.act("578080","owned");assert.equal(first,duplicate);
await Promise.resolve();assert.equal(launcher.getSnapshot("578080").actionStatus,"openingSteam");resolveOpen();await first;assert.deepEqual(calls,["steam://run/578080"]);

const actions=[];
for(const [status,installed,ownership,expected,uri] of [
 ["installed",false,"owned","owned_not_installed","steam://install/10"],
 ["installed",false,"not_owned","not_owned","steam://store/10"],
 ["installed",false,"unknown","not_installed","steam://store/10"],
 ["not_installed",false,"owned","steam_not_installed",null],
 ["unavailable",false,"owned","steam_unavailable","steam://store/10"]
]){const service=new GameLauncherService({open:async value=>actions.push(value)},probe(status,installed),undefined,undefined,0);assert.equal((await service.refresh("10",ownership)).availability,expected);if(uri){await service.act("10",ownership);assert.equal(actions.at(-1),uri)}}
const running=new GameLauncherService({open:async()=>assert.fail("must not open")},probe("installed",true),{getState:async()=>"running"});assert.equal((await running.refresh("10","owned")).availability,"running");await running.act("10","owned");

const card=fs.readFileSync("src/components/games/GameCard.tsx","utf8"),details=fs.readFileSync("src/pages/GameDetailsPage.tsx","utf8"),button=fs.readFileSync("src/components/games/GameActionButton.tsx","utf8"),shiny=fs.readFileSync("src/components/ui/NexusShinyButton.tsx","utf8"),styles=fs.readFileSync("src/styles/index.css","utf8"),composition=fs.readFileSync("src/services/compositionRoot.ts","utf8");
assert.match(card,/<GameActionButton/);assert.match(details,/<GameActionButton/);assert.match(button,/event\.stopPropagation\(\)/);assert.match(shiny,/aria-busy/);assert.match(button,/aria-live="polite"/);assert.match(composition,/steam-installation-changed/);assert.match(composition,/replaceIndex\(payload\.index\);void gameLauncher\.installationChanged\(payload\.appId\)/);assert.match(styles,/prefers-reduced-motion:reduce/);assert.match(styles,/forced-colors:active/);assert.match(styles,/nexus-action-shine 5s/);assert.doesNotMatch(`${card}\n${details}\n${button}`,/openUrl\(|steam:\/\/(run|install|store)\//);
console.log("Game action availability, safe URI selection, deduplication and shared UI validated.");
