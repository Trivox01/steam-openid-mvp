import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/index.css", import.meta.url), "utf8");
const theme = readFileSync(new URL("../src/state/ThemeContext.tsx", import.meta.url), "utf8");
const button = readFileSync(new URL("../src/components/ui/NexusShinyButton.tsx", import.meta.url), "utf8");
const actionStart = css.indexOf("/* Phase 4.1: semantic, theme-aware Nexus actions");
const actions = css.slice(actionStart);

assert.ok(actionStart > 0, "semantic game action styles must exist");
for (const token of [
  "--app-background", "--surface", "--surface-raised", "--card-background",
  "--border-muted", "--input-background", "--surface-hover", "--overlay",
  "--scrollbar-thumb", "--action-play", "--action-running", "--action-install",
]) assert.match(css, new RegExp(`${token}:`), `missing ${token}`);

assert.ok(css.indexOf(".dark {") > css.indexOf(":root {"), "dark overrides must follow light defaults");
assert.doesNotMatch(button, /nexus-shiny-button__glow/, "white sweep element must not be rendered");
assert.doesNotMatch(actions, /rgba\(255\s*,\s*255\s*,\s*255/i, "game action effect must not use a white translucent sweep");
assert.doesNotMatch(actions, /nexus-action-sweep/, "sweep animation must be removed");
assert.match(actions, /--play\{--nexus-action-a:var\(--action-play\)/);
assert.match(actions, /--install\{--nexus-action-a:var\(--action-install\)/);
assert.match(actions, /--running[^}]*animation:none/);
assert.match(actions, /--hero:not\(\.nexus-shiny-button--running\)/, "running must not continuously animate");
assert.match(actions, /prefers-reduced-motion:reduce/);
assert.match(actions, /forced-colors:active/);

assert.match(theme, /prefers-color-scheme: dark/);
assert.match(theme, /addEventListener\("change"/);
assert.match(theme, /dataset\.theme = resolvedTheme/);
assert.match(theme, /style\.colorScheme = resolvedTheme/);
assert.doesNotMatch(theme, /location\.reload|window\.location/);

console.log("Theme token and semantic action validation passed.");
