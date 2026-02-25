# Style Guide

## Code Style

- Prefer explicit, descriptive names.
- Keep functions focused and under clear cognitive boundaries.
- Avoid hidden side effects outside service modules.

## TypeScript Standards

- Keep `strict` assumptions intact; avoid `any`.
- Prefer narrow types and explicit return types on exported functions.
- Use `type` imports where possible.

## Logging Standards

- Use structured JSON logs via `src/logger.ts`.
- Include request identifiers and operation context fields.
- Avoid logging secrets or full credentials.

## Documentation Standards

- Update README/docs for any new env var, endpoint, or operational behavior.
- Add runbook notes for production-impacting changes.
