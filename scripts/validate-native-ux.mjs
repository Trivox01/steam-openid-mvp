import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const interactions = readFileSync(new URL("../src/services/nativeDesktopInteractions.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles/index.css", import.meta.url), "utf8");
const users = readFileSync(new URL("../src/features/developer-center/users/UserManagementPanel.tsx", import.meta.url), "utf8");
const tauri = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const cargo = readFileSync(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");

assert.match(main, /installNativeDesktopInteractions\(\)/, "native interactions must install once at startup");
assert.match(interactions, /addEventListener\("contextmenu"[^\n]*true\)/, "WebView context menu must be intercepted in capture phase");
assert.match(interactions, /addEventListener\("dragstart"[^\n]*true\)/, "dragging out of the WebView must be intercepted");
assert.match(interactions, /addEventListener\("selectstart"/);
assert.match(interactions, /addEventListener\("copy"/);
assert.match(interactions, /input,textarea/);
assert.match(interactions, /\[contenteditable\]/);
assert.match(interactions, /\[data-allow-copy\]/);
assert.doesNotMatch(interactions, /keydown|keyup|keypress/, "keyboard shortcuts must remain native in allowed controls");
assert.match(css, /body,#root,#root \*[^}]*user-select:none/);
assert.match(css, /input,textarea,\[contenteditable\][^}]*\[data-allow-copy\][^}]*user-select:text/);
assert.match(css, /img,svg[^}]*user-drag:none/);
assert.match(users, /data-allow-copy/);
assert.match(users, /navigator\.clipboard\.writeText\(value\)/, "Copy UUID action must remain wired");
assert.notEqual(tauri.app.windows[0].devtools, true, "release configuration must not explicitly enable DevTools");
assert.doesNotMatch(cargo, /tauri\s*=.*features\s*=\s*\[[^\]]*["']devtools["']/, "release-only DevTools feature must stay disabled");
assert.match(css, /html\[dir="rtl"\]/, "RTL styling must remain present");
assert.match(css, /\.dark \{/, "dark theme must remain present");
assert.match(css, /forced-colors:active/, "forced colors support must remain present");

console.log("Native WebView interaction, copy exceptions, drag prevention and release DevTools validation passed.");
