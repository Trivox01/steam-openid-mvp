# Persistent desktop sessions

Achievement Nexus keeps the existing 15-minute bearer access token and uses a
separate, rotating desktop credential with a 30-day absolute lifetime.

## Server model

- Migration `017_persistent_desktop_sessions.sql` adds session family, rotation,
  revocation, expiry, and `session_epoch` linkage.
- PostgreSQL stores only a SHA-256 digest of the credential. It stores neither
  the bearer token nor the raw desktop credential.
- Credentials contain a UUID and a 256-bit HMAC-SHA-256 value. The HMAC uses
  the fixed `desktop-session\0` purpose prefix before the session id, family id,
  and generation. This explicitly separates desktop credential derivation from
  access-token signing while retaining the existing strong server root secret.
- Refresh rotation locks the predecessor row and creates one child atomically.
- A duplicate predecessor is idempotent for eight seconds. This narrow window
  covers a concurrent request or lost response; later reuse revokes the family.
- Every refresh re-reads `account_status` and `session_epoch` from the users
  table. A status block returns the existing opaque `ACCOUNT_NOT_ACTIVE` code.
- At most five active session families are retained per user. A sixth login
  revokes the oldest family.
- Cleanup is bounded and opportunistic: login requests may delete at most 100
  expired or long-revoked rows older than the seven-day retention boundary.

## Windows storage and dependencies

The raw desktop credential is stored as a Windows Generic Credential under
`AchievementNexus/DesktopSession`. It is never written to browser storage,
SQLite, a JSON configuration file, or the JavaScript bundle. Rotation is
performed inside a Rust command, so only the initial OpenID completion briefly
passes the raw value through JavaScript before it is handed to the OS store.

- `windows-sys` 0.61.2 (MIT OR Apache-2.0) provides direct, maintained Windows
  Credential Manager FFI without an additional storage format.
- `reqwest` 0.13.4 (MIT OR Apache-2.0) performs bounded HTTPS refresh/logout
  calls in Rust so rotated credentials do not return to JavaScript.

Network failures preserve the credential. A definitive 401 or 403 deletes it.
Logout deletes it before the best-effort server revoke request.

## Safe local diagnostics

Development and explicitly marked functional E2E builds emit structured session
events with a random boot id, operation id, process id, timestamp, event, and an
allow-listed trigger or logout reason. The schema has no free-text field and
cannot contain credentials, fingerprints, token hashes, access tokens,
authorization headers, cookies, database URLs, or service secrets. A confirmed
Change Account action is recorded as `change_account`, so it cannot be mistaken
for a second automatic restore.

The silent-restore acceptance procedure is documented in
`docs/testing/DESKTOP_SILENT_RESTORE_E2E.md`. Any logout, Change Account, or new
sign-in invalidates that run instead of being classified as double restore.

## Deployment order

Do not deploy the backend code before its schema exists. The storage factory's
startup runner can apply migration 017 and then validates `desktop_sessions`;
startup fails closed when the database role cannot migrate or the resulting
schema is absent or invalid.

Required order:

1. Back up the authorized PostgreSQL environment.
2. Apply migration 017.
3. Verify the migration table, columns, constraints, and indexes.
4. Deploy the backend that contains the desktop-session routes.
5. Smoke-test login, refresh, logout, blocked account, and restart restore.
6. Build the desktop beta only after the backend smoke tests pass.
