type Listener = () => void;
const libraryListeners = new Set<Listener>();
const publicBadgeListeners = new Set<() => void | Promise<void>>();
const adminUserListeners = new Set<(userId?: string) => void>();

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

export function subscribeToAdminUserChanges(
  listener: (userId?: string) => void
) {
  adminUserListeners.add(listener);
  return () => adminUserListeners.delete(listener);
}

export function publishAdminUserChange(userId?: string) {
  adminUserListeners.forEach((listener) => listener(userId));
}
