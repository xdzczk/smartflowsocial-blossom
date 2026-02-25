# Architecture Boundaries

## Layering Rules

- `src/routes/*` orchestrates HTTP concerns only.
- `src/services/*` contains domain/application logic and external integrations.
- `src/utils/*` contains pure, side-effect-free helper functions.

## Import Boundaries

- Routes must not import other route handlers.
- Services must not import routes.
- Utils must not import routes or services.

## Route Responsibilities

- Parse/validate request context.
- Invoke services.
- Map known domain errors to HTTP responses.

## Service Responsibilities

- Encapsulate external calls (R2, policy, commit callbacks).
- Handle retry/backoff behavior.
- Expose deterministic APIs for testing.
