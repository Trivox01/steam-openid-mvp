import { useSyncExternalStore } from "react";
import { subscribeToLibraryChanges } from "../services/dataEvents";

let revision = 0;

export function useLibraryRevision() {
  return useSyncExternalStore(
    (notify) => subscribeToLibraryChanges(() => {
      revision += 1;
      notify();
    }),
    () => revision,
    () => revision
  );
}
