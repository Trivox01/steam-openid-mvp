// Refresh protocol classification for persistent desktop sessions.
//
// The protocol a session was issued under is persisted on the session row
// itself. It is never derived from a deployment timestamp, a migration
// timestamp, an environment variable, a user agent, or a desktop version:
// under a zero-downtime rollout the previous backend keeps serving traffic
// while the new schema is already applied, so only per-session state can
// classify a session correctly.
export const LEGACY_REFRESH_PROTOCOL_VERSION = 1;
export const MODERN_REFRESH_PROTOCOL_VERSION = 2;

// Historical rotation grace restored from 7be4527 desktopSessionPolicy.
export const LEGACY_REFRESH_ROTATION_GRACE_MS = 8_000;

export type RefreshProtocolVersion = 1 | 2;

// Mirrors the database column semantics: smallint NOT NULL DEFAULT 1. A row
// written by a backend that predates the column carries no value, and such a
// row is legacy by definition, exactly like the DB default. Any unrecognised
// value is treated as legacy rather than silently promoted to modern, so the
// stricter modern protocol is never claimed on the strength of a bad value.
export function normalizeRefreshProtocolVersion(value: unknown): RefreshProtocolVersion {
  return Number(value) === MODERN_REFRESH_PROTOCOL_VERSION
    ? MODERN_REFRESH_PROTOCOL_VERSION
    : LEGACY_REFRESH_PROTOCOL_VERSION;
}

export function isLegacyRefreshProtocol(value: unknown) {
  return normalizeRefreshProtocolVersion(value) === LEGACY_REFRESH_PROTOCOL_VERSION;
}
