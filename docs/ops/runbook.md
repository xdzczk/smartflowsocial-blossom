# Operations Runbook

## Primary Signals

- `/ready` dependency checks.
- `gateway_http_requests_total` for request status distribution.
- `gateway_http_request_duration_ms` histogram for latency trend.
- `gateway_pending_commits` gauge for reconciliation pressure.

## Incident Triage

1. Verify `/ready` payload and identify failing dependency check.
2. Inspect recent logs for `upload_failed`, `Commit flush failed`, and policy/commit upstream
   warnings.
3. Confirm SmartFlow internal endpoint reachability and shared secret alignment.
4. If metrics endpoint is unavailable, inspect service process logs and restart behavior.

## Mitigation Actions

- High backlog: scale instance count and confirm commit endpoint health.
- Policy unavailable: preserve fail-closed compat lane and communicate degraded compatibility flow.
- Elevated 5xx rate: identify most frequent route and error code labels, then roll back recent
  deployment if needed.
