# Service Level Objectives

## Availability

- Upload API availability target: `99.9%` per rolling 30 days.
- Readiness endpoint availability target: `99.95%` per rolling 30 days.

## Latency

- `PUT /upload` p95 latency target: `< 2s` for uploads up to 10MB.
- `PUT /upload` p99 latency target: `< 5s` for uploads up to 25MB.

## Data Freshness

- Commit reconciliation freshness: `95%` of pending items committed within `5 minutes`.
- Pending commit backlog should remain under configured readiness threshold.
