type Listener = () => void;
const libraryListeners = new Set<Listener>();
const publicBadgeListeners = new Set<() => void | Promise<void>>();

export function subscribeToLibraryChanges(listener: Listener) {
  libraryListeners.add(listener);
  return () => libraryListeners.delete(listener);
}

export function publishLibraryChange() {
  libraryListeners.forEach((listener) => listener());
}

export function subscribeToPublicBadgeChanges(
  listener: () => void | Promise<void>
) {
  publicBadgeListeners.add(listener);
  return () => publicBadgeListeners.delete(listener);
}

export async function publishPublicBadgeChange() {
  await Promise.all([...publicBadgeListeners].map((listener) => listener()));
}
