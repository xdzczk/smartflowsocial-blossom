# Backup and Recovery

## What to Back Up

- SQLite database directory (`DB_PATH`).
- Environment configuration secrets from deployment platform.
- Build/release metadata for reproducible rollbacks.

## Backup Frequency

- Database snapshots: hourly.
- Secret/config export: daily or after changes.
- Retention: minimum 14 days for DB snapshots.

## Recovery Procedure

1. Stop traffic to unhealthy instance(s).
2. Restore latest known-good DB snapshot to `DB_PATH`.
3. Re-apply validated environment variables and secrets.
4. Start service and verify `/health`, `/ready`, and `/metrics`.
5. Validate end-to-end flow (`upload` -> `head` -> `delete`) in staging or canary.
