# SmartFlow Blossom Gateway

Production-ready, Blossom-compatible media gateway for SmartFlowSocial.

This service accepts authenticated uploads, validates payload integrity, stores media in Cloudflare
R2, and synchronizes authoritative upload events to SmartFlow internal services. It also supports a
compatibility lane for Blossom clients that do not yet provide SmartFlow upload tokens.

## Why This Exists

- Provide a lightweight, dedicated media ingestion service.
- Enforce security and subscription policy at upload time.
- Keep blob storage in R2 while maintaining reliable internal commit semantics.
- Offer compatibility for existing Blossom ecosystem clients.

## Core Capabilities

- Dual upload lanes:
  - **Authoritative lane** via `X-SFS-Upload-Token`
  - **Compatibility lane** via Blossom auth only (policy-gated)
- Streamed upload with SHA-256 verification and MIME enforcement.
- Replay protection using token JTI persistence.
- Retryable commit reconciliation for upstream callback failures.
- Health/readiness endpoints and Prometheus-style metrics output.

## Architecture at a Glance

```mermaid
flowchart TD
  client[Client] --> gateway[Gateway API]
  gateway --> auth[Auth and Token Validation]
  gateway --> policy[Compat Policy Check]
  gateway --> r2[Cloudflare R2]
  gateway --> sqlite[SQLite Metadata DB]
  gateway --> commit[Commit Batch Callback]
  commit --> smartflow[SmartFlow Internal Services]
```

## Requirements

- Node.js `>=20`
- `pnpm` (project uses `pnpm@10.27.0`)
- Cloudflare R2 bucket + credentials
- Optional SmartFlow internal endpoints (commit/policy) for full authoritative behavior

## Quick Start

```bash
pnpm install
cp .env.example .env
# edit .env
pnpm build
pnpm start
```

Service defaults to port `5050`.

## Local Development

```bash
pnpm dev
```

Validation and test commands:

```bash
pnpm validate
pnpm test
pnpm test:coverage
pnpm test:unit
pnpm test:integration
pnpm test:security
pnpm test:property
pnpm test:performance
```

## Configuration

### Required Variables

| Variable                  | Description                                                                      |
| ------------------------- | -------------------------------------------------------------------------------- |
| `DB_PATH`                 | Directory containing the SQLite DB file.                                         |
| `R2_BUCKET`               | R2 bucket name.                                                                  |
| `R2_ENDPOINT`             | R2 API endpoint (for example `https://<account>.r2.cloudflarestorage.com`).      |
| `R2_ACCESS_KEY_ID`        | R2 access key ID.                                                                |
| `R2_SECRET_ACCESS_KEY`    | R2 secret access key.                                                            |
| `SFS_UPLOAD_TOKEN_SECRET` | HMAC secret for upload token verification. Must not match `SFS_INTERNAL_SECRET`. |

### Important Optional Variables

| Variable                                | Default                            | Description                                       |
| --------------------------------------- | ---------------------------------- | ------------------------------------------------- |
| `PORT`                                  | `5050`                             | HTTP listen port.                                 |
| `AUTH_TOLERANCE_SECONDS`                | `0`                                | Allowed auth clock skew in seconds.               |
| `BLOSSOM_PUBLIC_URL`                    | `https://blossom.smartflow.social` | Base URL returned in upload responses.            |
| `SFS_INTERNAL_URL`                      | empty                              | Base URL for internal SmartFlow callbacks.        |
| `SFS_INTERNAL_SECRET`                   | empty                              | Shared secret for internal endpoints.             |
| `SFS_COMMIT_BATCH_URL`                  | derived                            | Commit callback endpoint.                         |
| `SFS_COMMIT_MAX_ATTEMPTS`               | `10`                               | Max retries before dead-lettering failed commits. |
| `SFS_POLICY_URL`                        | derived                            | Compatibility policy endpoint.                    |
| `SFS_POLICY_CACHE_TTL_SEC`              | `90`                               | Compat policy cache TTL seconds.                  |
| `SFS_COMPAT_MODE_ENABLED`               | `true`                             | Enable compatibility upload lane.                 |
| `SFS_COMPAT_MAX_UPLOAD_BYTES`           | `52428800`                         | Max bytes for compat lane (50MB default).         |
| `SFS_READINESS_MAX_PENDING_COMMITS`     | `1000`                             | Readiness threshold for retryable commit backlog. |
| `SFS_READINESS_MAX_DEAD_LETTER_COMMITS` | `0`                                | Readiness threshold for dead-lettered commits.    |
| `RATE_LIMIT_MODE`                       | `local`                            | `local` (in-process) or `redis` (distributed).    |
| `RATE_LIMIT_REDIS_URL`                  | empty                              | Redis URL used when `RATE_LIMIT_MODE=redis`.      |
| `RATE_LIMIT_REDIS_KEY_PREFIX`           | `sfs:rl`                           | Prefix for Redis rate-limit keys.                 |
| `RATE_LIMIT_*`                          | varies                             | Upload/IP/byte token-bucket limits.               |
| `METRICS_TOKEN`                         | empty                              | Token gate for `/metrics` access.                 |
| `METRICS_ALLOWLIST`                     | empty                              | Comma-separated IP allowlist for `/metrics`.      |
| `NATIVE_BINDINGS_PATH`                  | empty                              | Optional path to better-sqlite3 native bindings.  |

