# Development Workflow Guide

This document describes the development workflow and tooling setup for the Personal Assistant project.

## 🚀 Quick Start

```bash
npm install          # Install dependencies
npm run build        # Build TypeScript
npm test            # Run tests
npm run dev:watch   # Start REPL with hot reload
```

## 📋 Available Scripts

### Build & Compile

- `npm run build` - Compile TypeScript to JavaScript
- `npm run build:watch` - Watch mode for TypeScript compilation
- `npm run clean` - Remove build artifacts and temp files
- `npm run typecheck` - Type check without emitting files

### Testing

- `npm test` - Run all tests (parallel + caching by default)
- `npm run test:parallel` - Explicit parallel execution
- `npm run test:sequential` - Sequential execution (disable parallel)
- `npm run test:single <file>` - Run a specific test file
- `npm run test:watch` - Watch mode for tests (auto-rerun on changes)
- `npm run test:coverage` - Run tests with coverage report
- `npm run test:coverage:open` - Generate coverage and open HTML report

> 💡 **Test Performance**: Tests run in parallel (4 workers) and automatically skip if unchanged. See [docs/CACHING.md](./CACHING.md) and [docs/PARALLEL_TESTS.md](./PARALLEL_TESTS.md) for details.

### Code Quality

- `npm run lint` - Run ESLint
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check formatting without fixing
- `npm run check` - Run all checks (typecheck + lint + format)
- `npm run fix` - Auto-fix lint and format issues

### Development

- `npm run dev` - Build and start REPL
- `npm run dev:watch` - REPL with hot reload (watch build + nodemon)
- `npm run repl` - Start REPL (requires build first)
- `npm run web` - Start web dashboard
- `npm run web:watch` - Web dashboard with hot reload

### Performance & Profiling

- `npm run profile <command>` - CPU profiling (generates profile.txt)
- `npm run profile:analyze` - Analyze CPU profile
- `npm run profile:memory` - Memory profiling (heap snapshots)
- `./scripts/profile.sh <command>` - CPU profiling helper script
- `./scripts/memory-profile.sh <command>` - Memory profiling helper script

### Other

- `npm run doctor` - Diagnose configuration and environment
- `npm run preflight` - Full pre-commit checks
- `npm run smoke` - Quick smoke test
- `npm run eval` - Run evaluations
- `npm run bench` - Run benchmarks

## 🔧 Git Hooks

### Pre-commit Hook

Automatically runs on `git commit`:

- ESLint with `--fix` on staged `.ts` files
- Prettier formatting on staged `.ts` files

**To skip**: `git commit --no-verify` (not recommended)

### Pre-push Hook

Automatically runs on `git push`:

- `npm run check` (typecheck + lint + format check)
- `npm test` (all tests)

**To skip**: `git push --no-verify` (not recommended)

## 🐛 Debugging

### VS Code Debugger

Press `F5` in VS Code and select:

1. **Debug CLI** - Debug any CLI command
    - Prompts for command input
    - Sets breakpoints in TypeScript source

2. **Debug REPL** - Debug REPL interactions
    - Starts REPL with debugger attached
    - Step through REPL code

3. **Debug Current Test** - Debug the test file you're editing
    - Automatically detects test file
    - Runs with debugger attached

4. **Debug Web Server** - Debug web dashboard
    - Starts web server on port 3000
    - Debug server-side code

### Command Line Debugging

```bash
# Node.js debugger
node --inspect dist/app/cli.js demo

# Chrome DevTools
# Open chrome://inspect and click "inspect"
```

## 📊 Test Coverage

```bash
# Generate coverage report
npm run test:coverage

# Open HTML report
npm run test:coverage:open
```

Coverage reports are saved to `coverage/` directory:

- `coverage/index.html` - HTML report
- `coverage/lcov.info` - LCOV format (for CI)
- `coverage/lcov-report/` - Detailed HTML report

## 🔍 Performance Profiling

### CPU Profiling

```bash
# Using npm script
npm run profile demo

# Using helper script
./scripts/profile.sh demo

# Manual
node --prof dist/app/cli.js demo
node --prof-process isolate-*.log > profile.txt
```

The profile shows:

- Function call counts
- Time spent in each function
- Call graph

### Memory Profiling

```bash
# Using npm script
npm run profile:memory demo

# Using helper script
./scripts/memory-profile.sh demo

# Then send SIGUSR2 to generate snapshot
kill -SIGUSR2 <PID>
```

Heap snapshots can be opened in Chrome DevTools:

1. Open `chrome://inspect`
2. Click "Open dedicated DevTools for Node"
3. Go to Memory tab
4. Load snapshot

## 🎨 Code Formatting

Code is automatically formatted on save (VS Code) or by running `npm run format`.

**Prettier defaults**:

- Single quotes
- 4-space indentation
- Semicolons
- 100 character line width
- LF line endings

**To format manually**:

```bash
npm run format           # Format all files
npm run format:check     # Check formatting
```

## ✅ Pre-commit Checklist

Before committing, ensure:

- [ ] `npm run check` passes
- [ ] `npm test` passes
- [ ] Code is formatted (`npm run format`)
- [ ] No console.log statements (unless intentional)
- [ ] Tests cover new functionality

Run `npm run check` to catch issues before committing.

## 🚨 Troubleshooting

### Tests failing after changes

```bash
# Clean and rebuild
npm run clean
npm run build
npm test
```

### Coverage not updating

```bash
# Remove old coverage
rm -rf coverage/
npm run test:coverage
```

### Local checks not running

```bash
# Reinstall dependencies
npm install
```

### VS Code not formatting on save

1. Install Prettier extension
2. Verify a formatter is selected in your editor
3. Reload VS Code window

## 📚 Additional Resources

- [Complete Commands Reference](./COMMANDS.md) - All available commands
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [ESLint Rules](https://eslint.org/docs/rules/)
- [Prettier Options](https://prettier.io/docs/en/options.html)
- [Node.js Profiling](https://nodejs.org/en/docs/guides/simple-profiling/)
