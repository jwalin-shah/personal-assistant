# Contributing Guide

## Quick Start

```bash
# Install
npm install

# Build
npm run build

# Verify everything works
npm run smoke
```

## Development Workflow

### 1. Watch Mode (Recommended)

For active development, use watch mode:

```bash
# REPL with auto-reload
npm run dev:watch

# Web dashboard with auto-reload
npm run web:watch

# Just build continuously
npm run build:watch
```

### 2. Before Committing

Run preflight checks:

```bash
npm run preflight
```

This runs:

1. ✓ Lint
2. ✓ Type check
3. ✓ Build
4. ✓ Leak check (no data in repo)
5. ✓ Smoke test

Pre-commit hooks also run automatically (lint-staged).

### 3. Testing

```bash
# Full test suite (parallel + caching - unchanged tests skip automatically)
npm test

# Parallel execution (explicit)
npm run test:parallel

# Sequential execution (disable parallel)
npm run test:sequential

# Single test
npm run test:single -- executor

# Custom worker count
TEST_MAX_WORKERS=8 npm test

# With verbose output
TEST_DIST=1 node dist/run_tests.js executor 2>&1 | tee test.log

# Force run all tests (skip cache)
TEST_SKIP_CACHE=1 npm test
```

> 💡 **Test Performance**: Tests run in parallel (4 workers) and automatically skip if unchanged. See [docs/CACHING.md](docs/CACHING.md) for details.

### 4. Debugging

```bash
# Check config
npm run doctor

# Verbose mode
./dist/app/cli.js --verbose "remember: test"

# See audit trail
./dist/app/cli.js audit --human
```

## Code Style

### Automatic Formatting

```bash
# Format all files
npm run format

# Check formatting
npm run format:check

# Fix lint + format
npm run fix
```

### Conventions

- Use `node:` prefix for built-ins: `import * as fs from 'node:fs'`
- Zod for validation: Define schema, derive type
- Early returns: Reduce nesting
- Structured errors: `makeError('CODE', 'message')`
- JSDoc on exports

## Adding a New Tool

See `docs/02-guides/ADDING_TOOLS_GUIDE.md` for the full checklist.

Quick version:

1. Schema in `src/core/types.ts`
2. Handler in `src/tools/`
3. Register in `src/core/tool_registry.ts`
4. Add to agents in `src/agents/index.ts`
5. Write tests

## Pull Request Checklist

- [ ] `npm run preflight` passes
- [ ] Tests added for new functionality
- [ ] JSDoc on new exports
- [ ] No console.log debugging left behind
- [ ] Security review if touching permissions/paths

## Performance

### Benchmarks

```bash
npm run bench
```

### Evals

```bash
npm run eval
```

## Directory Structure

```
src/
├── app/         # Entry points (CLI, REPL, web)
├── core/        # Foundation (types, executor, config)
├── agents/      # Agent definitions
├── parsers/     # NLP routing
├── providers/   # LLM adapters
├── storage/     # JSONL persistence
├── runtime/     # Dependency injection
├── tools/       # Tool handlers
└── evals/       # Evaluation datasets
```

## Need Help?

- Check `docs/02-guides/DEBUGGING.md`
- Run `npm run doctor`
- Look at similar existing code
- See [docs/04-reference/CACHING.md](docs/04-reference/CACHING.md) for caching details
