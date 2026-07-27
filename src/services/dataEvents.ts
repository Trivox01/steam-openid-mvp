type Listener = () => void;
const libraryListeners = new Set<Listener>();

export function subscribeToLibraryChanges(listener: Listener) {
  libraryListeners.add(listener);
  return () => libraryListeners.delete(listener);
}

export function publishLibraryChange() {
  libraryListeners.forEach((listener) => listener());
}
