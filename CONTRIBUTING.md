# Contributing

Thanks for helping out. Small PRs land fastest.

## Setup

Use Node.js 24 for development, matching CI. Package tests separately cover
Node.js 24 with strict engine checks and legacy Node.js 18 stdio behavior; see
the [runtime prerequisites](README.md#prerequisites) for the installation limits.

```bash
npm ci
npm test          # vitest
npm run typecheck
npm run build
```

`test/*.live.test.ts` needs a real, authenticated `agy` on PATH and is skipped otherwise.

## Rules

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) — `commitlint` runs on `commit-msg` and in CI on every PR.
- `prettier` runs on staged files via `lint-staged`; CI enforces `npm run format:check`.
- New behaviour ships with a test. Bug fixes ship with the test that failed before the fix.
- Keep `package.json`, `server.json`, and the GitHub repo description in sync when the pitch changes.

## PRs

Open against `main`. CI (test + build + commitlint) must be green. Squash merge is the only enabled merge strategy.
