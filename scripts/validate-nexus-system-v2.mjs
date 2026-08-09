import { readFile } from "node:fs/promises";

const [css, topbar, toolCard, toolDetails, gameCard, gameButton, developerPage] = await Promise.all([
  readFile(new URL("../src/styles/nexus-system-v2.css", import.meta.url), "utf8"),
  readFile(new URL("../src/components/layout/Topbar.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/tools/ToolCard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/ToolDetailsPage.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/games/GameCard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/games/GameActionButton.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/DeveloperCenterPage.tsx", import.meta.url), "utf8"),
]);

const checks = [
  ["spacing scale", [4, 8, 12, 16, 20, 24, 32, 48].every((value) => css.includes(`${value}px;`))],
  ["compact sidebar widths", css.includes("--nx-sidebar-expanded: 220px") && css.includes("--nx-sidebar-collapsed: 68px")],
  ["compact topbar height", css.includes("--nx-topbar-height: 60px")],
  ["bounded Tools card grid", css.includes("minmax(min(100%, 260px), 318px)") && css.includes("justify-content: start")],
  ["16:9 Tools artwork", css.includes("aspect-ratio: 16 / 9")],
  ["solid Tools content surfaces", css.includes(".tool-card,") && css.includes("backdrop-filter: none")],
  ["compact Tool Details hero", css.includes("min-height: 310px")],
  ["reduced motion support", css.includes("prefers-reduced-motion")],
  ["forced-colors support", css.includes("forced-colors")],
  ["NEXUS SYSTEM shell context", topbar.includes("NEXUS SYSTEM") && topbar.includes("activePage")],
  ["bounded card badges", toolCard.includes("shownBadges") && toolCard.includes("hiddenBadges")],
  ["mixed-direction Tool copy", toolCard.includes('dir="auto"') && toolDetails.match(/dir="auto"/g)?.length >= 2],
  ["always-visible game action", gameCard.includes("nexus-game-card__primary-action") && gameButton.includes('?"card":"hero"')],
  ["compact card action density", css.includes(".nexus-game-card__primary-action") && css.includes("inline-size: 38px") && css.includes(".nexus-shiny-button__label { display: none")],
  ["compact empty Tool sections", toolDetails.includes("hasRatings") && toolDetails.includes("hasReviews && <div className=\"tool-reviews-toolbar\"") && css.includes(".tool-details__reviews.is-empty")],
  ["dashboard density checkpoint", css.includes("min-block-size: clamp(180px, 16vw, 220px)") && css.includes("min-block-size: 180px")],
  ["statistics density checkpoint", css.includes("min-block-size: 88px") && css.includes("nth-child(n + 5)")],
  ["settings density checkpoint", css.includes("min-block-size: 52px") && css.includes(".settings-section { padding: 16px")],
  ["available Developer sections not marked planned", developerPage.includes("originallyDisabled && id !== \"users\" && id !== \"assignments\"")],
];

const failed = checks.filter(([, passed]) => !passed);
if (failed.length > 0) {
  console.error(`Nexus System UI validation failed: ${failed.map(([name]) => name).join(", ")}`);
  process.exit(1);
}

console.log(`Nexus System UI validation passed (${checks.length} checks).`);
