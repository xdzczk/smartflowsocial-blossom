# Operational Security Checklist

## Pre-Deploy

- Confirm `SFS_UPLOAD_TOKEN_SECRET` and `SFS_INTERNAL_SECRET` are distinct.
- Confirm `METRICS_TOKEN` is set for non-private deployments.
- Confirm image scan and dependency audit passed in release workflow.

## Post-Deploy

- Verify `/health` and `/ready` return expected status.
- Verify `/metrics` is not publicly accessible without token/allowlist.
- Verify baseline request/error metrics are flowing.

## Ongoing

- Rotate secrets at least quarterly.
- Review dependency update PRs weekly.
- Run flaky/performance workflows before major infrastructure changes.
