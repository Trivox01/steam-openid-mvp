import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/index.css", import.meta.url), "utf8");
const pageHeader = readFileSync(new URL("../src/components/ui/PageHeader.tsx", import.meta.url), "utf8");
const sectionHeader = readFileSync(new URL("../src/components/ui/SectionHeader.tsx", import.meta.url), "utf8");
const gameAction = readFileSync(new URL("../src/components/games/GameActionButton.tsx", import.meta.url), "utf8");
const fontUrl = new URL("../src/assets/fonts/arabic/thmanyah-serif-display-bold.otf", import.meta.url);

assert.ok(statSync(fontUrl).size > 0, "the licensed local OTF must be present");
assert.match(css, /@font-face\s*{[^}]*font-family:\s*"Nexus Arabic Display"[^}]*font-weight:\s*700[^}]*font-display:\s*swap[^}]*}/s);
assert.match(css, /src:\s*url\("\.\.\/assets\/fonts\/arabic\/thmanyah-serif-display-bold\.otf"\) format\("opentype"\)/);
assert.match(css, /--font-arabic-ui:/);
assert.match(css, /--font-arabic-display:\s*"Nexus Arabic Display",var\(--font-arabic-ui\)/);
assert.match(css, /html\[lang="ar"\] \.nexus-display-title\s*{[^}]*letter-spacing:\s*normal/s);
assert.doesNotMatch(css, /html\[lang="en"\][^{]*Nexus Arabic Display|html\[dir="ltr"\][^{]*Nexus Arabic Display/);
assert.match(pageHeader, /className="nexus-display-title"/);
assert.match(sectionHeader, /className="nexus-display-title"/);
assert.doesNotMatch(gameAction, /nexus-display-title|Nexus Arabic Display/);
assert.doesNotMatch(css, /fonts\.googleapis|fonts\.gstatic|@import\s+url|data:font/);

console.log("Arabic display typography validation passed.");
