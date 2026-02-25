# SmartFlow Blossom Gateway

A minimal [Blossom](https://github.com/hzrd149/blossom)-compatible media gateway for
SmartFlowSocial. It stores blobs in Cloudflare R2 and gates uploads on an external subscription
check. Authentication uses Nostr Blossom auth (kind 24242). This gateway can be used as the backend
for products like Satellite CDN.

## Requirements

- Node.js >= 20
- [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) bucket and API credentials
- (Optional) SmartFlow subscription service for upload gating

## Quick start

```bash
pnpm install
cp .env.example .env   # edit with your values
pnpm build
pnpm start
```

## Environment variables

| Variable                            | Required | Default                                             | Description                                                                                                                    |
| ----------------------------------- | -------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `DB_PATH`                           | Yes      | —                                                   | Directory for the SQLite database file                                                                                         |
| `R2_BUCKET`                         | Yes      | —                                                   | R2 bucket name                                                                                                                 |
| `R2_ENDPOINT`                       | Yes      | —                                                   | R2 endpoint URL (e.g. `https://<account>.r2.cloudflarestorage.com`)                                                            |
| `R2_ACCESS_KEY_ID`                  | Yes      | —                                                   | R2 access key ID                                                                                                               |
| `R2_SECRET_ACCESS_KEY`              | Yes      | —                                                   | R2 secret access key                                                                                                           |
| `PORT`                              | No       | `5050`                                              | HTTP server port                                                                                                               |
| `AUTH_TOLERANCE_SECONDS`            | No       | `0`                                                 | Clock skew tolerance for Blossom auth (seconds)                                                                                |
| `BLOSSOM_PUBLIC_URL`                | No       | `https://blossom.smartflow.social`                  | Base URL returned in upload responses for blob URLs                                                                            |
| `SFS_INTERNAL_URL`                  | No\*     | —                                                   | SmartFlow app base URL for commit callbacks (e.g. `https://app.smartflow.social`). Must be reachable from this server.         |
| `SFS_INTERNAL_SECRET`               | No\*     | —                                                   | Must match SmartFlow app env `BLOSSOM_INTERNAL_SECRET`. Used for internal commit auth header.                                  |
| `SFS_UPLOAD_TOKEN_SECRET`           | No\*     | `SFS_INTERNAL_SECRET`                               | HMAC secret used to verify `X-SFS-Upload-Token` JWTs. Must match SmartFlow `BLOSSOM_UPLOAD_TOKEN_SECRET` (or fallback secret). |
| `SFS_COMMIT_BATCH_URL`              | No       | `${SFS_INTERNAL_URL}/internal/blossom/commit-batch` | Internal SmartFlow commit endpoint.                                                                                            |
| `SFS_COMMIT_BATCH_SIZE`             | No       | `20`                                                | Buffered commit flush threshold (items).                                                                                       |
| `SFS_COMMIT_FLUSH_MS`               | No       | `2000`                                              | Buffered commit flush interval (milliseconds).                                                                                 |
| `SFS_POLICY_URL`                    | No       | `${SFS_INTERNAL_URL}/internal/blossom/policy`       | Internal SmartFlow policy endpoint for compatibility lane plan gating.                                                         |
| `SFS_POLICY_CACHE_TTL_SEC`          | No       | `90`                                                | In-memory cache TTL (seconds) for compat policy lookups.                                                                       |
| `SFS_COMPAT_MODE_ENABLED`           | No       | `true`                                              | Allow compatibility uploads with Blossom auth and no `X-SFS-Upload-Token` (non-authoritative lane).                            |
| `SFS_COMPAT_MAX_UPLOAD_BYTES`       | No       | `52428800`                                          | Max bytes accepted by compatibility lane (`50MB`, hard-capped by server max).                                                  |
| `RATE_LIMIT_UPLOADS_BURST`          | No       | `20`                                                | Uploads token-bucket burst per pubkey.                                                                                         |
| `RATE_LIMIT_UPLOADS_PER_MIN`        | No       | `10`                                                | Uploads token-bucket refill rate per minute per pubkey.                                                                        |
| `RATE_LIMIT_BYTES_BURST`            | No       | `524288000`                                         | Bytes token-bucket burst per pubkey.                                                                                           |
| `RATE_LIMIT_BYTES_PER_MIN`          | No       | `209715200`                                         | Bytes token-bucket refill rate per minute per pubkey.                                                                          |
| `RATE_LIMIT_IP_UPLOADS_PER_MIN`     | No       | `120`                                               | Cheap IP pre-limit per minute.                                                                                                 |
| `RATE_LIMIT_COMPAT_UPLOADS_BURST`   | No       | `10`                                                | Compatibility lane upload burst per pubkey.                                                                                    |
| `RATE_LIMIT_COMPAT_UPLOADS_PER_MIN` | No       | `6`                                                 | Compatibility lane upload refill per minute per pubkey.                                                                        |
| `RATE_LIMIT_COMPAT_BYTES_BURST`     | No       | `157286400`                                         | Compatibility lane bytes burst (`150MB`) per pubkey.                                                                           |
| `RATE_LIMIT_COMPAT_BYTES_PER_MIN`   | No       | `62914560`                                          | Compatibility lane bytes refill (`60MB/min`) per pubkey.                                                                       |
| `NODE_ENV`                          | No       | `development`                                       | Environment name                                                                                                               |
| `NATIVE_BINDINGS_PATH`              | No       | —                                                   | Path to directory containing `arm64/` or `x64/better_sqlite3.node` for better-sqlite3                                          |

For Blossom v2 token + commit flow, configure **both** `SFS_INTERNAL_SECRET` and a shared token
secret (`SFS_UPLOAD_TOKEN_SECRET` or fallback `SFS_INTERNAL_SECRET`) plus `SFS_INTERNAL_URL`. If
commit endpoint configuration is missing/unreachable, uploads are accepted and queued for
reconciliation retries.

## Operations

### Running

- **Build:** `pnpm build` — compiles TypeScript to `build/index.js`
- **Start:** `pnpm start` — runs the server (requires env to be set)
- **Dev:** `pnpm dev` — build in watch mode (no auto-restart of node)

### Health and readiness

- **GET /health** — Liveness probe. Always returns 200 when the process is up.
- **GET /ready** — Readiness probe. Returns 200 if the database is responsive, 503 otherwise. Use
  for load balancers and orchestrators.

### Rate limiting

Uploads use in-memory token buckets:

- Per-pubkey uploads/min (burst + refill)
- Per-pubkey bytes/min (burst + refill)
- Separate per-pubkey buckets for compatibility lane
- Cheap IP uploads/min pre-check

Limits are currently per-process; multi-instance shared limiting requires an external store.

### Reverse proxy

If you use Nginx or similar, increase the max body size (e.g. 250MB) so large uploads do not fail.

## API

- **PUT /upload** — dual lane behavior:
  - **Authoritative lane**: include `X-SFS-Upload-Token` (optional Blossom auth header). Token is
    validated, upload is streamed + SHA-256 verified, object stored to R2, commit buffered to
    SmartFlow `/internal/blossom/commit-batch`, quota/accounting authoritative.
  - **Compatibility lane**: no token, valid Blossom auth required; upload is accepted under stricter
    compat limits, internal plan policy gate, and persisted as non-authoritative compat metadata.
    Free/inactive users are denied with `subscription_required`; policy lookup failures are
    fail-closed with `service_unavailable`. Response includes `url`, `sha256`, `x`, `size`, `type`,
    `m`.
- **HEAD /:key** — Returns 200 with `Content-Type` and `Content-Length` if the blob exists, 404
  otherwise. No auth.
- **DELETE /:key** — Blossom auth required; `t` tag must be `delete`; only the owning pubkey can
  delete.
- **DELETE /internal/blob/:key** — Internal server-to-server delete by key (for SmartFlow app media
  cleanup). Requires `x-internal-secret` matching `SFS_INTERNAL_SECRET`.

## License

MIT.
