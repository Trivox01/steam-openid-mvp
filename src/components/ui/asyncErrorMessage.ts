import { isAsyncErrorCategory, type AsyncErrorCategory } from "../../hooks/asyncErrorCategory.ts";

/**
 * The single place where an internal failure category becomes user-facing text.
 *
 * Pages call this instead of rendering `state.error`, which is why a backend
 * message, an exception string or a parser path can no longer reach the screen.
 * An unrecognised category falls back to the generic key rather than being shown.
 */
const MESSAGE_KEYS: Record<AsyncErrorCategory, string> = {
  network: "state.offline",
  unauthorized: "state.sessionExpired",
  forbidden: "state.notAllowed",
  account_not_active: "state.notAllowed",
  malformed: "state.dataUnavailable",
  server: "state.serverBusy",
  domain: "state.loadFailed",
  unknown: "state.loadFailed"
};

export function asyncErrorMessageKey(error: unknown, fallbackKey = "state.loadFailed") {
  return isAsyncErrorCategory(error) ? MESSAGE_KEYS[error] : fallbackKey;
}
