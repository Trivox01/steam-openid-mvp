# Badge assignment policy

Badge assignments link the internal PostgreSQL `users.id` to a badge
definition. SteamID64 is an authentication identity and is not the assignment
foreign key.

## Grant rules

- Administrative grants use `source=manual`.
- The target user and badge must already exist.
- Archived, inactive, not-yet-started, and expired badges cannot be granted.
- A badge whose `grant_mode` is `automatic` cannot be granted through the
  administrative manual endpoint.
- `is_visible` controls public presentation and does not affect eligibility.
- Only one active assignment may exist for a user and badge. PostgreSQL
  enforces this with a partial unique index.

## Revocation and re-grant

Revocation is soft. It records the revoking internal user, timestamp, and
optional reason while retaining the original assignment history.

After revocation, the badge may be granted again by creating a new assignment.
The revoked row is never reactivated or overwritten.

## Trust and privacy boundaries

The Backend evaluates permissions and assignment eligibility. Clients cannot
choose assignment source or submit metadata. Assignment and revocation reasons
are trimmed, length-bounded, and reject raw HTML.

Audit metadata is limited to internal assignment, user, and badge identifiers,
source, reason presence, and stable denial codes. Session tokens, OpenID
payloads, Steam credentials, storage credentials, database URLs, and arbitrary
client metadata are prohibited.