See `.env.example` for the full list.

## API

### `PUT /upload`

Upload endpoint with two modes:

- **Authoritative lane**
  - Requires `X-SFS-Upload-Token`
  - Optionally accepts Blossom auth header (must match token subject if present)
  - Validates hash/size/type expectations from token context
  - Persists blob metadata and enqueues authoritative commit

- **Compatibility lane**
  - No upload token header
  - Requires valid Blossom auth
  - Policy-gated via internal policy endpoint
  - Uses stricter size/rate controls
  - Stores compat metadata only

Response includes:

- `url`
- `sha256`
- `size`
- `type`
- compatibility keys `x` and `m`

### `HEAD /:key`

Returns object metadata if present:

- `200` with `Content-Type` and `Content-Length`
- `404` if missing

### `DELETE /:key`

- Requires Blossom auth with `t=delete`
- Delete allowed only for object owner pubkey
- Returns `204`

### `DELETE /internal/blob/:key`

- Internal/admin delete path
- Requires `x-internal-secret`
- Returns success payload

### Operational Endpoints

- `GET /health` - liveness
- `GET /ready` - dependency-aware readiness (DB, storage, policy status, backlog)
- `GET /metrics` - Prometheus-style metrics; open by default only in dev/test when no
  token/allowlist is configured

## Security Model

- Upload token and internal secret are explicitly separated.
- JTI replay protection is persisted in SQLite.
- Integrity validation includes streamed SHA-256 checks.
- MIME validation restricts uploads to image/video classes.
- Metrics endpoint is deny-by-default in production unless `METRICS_TOKEN` or `METRICS_ALLOWLIST` is
  set.

More:

- `SECURITY.md`
- `docs/security/threat-model.md`
- `docs/security/operational-security-checklist.md`

## Reliability and Operations

- Commit callbacks are retried via durable reconciliation queue.
- Commits that exceed retry attempts move to dead-letter state for operator action.
- Graceful shutdown flushes commit state before exit (with timeout guard).
- Readiness reflects operational dependency health, not process liveness only.
- Reconciliation commit payloads are chunked by `SFS_COMMIT_BATCH_SIZE` per `batchId`.

## Deployment Notes

- `RATE_LIMIT_MODE=local` uses in-memory token buckets and is per-instance.
- If running multiple gateway instances, use upstream global throttling (WAF/LB/API gateway) for
  hard limits.
- `RATE_LIMIT_MODE=redis` requires `RATE_LIMIT_REDIS_URL`; startup fails fast if missing or
  unreachable.

## Active Runtime Surface

- Production build/serve path is `src/index.ts` -> `src/server.ts` -> `build/index.js`.
- Root-level legacy files (for example `index.ts`, `routes/*`, `listener/*`, `exchange/*`) are not
  part of the current production entrypoint.
- Prefer making gateway changes under `src/` and `tests/`.

Runbooks and SLOs:

- `docs/slo-and-ops.md`
- `docs/ops/slos.md`
- `docs/ops/runbook.md`
- `docs/ops/backup-recovery.md`

## CI/CD and Quality Gates

Repository includes workflows for:

- CI quality gates
- PR checks
- coverage reporting
- matrix testing
- flaky test detection
- release security checks
- container image build/publish

Each PR is expected to pass lint, typecheck, tests, and coverage constraints.

## Contributing

See:

- `CONTRIBUTING.md`
- `docs/development/developer-guide.md`
- `docs/architecture/boundaries.md`
- `docs/meta/style-guide.md`

## License

MIT
