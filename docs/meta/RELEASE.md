# Release Process

Releases are automated via [semantic-release](https://semantic-release.gitbook.io/).

## How It Works

1. Merges/pushes to `main` trigger CI.
2. Commits are analyzed using the Conventional Commits format.
3. Version bump is determined:
   - `fix:` → patch
   - `feat:` → minor
   - `BREAKING CHANGE:` → major
4. A git tag is created and release notes / changelog are generated.
5. Publishing (e.g., npm) occurs if configured in CI.

## Manual Release

Manual releases are not recommended. If you must run a release locally:

```bash
npm run release
```

## Configuration

Release behavior uses the `semantic-release` defaults configured in CI/project scripts.

Ensure CI has the correct auth tokens (e.g., npm/GitHub) if publishing is enabled.
