# Contributing

## Development

1. `pnpm install`
2. `cp .env.example .env` and configure required values
3. `pnpm validate`
4. `pnpm test`

## Pull Requests

- Keep PRs focused and small.
- Add or update tests for behavior changes.
- Ensure CI passes before requesting review.
- Use semantic PR titles (`feat`, `fix`, `chore`, `docs`, `refactor`, etc.).
- Validate architecture boundaries documented in `docs/architecture/boundaries.md`.
- Follow development guidance in `docs/development/developer-guide.md`.

## Commit Guidelines

- Use concise imperative messages.
- Document operational/security impact in PR description when relevant.
