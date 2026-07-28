import type { NavigationView, PageId } from "../../types";

export const navigationItems: readonly PageId[] = [
  "dashboard", "games", "achievements", "activity", "statistics", "settings"
];

export function activeNavigationPage(view: NavigationView, fallback: PageId): PageId {
  if (view.kind === "game") return "games";
  if (view.kind === "achievement") return "achievements";
  return view.page ?? fallback;
}

export function isNavigationItemActive(item: PageId, active: PageId) {
  return item === active;
}
