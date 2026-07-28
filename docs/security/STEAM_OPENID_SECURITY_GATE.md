# Steam OpenID security gate

## Gate status

Status as of Phase 2.5 implementation: **NO-GO for Phase 3**.

The application controls are implemented and covered by local automated tests. A public staging
deployment, PostgreSQL integration run, TLS validation, and live Steam login have not occurred in
the current environment. Live acceptance must not begin until all `Deployment Required` rows are
confirmed against the real staging service.

| Control | Status | Evidence or remaining action |
| --- | --- | --- |
| Callback HTTPS | Deployment Required | Config rejects non-HTTPS; validate certificate and redirect behavior on staging. |
| Exact `return_to` | Implemented / Tested | Stored value is compared exactly before Steam verification. |
| Exact provider endpoint | Implemented / Tested | Compile-time Steam endpoint; alternate endpoint is rejected. |
| `check_authentication` | Implemented / Tested | Injected HTTP client posts signed fields with fixed verification mode. |
| Nonce freshness and replay | Implemented / Tested | Format/age checks and hashed unique reservation; PostgreSQL race test awaits a database. |
| Ten-minute transaction expiry | Implemented / Tested | Service tests cover expiry. |
| One-time callback | Implemented / Tested | Terminal state and optimistic/locked transitions reject reuse. |
| Poll-secret hashing | Implemented / Tested | 256-bit secret; only SHA-256 is persisted. |
| Timing-safe comparison | Implemented / Tested | Service comparison uses `timingSafeEqual`. |
| Logging redaction | Implemented / Tested | Structured allowlisted fields; assertions and identifiers are excluded. |
| No open redirect | Implemented / Tested | Callback HTML has no redirect; return URL is fixed environment configuration. |
| No SSRF | Implemented / Tested | Outbound target is a fixed Steam HTTPS constant; redirects are disabled. |
| Poll rate limiting | Implemented / Tested / Deployment Required | Per-process limiter exists; edge/distributed limiting must be configured for staging. |
| Secure callback headers | Implemented / Tested | CSP, no-store, no-referrer, and nosniff are asserted. |
| PostgreSQL durability | Implemented / Deployment Required | Migrations and repository exist; real integration test is pending. |
| Migration rollback and startup validation | Implemented / Deployment Required | Transactional runner and schema validation exist; real PostgreSQL evidence pending. |
| Reverse-proxy header trust | Implemented / Tested / Deployment Required | Forwarded headers accepted only with explicit trust; proxy must overwrite them. |
| Host allowlist | Implemented / Tested / Deployment Required | Exact public host is enforced in staging/production. |
| Edge abuse protection | Deployment Required | Configure request/body/connection limits at the trusted proxy. |
| Session exchange | Deferred | Phase 3; no session or token exists in Phase 2.5. |
| Steam Web API proxy/key | Deferred | Explicitly outside this phase. |
| Desktop integration | Deferred | Feature flag remains disconnected. |

## Required staging evidence

Before changing this gate to GO:

1. Record the actual staging hostname and valid TLS certificate.
2. Run migrations and `npm run test:backend-postgres` against an isolated PostgreSQL test
   database.
3. Confirm `/health` and `/ready` through the real reverse proxy.
4. Confirm proxy overwrites forwarded headers and rejects spoofed host/protocol values.
5. Run `npm run steam-openid:live-test` manually.
6. Complete success, cancellation, wrong-secret, expiry, callback replay, and log inspection.
7. Scan deployed artifacts and platform logs for secrets and personal identifiers.
8. Record owners for database backups, secret rotation, monitoring, and rollback.

No live Steam login was performed while creating this document.
