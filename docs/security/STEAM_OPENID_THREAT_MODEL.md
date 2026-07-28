# Steam OpenID threat model

## Scope

This model covers Phase 2 transaction start, Steam OpenID callback verification, and desktop
status polling. Session exchange, Steam Web API proxying, production databases, and desktop UI
are outside this phase.

## Assets

- verified association between an auth transaction and SteamID64;
- poll secret and its stored hash;
- OpenID signed assertion and response nonce;
- transaction state and expiration;
- future service Steam Web API key and sessions;
- availability of the public authentication service.

## Trust boundaries

1. Desktop client to the public authentication API.
2. User agent redirects between the API and Steam Community.
3. Authentication API outbound verification to the fixed Steam endpoint.
4. API process to the in-memory test repository or PostgreSQL staging boundary.
5. Application logs and hosting telemetry.

The browser, desktop input, URL query, proxy headers, and network are untrusted. Steam's result is
trusted only after server-to-server `check_authentication` succeeds.

## Threats and mitigations

### Spoofing and login CSRF

An attacker may construct a claimed SteamID or complete a flow for the wrong transaction.
Mitigations are an unpredictable transaction ID, a separate 256-bit polling secret, exact stored
`return_to`, strict provider/identity validation, ten-minute expiry, and server-side Steam
verification. The desktop receives no verified identity in Phase 2. Future session exchange must
bind the device hash and preserve one-time consumption.

### Callback tampering

Modified namespace, provider, return URL, identity, claimed ID, nonce, signature, or mode is
rejected. Duplicate query keys are rejected. All signed OpenID fields are forwarded without
rewriting except the required verification mode.

### Replay

Fresh nonce validation limits the replay window. A SHA-256 nonce representation is atomically
reserved by the repository and cannot be reused by another transaction. Terminal transactions
reject callbacks. Temporary upstream failures do not reserve a nonce or consume a transaction.

### SSRF and open redirect

Outbound verification always targets the compile-time constant
`https://steamcommunity.com/openid/login`; callback input cannot select a target. Redirects are
not followed. Realm and return URL come only from validated environment configuration, use
HTTPS, share an origin, and contain no credentials or fragments. Callback HTML contains no
user-controlled redirect or active script.

### Secret and personal-data leakage

The poll secret is returned once and only its SHA-256 hash is stored. Device IDs and nonces are
stored as hashes. Structured security logs exclude request queries, assertions, signatures,
nonces, claimed IDs, SteamIDs, secrets, tokens, and API keys. Responses contain stable generic
errors. Callback pages use `no-store` and `no-referrer`.

### Denial of service

JSON bodies and Steam responses are size-bounded; upstream requests have a timeout and no
automatic retry. Polling is limited per transaction. HTTP 429 and 5xx remain temporary. Future
production deployment still needs edge request limits, connection limits, distributed rate
limiting, transaction cleanup, and capacity monitoring.

### Provider and transport compromise

HTTPS and the exact Steam hostname reduce interception and provider substitution. A compromise
of Steam, trusted certificate infrastructure, DNS/runtime networking, or the backend host remains
a residual risk.

## Residual risks and production requirements

- In-memory replay state disappears on restart and is therefore limited to local tests.
- Per-transaction limiting does not prevent distributed transaction creation abuse.
- No IP is retained by application code, but hosting providers may create access logs; retention
  and redaction must be configured and documented.
- The future session exchange requires one-time tokens, device binding, expiration, logout, and
  revocation analysis.
- PostgreSQL uses unique nonce constraints, row locking, optimistic versions, and transactional
  state changes; deployment and race-test evidence are still required.
- CSP currently allows inline style for the static callback page; removing inline style is a
  later hardening option.

Production enablement requires a reviewed HTTPS domain, durable shared storage, edge limits,
privacy/retention policy, secrets management, monitoring, and incident-response procedures.
