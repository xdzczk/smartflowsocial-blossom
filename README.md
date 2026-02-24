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

| Variable                 | Required | Default                            | Description                                                                           |
| ------------------------ | -------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| `DB_PATH`                | Yes      | —                                  | Directory for the SQLite database file                                                |
| `R2_BUCKET`              | Yes      | —                                  | R2 bucket name                                                                        |
| `R2_ENDPOINT`            | Yes      | —                                  | R2 endpoint URL (e.g. `https://<account>.r2.cloudflarestorage.com`)                   |
| `R2_ACCESS_KEY_ID`       | Yes      | —                                  | R2 access key ID                                                                      |
| `R2_SECRET_ACCESS_KEY`   | Yes      | —                                  | R2 secret access key                                                                  |
| `PORT`                   | No       | `5050`                             | HTTP server port                                                                      |
| `AUTH_TOLERANCE_SECONDS` | No       | `0`                                | Clock skew tolerance for Blossom auth (seconds)                                       |
| `BLOSSOM_PUBLIC_URL`     | No       | `https://blossom.smartflow.social` | Base URL returned in upload responses for blob URLs                                   |
| `SFS_INTERNAL_URL`       | No       | —                                  | SmartFlow internal API base URL for subscription checks                               |
| `SFS_INTERNAL_SECRET`    | No       | —                                  | Secret for `x-internal-secret` when calling SFS                                       |
| `NODE_ENV`               | No       | `development`                      | Environment name                                                                      |
| `NATIVE_BINDINGS_PATH`   | No       | —                                  | Path to directory containing `arm64/` or `x64/better_sqlite3.node` for better-sqlite3 |

If `SFS_INTERNAL_URL` or `SFS_INTERNAL_SECRET` is missing, subscription checks are skipped and
uploads are rejected (403) unless you change the code.

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

Uploads are rate-limited in memory: **10 uploads per minute per pubkey**. The limit is per process;
with multiple instances, each has its own counter. Expired windows are cleaned up periodically. For
multi-instance–shared limits, you would need an external store (e.g. Redis) and is not implemented
here.

### Reverse proxy

If you use Nginx or similar, increase the max body size (e.g. 250MB) so large uploads do not fail.

## API

- **PUT /upload** — Blossom auth required; `t` tag must be `upload`; subscription must be active;
  body is the blob; `x` tag must be the SHA-256 hash of the body. Response includes `url`, `x`,
  `size`, `m`.
- **HEAD /:key** — Returns 200 with `Content-Type` and `Content-Length` if the blob exists, 404
  otherwise. No auth.
- **DELETE /:key** — Blossom auth required; `t` tag must be `delete`; only the owning pubkey can
  delete.

## License

MIT.
