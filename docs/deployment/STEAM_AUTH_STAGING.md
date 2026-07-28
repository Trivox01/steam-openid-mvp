# Steam authentication staging deployment

## Prerequisites

- a real public DNS hostname controlled by the project;
- a valid publicly trusted TLS certificate;
- a supported Node.js runtime with the repository dependencies installed;
- a dedicated PostgreSQL database and least-privilege application role;
- a trusted reverse proxy or load balancer;
- a secret manager for database credentials and `SESSION_SECRET`.

The logical target is `auth-staging.achievementnexus.app`, but this runbook does not claim that
the hostname, DNS, certificate, or service currently exists.

## Required environment

```text
NODE_ENV=staging
PORT=<internal-listen-port>
PUBLIC_BASE_URL=https://<actual-staging-host>
OPENID_REALM=https://<actual-staging-host>/
OPENID_RETURN_URL=https://<actual-staging-host>/v1/auth/steam/callback
DATABASE_URL=<secret PostgreSQL connection URL>
AUTH_STORAGE_DRIVER=postgres
SESSION_SECRET=<at least 32 random characters from the secret manager>
LOG_LEVEL=info
TRUST_PROXY=true
ALLOWED_ORIGINS=<comma-separated HTTPS origins, or empty>
```

Never commit actual values. Use PostgreSQL TLS with certificate verification appropriate to the
provider, preferably `sslmode=verify-full` or its provider-supported equivalent.

## DNS, TLS, and reverse proxy

1. Point the selected DNS hostname to the staging ingress.
2. Terminate TLS using a publicly trusted certificate and disable obsolete protocols/ciphers.
3. Proxy only to the service's private `127.0.0.1:<PORT>` listener.
4. Overwrite—not append—`X-Forwarded-Proto` with `https` and `X-Forwarded-Host` with the public
   hostname.
5. Strip client-supplied forwarded headers before adding trusted values.
6. Apply body, request, connection, and timeout limits at the edge.
7. Do not log callback query strings.
8. Do not derive realm or return URL from request headers.

The current server binds plain HTTP to loopback only, so staging and production configuration
requires `TRUST_PROXY=true` and a trusted TLS-terminating proxy. Direct public HTTP is unsupported.

## Database and migrations

The process connects to PostgreSQL, obtains an advisory migration lock, applies versioned SQL
migrations transactionally, validates required columns, and only then starts HTTP listening.
There is no fallback from PostgreSQL to memory in staging or production.

The application role needs DDL permission during migration. A stricter deployment may run
migrations with a separate role, but startup validation must still succeed before traffic is
enabled.

Back up the database before schema changes. SteamID is a personal identifier and access to
`auth_transactions` must be restricted. Assertions, raw nonces, poll secrets, API keys, and
tokens are not stored.

## Build and startup

```text
npm ci
npm run typecheck:backend
npm run test:backend-auth
npm run test:backend-postgres
npm --prefix services/auth-api start
```

`test:backend-postgres` requires `TEST_DATABASE_URL` pointing to an isolated database where the
test role can create and drop a uniquely named schema.

## Health and readiness

- `GET /health`: confirms the Node process responds.
- `GET /ready`: validates repository/schema availability and returns only `ready` or a generic
  storage error.

The load balancer should use `/ready` for traffic admission and `/health` for process liveness.
Neither endpoint exposes connection strings, internal hosts, SQL, or secrets.

## Cleanup and retention

A non-blocking bounded cleanup runs every 15 minutes:

- pending transactions are marked expired after their deadline;
- nonce hashes are removed after their replay-protection expiry;
- terminal transaction metadata is retained for no more than approximately 24 hours.

The job processes bounded batches and logs only a safe failure code.

## Live acceptance

Set `STEAM_OPENID_TEST_BASE_URL` locally to the real HTTPS staging origin, then run:

```text
npm run steam-openid:live-test
```

The script is disabled in CI. It prints the public request ID, polling interval, and Steam login
URL, keeps the poll secret only in process memory, and never displays SteamID. Open the URL in
the external browser and execute the acceptance matrix in
`docs/security/STEAM_OPENID_SECURITY_GATE.md`.

## Logs and monitoring

- Disable query-string access logging for the callback path.
- Do not log request bodies or database URLs.
- Alert on readiness failures, repeated migration failure, cleanup failure, elevated 429/5xx,
  and Steam verification latency.
- Verify hosting-platform logs and APM configuration also redact URL queries.

## Backup, rollback, and rotation

- Use encrypted PostgreSQL backups with tested restoration and restricted retention.
- Roll back application deployment independently; migrations in this phase are additive.
- Never edit an applied migration. Restore from backup or ship a new forward migration.
- Rotate database credentials and `SESSION_SECRET` through the secret manager, then restart
  instances in a controlled rollout.
- A `SESSION_SECRET` rotation has no user-session impact in Phase 2.5 because sessions are not
  implemented.

Deployment is incomplete until DNS, TLS, PostgreSQL tests, readiness, logs, and live Steam login
are verified on the actual staging environment.
