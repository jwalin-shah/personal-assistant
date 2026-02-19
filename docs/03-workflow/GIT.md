# Git Workflow

This project uses a simple Git workflow focused on small, reviewable commits.

## Branches

- `main`: stable branch
- `feature/<name>`: optional for larger features
- `fix/<name>`: optional for complex bug fixes
- `docs/<name>`: optional for large doc updates

## Commit Style

Use Conventional Commits:

```text
feat(scope): add routing fallback
fix(router): handle empty query
docs: update quickstart
```

## Recommended Local Checks

Run these before pushing:

```bash
npm run cleanup
npm run fix
npm run preflight
```

## Standard Flow

```bash
# 1) Make changes
# 2) Stage
git add <files>

# 3) Commit
git commit -m "feat(scope): summary"

# 4) Push
git push origin <branch>
```

## CI and Releases

- CI runs lint, typecheck, format checks, build, and tests.
- Releases are handled via `semantic-release` when enabled in CI.

## Tips

- Keep commits focused and small.
- Avoid mixing refactors and behavior changes in one commit.
- Prefer explicit commit messages that describe user-facing impact.
