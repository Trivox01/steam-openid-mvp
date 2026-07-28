# Steam Sign-In MVP plan

## Scope and compatibility

The MVP replaces the future manual Steam credential experience with Steam OpenID 2.0 and a
service-owned Steam Web API key. The released `0.1.0-beta.1` flow is unchanged: the feature flag
is not connected to the UI, composition root, Tauri gateway, or current sync services.

Phase 2 implements backend transaction creation, the public Steam callback, assertion
verification, and desktop status polling only. It does not implement session exchange, browser
launching, desktop polling, a Steam API proxy, library or achievement sync, refresh tokens,
credential storage, production deployment, Redis, PostgreSQL, or SQLite migrations.

## Phase 2 endpoints

### `POST /v1/auth/steam/start`

Accepts an opaque `deviceId`, creates a ten-minute transaction and returns:

- a public random `authRequestId`;
- a 256-bit `pollSecret` (its SHA-256 hash is the only stored form);
- the official Steam OpenID login URL;
- transaction expiry;
- a 3,000 ms polling interval.

The login URL contains only the public transaction identifier in `openid.return_to`. It never
contains the poll secret, SteamID, API key, session token, or desktop device identifier.
The device identifier is validated and stored only as a hash for future binding work.

### `GET /v1/auth/steam/callback`

The callback accepts `cancel` or a complete `id_res` assertion. Before contacting Steam it
requires:

- OpenID 2.0 namespace;
- exact provider endpoint `https://steamcommunity.com/openid/login`;
- exact match with the transaction's stored `return_to`;
- a return URL inside the configured HTTPS realm;
- equal `claimed_id` and `identity`;
- `steamcommunity.com/openid/id/<17-digit SteamID64>` with no credentials, unexpected port,
  query, or fragment;
- a present, syntactically valid, fresh response nonce.

After local checks, all signed `openid.*` fields are posted to the fixed Steam endpoint with
`openid.mode=check_authentication`. Only the exact `is_valid:true` response is accepted.
Redirects are not followed, responses must be `text/plain`, response size is bounded, and the
request has a fixed timeout. HTTP 429, 5xx, and timeout are temporary failures and leave the
transaction pending.

Success stores SteamID64 in the server transaction and changes it to `verified`. It does not
create a session or return identity data to the browser URL or desktop status response.
The callback HTML is static and protected by no-store, no-referrer, nosniff, and restrictive CSP
headers.

### `POST /v1/auth/steam/status`

Requires the matching `authRequestId` and poll secret. It returns only:

- `pending`;
- `verified`;
- `expired`;
- `cancelled`; or
- `failed` with a stable, non-sensitive `errorCode`.

SteamID and tokens are deliberately absent. An in-memory limiter enforces the advertised
three-second polling interval.

## Replay and transaction protection

- Transactions expire after ten minutes and terminal transactions reject callbacks.
- Nonces are checked for format, age, and limited future clock skew.
- Only a SHA-256 representation of a nonce is retained.
- The repository atomically reserves nonce hashes, rejecting reuse across transactions.
- A callback cannot verify the same transaction twice.
- Network failures do not reserve the nonce or consume the transaction.
- Poll-secret comparison uses a timing-safe hash comparison.

The in-memory repository is suitable only for development and deterministic tests. Its interface
supports a future PostgreSQL implementation, where transaction and nonce reservation must be
atomic across service instances.

## Configuration and local development

Service startup requires all of:

```text
PUBLIC_BASE_URL
OPENID_REALM
OPENID_RETURN_URL
```

They must be explicit HTTPS URLs without credentials or fragments. Public base, realm, and
return URL must share an origin, and the return URL path must belong to the realm. Missing or
invalid values stop startup; there is no hidden production domain.

A real Steam callback cannot target an ordinary localhost HTTP address. Local live testing
therefore requires a trusted public HTTPS endpoint (for example a separately managed trusted
tunnel). No tunnel dependency or tunnel address is committed by Phase 2.

## Logging

Authentication logs contain only a generated request ID, endpoint category, result category,
safe error code, and duration. Request query strings, assertions, signatures, poll secrets,
hashes, response nonces, claimed IDs, SteamIDs, API keys, and session secrets are excluded.

## Current limitations and deferred decisions

- Live Steam login was not performed in Phase 2; automated tests use an injected fake verifier.
- In-memory state is lost on process restart and cannot support multiple instances.
- IP-based abuse controls and distributed limits need deployment-layer design.
- Session exchange and its future 15-minute access session are deferred to Phase 3.
- The service-owned Steam Web API key and proxy are not used until a later phase.
- Privacy text, retention policy, hosting region, production database, monitoring, and incident
  response require approval before production deployment.
- The legacy manual flow remains the only user-visible flow.

Phase 3 must not start until the Phase 2 security tests pass, the threat model is reviewed, and
the production callback domain and durable transaction store are approved.

## Phase 2.5 staging foundation

Phase 2.5 adds a PostgreSQL repository, transactional versioned migration runner, startup schema
validation, bounded retention cleanup, reverse-proxy request guards, and a storage-aware
`GET /ready` endpoint. `AUTH_STORAGE_DRIVER=memory` remains available for tests and local
scaffolding only; configuration rejects it in staging and production without fallback.

Sensitive state transitions use optimistic versions and a database transaction with row locking
and a unique nonce constraint. This prevents two service instances from verifying the same
transaction or reserving the same nonce simultaneously. SteamID is stored as a restricted
personal identifier, while raw poll secrets, assertions, raw nonces, API keys, and tokens have no
database columns.

The local live-test harness retains the poll secret in process memory and polls status without
returning SteamID. It requires an explicitly configured public HTTPS staging origin and is
disabled in CI.

The staging foundation is not acceptance evidence by itself. In the current environment there
was no `TEST_DATABASE_URL`, actual staging DNS/TLS endpoint, or deployed PostgreSQL service.
Consequently PostgreSQL integration, live Steam login, callback replay through the deployed
proxy, and platform-log inspection remain pending, and the Phase 2.5 gate remains NO-GO.
