import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/index.css", import.meta.url), "utf8");
const primitives = readFileSync(new URL("../src/components/ui/NexusGlass.tsx", import.meta.url), "utf8");
const required = [
  "--nexus-glass-bg", "--nexus-glass-bg-strong", "--nexus-glass-border",
  "--nexus-glass-shadow", "--nexus-glass-blur", "--nexus-bento-gap", "--nexus-bento-radius"
];
for (const token of required) if (!css.includes(token)) throw new Error(`Missing Nexus Glass token: ${token}`);
for (const primitive of ["GlassSurface", "BentoGrid", "BentoTile", "AmbientBackdrop"]) {
  if (!primitives.includes(`function ${primitive}`)) throw new Error(`Missing primitive: ${primitive}`);
}
const blurCount = (css.match(/backdrop-filter\s*:/g) ?? []).length;
if (blurCount > 12) throw new Error(`Excessive backdrop-filter declarations: ${blurCount}`);
if (/shine[^\n{]*\{[^}]*translateX/is.test(css)) throw new Error("White shine sweep must not return");
for (const marker of ["prefers-reduced-motion", "forced-colors", "prefers-reduced-transparency", "nexus-bento"]) {
  if (!css.includes(marker)) throw new Error(`Missing visual-system safeguard: ${marker}`);
}
console.log(`Nexus Glass validation passed (${blurCount} backdrop-filter declarations).`);
