# Contributing to Harbor

## Branch Naming

All work happens on feature branches. Use these prefixes:

- `feat/` — New features or capabilities
- `fix/` — Bug fixes
- `refactor/` — Code restructuring without behavior changes
- `infra/` — CI, tooling, configuration, deployment

Examples: `feat/voice-adapter`, `fix/websocket-reconnect`, `infra/docker-compose`

## Workflow

1. Create a branch from `main` using the naming convention above.
2. Make your changes. Keep commits focused and atomic.
3. Push your branch and open a PR to `main`.
4. CI must pass (typecheck, build, lint) before merge.
5. Security-sensitive changes (auth, endpoints, data handling) require the `needs-nygma` label for security review.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add WebSocket reconnect with exponential backoff
fix: prevent duplicate voice sessions on rapid rejoin
refactor: extract media pipeline into separate module
infra: add Docker build caching to CI
```

Format: `<type>: <description>`

Types: `feat`, `fix`, `refactor`, `infra`, `docs`, `test`, `chore`

## Code Style

- **TypeScript strict mode** — `strict: true` in all tsconfig.json files.
- **Prettier** — Default configuration, no overrides. Run `npx prettier --write .` before committing.
- **No `any` types** — Use proper typing. If you must escape the type system, add a comment explaining why.
- **Imports** — Use named imports. Avoid `import *`.

## Project Structure

```
server/     — Node.js backend (Express, WebSocket, media pipeline)
client/     — React frontend (Vite, TypeScript)
adapter/    — Voice/presence adapter layer
```

## Security

- Never commit secrets, API keys, or credentials.
- All new HTTP endpoints must validate input.
- Auth/authz changes require the `needs-nygma` label on the PR.
- Use parameterized queries for any database operations.

## Testing

- Write tests for new functionality where practical.
- CI runs typecheck and build validation on every push.
- Manual testing notes go in the PR description under "Testing".

## Labels

Use labels to categorize PRs and issues:

- **Phase:** `phase-1` through `phase-5`
- **Component:** `server`, `client`, `adapter`, `media`
- **Priority:** `security`, `performance`, `ux`
- **Review:** `needs-review`, `needs-nygma`
