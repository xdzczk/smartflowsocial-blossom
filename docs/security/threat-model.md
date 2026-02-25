# Threat Model

## Assets

- Upload blobs and metadata.
- Upload tokens and internal service secrets.
- Commit reconciliation queue state.

## Trust Boundaries

- Public API boundary (`PUT /upload`, `HEAD`, `DELETE`).
- Internal API boundary (`/internal/blob/:key`, policy and commit callbacks).
- Storage boundary (Cloudflare R2).

## Primary Threats

- Token forgery or replay.
- Unauthorized internal endpoint access.
- Oversized or malformed uploads for resource exhaustion.
- Dependency outages causing stale reconciliation and degraded availability.

## Existing Controls

- Upload token signature verification and replay protection (JTI).
- Rate limiting and size guards.
- Internal secret checks for privileged operations.
- Reconciliation with retry backoff for commit callbacks.
