# Developer Guide

## Local Setup

1. `pnpm install`
2. `cp .env.example .env`
3. Set required env vars, then run `pnpm validate`.

## Required Quality Gates

- `pnpm format:check`
- `pnpm lint:ci`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Test Taxonomy

- `pnpm test:unit` for service/route unit tests.
- `pnpm test:integration` for route wiring and dependency interaction.
- `pnpm test:security` for abuse-path tests.
- `pnpm test:property` for invariant-like checks.
- `pnpm test:performance` for baseline latency regressions.

## PR Expectations

- Keep changes scoped and include tests for behavior changes.
- Use semantic PR titles (`feat`, `fix`, `chore`, etc.).
- Ensure CI checks pass before requesting review.
