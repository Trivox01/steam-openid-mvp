import type { NavigationView, PageId } from "../../types";

export const navigationItems: readonly PageId[] = [
  "dashboard", "games", "achievements", "activity", "statistics", "tools", "developer", "settings"
];

export function activeNavigationPage(view: NavigationView, fallback: PageId): PageId {
  if (view.kind === "game") return "games";
  if (view.kind === "achievement") return "achievements";
  if (view.kind === "tool") return "tools";
  return view.kind === "page" ? view.page : fallback;
}

export function isNavigationItemActive(item: PageId, active: PageId) {
  return item === active;
}
