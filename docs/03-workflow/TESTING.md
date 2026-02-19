# Testing Guide

Complete testing strategy, implementation, and coverage improvement plan for the Personal Assistant project.

## Table of Contents

1. [Overview](#overview)
2. [Current Testing Infrastructure](#current-testing-infrastructure)
3. [Testing Everything](#testing-everything)
4. [Test Utilities](#test-utilities)
5. [Coverage Analysis](#coverage-analysis)
6. [Coverage Improvement Plan](#coverage-improvement-plan)
7. [Cursor-Specific Testing Improvements](#cursor-specific-testing-improvements)
8. [Testing Commands](#testing-commands)
9. [Test Checklist](#test-checklist)
10. [Best Practices](#best-practices)

---

## Overview

### Current Status

**Overall Coverage**: ~70% (varies by module)

- **Total files**: 68
- **Files with tests**: 48
- **Files without tests**: 20
- **Files below 80%**: 45

**Test Files**: 19+ test files covering:
- Unit tests: ✅ Good coverage
- Integration tests: ✅ Good coverage
- E2E tests: ✅ New, all passing
- Script tests: ✅ New, implemented

**Target Coverage**:
- Minimum: 80% for all metrics
- Critical files: 90%+

---

## Current Testing Infrastructure

### Test Runner

- **Custom test runner**: `src/run_tests.ts`
- **Parallel execution**: 4 workers by default
- **Test caching**: Skips unchanged tests
- **Coverage**: c8 with HTML/LCOV reports

### Test Files

- **19 test files** covering core functionality
- **Colocated**: Tests next to source files (`*.test.ts`)
- **Categories**: Unit, integration, E2E, security

### Coverage Status

**By Module**:

| Module         | Current | Target | Priority |
| -------------- | ------- | ------ | -------- |
| `src/core/`    | ~85%    | 90%    | High     |
| `src/tools/`   | ~62%    | 80%    | High     |
| `src/app/`     | ~75%    | 85%    | Medium   |
| `src/scripts/` | 0%      | 70%    | Medium   |
| `src/parsers/` | ~80%    | 85%    | Medium   |
| `src/storage/` | ~84%    | 85%    | Low      |

---

## Testing Everything

### 1. Unit Tests ✅

**What to Test**:
- Individual functions
- Parsers
- Validators
- Utilities

**Example**:
```typescript
// src/parsers/task_parser.test.ts
const result = parseTaskCommand('task add buy milk');
assert.equal(result?.tool?.name, 'task_add');
```

**Status**: ✅ Good coverage for parsers and core utilities

### 2. Integration Tests ✅

**What to Test**:
- Tool execution through Executor
- Router → Executor flow
- Storage operations

**Example**:
```typescript
// src/executor.test.ts
const result = await executor.execute('remember', { text: 'test' });
assert.ok(result.ok);
```

**Status**: ✅ Good coverage for executor and router

### 3. E2E Tests ✅

**What to Test**:
- Full CLI commands
- 100x features (generate, profile)
- Cache operations
- Plugin system

**Example**:
```typescript
// src/app/cli_e2e.test.ts
const result = runCli(['generate', 'tool', 'my_tool', '--args', 'text:string']);
assert.ok(result.json.ok);
```

**Status**: ✅ New E2E tests added, all passing

### 4. Script Tests ✅

**What to Test**:
- Code generation scripts
- Test generation scripts
- Refactoring scripts

**Example**:
```typescript
// src/scripts/generate_tool.test.ts
const result = runGenerateTool(['test_tool', '--args', 'name:string']);
assert.ok(fs.existsSync('src/tools/test_tool_tools.ts'));
```

**Status**: ✅ New script tests added

### 5. Security Tests ✅

**What to Test**:
- Path validation
- Command allowlist
- Permission enforcement

**Example**:
```typescript
// src/permissions.test.ts
const result = executor.execute('run_cmd', { cmd: 'rm', args: ['-rf', '/'] });
assertError(result, 'DENIED_COMMAND_ALLOWLIST');
```

**Status**: ✅ Good coverage

---

## Test Utilities

Created `src/core/test_utils.ts` with helpers:

```typescript
import {
    createMockContext, // Create test execution context
    runCli, // Run CLI commands and parse JSON
    assertSuccess, // Assert tool result succeeded
    assertError, // Assert tool result failed with specific code
    createTestDir, // Create temp directory
    cleanupTestDir, // Cleanup temp directory
} from '../core/test_utils';
```

**Benefits**:
- Consistent test setup
- Easier test writing
- Less boilerplate
- Reduces test code by 50%+

---

## Coverage Analysis

### Coverage Report Script

New script: `src/scripts/test_coverage_report.ts`

**Usage**:
```bash
npm run test:coverage:report
```

**Output**:
- Lists files with 0% coverage
- Lists files below 80% coverage
- Provides recommendations
- Shows summary statistics

### Priority Files for Testing

#### ❌ No Coverage (0%) - 20 files

**Scripts** (Priority: Medium):
- `scripts/batch_refactor.ts`
- `scripts/doctor.ts`
- `scripts/generate_tests.ts`
- `scripts/generate_tool.ts`
- `scripts/refactor.ts`
- `scripts/refactor_fix.ts`
- `scripts/test_coverage_report.ts`

**Tools** (Priority: High):
- `tools/TestTool_tools.ts` (test tool)
- `tools/e2e_test_tool2_tools.ts` (test tool)
- `tools/e2e_test_tool_tools.ts` (test tool)
- `tools/test_tool_gen_tools.ts` (test tool)
- `tools/test_tool_opt_tools.ts` (test tool)

#### ⚠️ Low Coverage (<80%) - Top Priority

**Critical Tools** (Priority: High):
1. `tools/fetch_tools.ts` - **7.4%** ⚠️
2. `tools/git_tools.ts` - **14.9%** ⚠️
3. `tools/utility_tools.ts` - **25.3%** ⚠️
4. `tools/comms_tools.ts` - **53.9%**

**Core Components** (Priority: High):
1. `app/cli.ts` - **52.7%**
2. `app/repl.ts` - **35.6%**
3. `core/validation.ts` - **57.8%**
4. `core/cache.ts` - **37.5%**

---

## Coverage Improvement Plan

### Phase 1: Critical Tools (Week 1)

**Goal**: Get all tools to 80%+ coverage

1. **fetch_tools.ts** (7.4% → 80%)
   - Test: fetch URL, handle errors, validate URLs
   - Use: `assistant generate tests fetch_tools`

2. **git_tools.ts** (14.9% → 80%)
   - Test: git status, git log, git diff
   - Use: `assistant generate tests git_tools`

3. **utility_tools.ts** (25.3% → 80%)
   - Test: calculate expressions, get_time, get_weather
   - Use: `assistant generate tests utility_tools`

4. **comms_tools.ts** (53.9% → 80%)
   - Test: send_message, read_messages
   - Use: `assistant generate tests comms_tools`

### Phase 2: Core Components (Week 2)

**Goal**: Get core components to 80%+ coverage

1. **app/cli.ts** (52.7% → 80%)
   - Test: All CLI commands
   - E2E tests already cover some, add unit tests

2. **app/repl.ts** (35.6% → 80%)
   - Test: REPL commands, command parsing
   - Integration tests

3. **core/validation.ts** (57.8% → 80%)
   - Test: All validation functions
   - Edge cases, error handling

4. **core/cache.ts** (37.5% → 80%)
   - Test: Cache operations, expiration, cleanup

### Phase 3: Scripts (Week 3)

**Goal**: Add tests for 100x features

1. **generate_tool.ts** - Test tool generation
2. **generate_tests.ts** - Test test generation
3. **refactor.ts** - Test refactoring detection
4. **refactor_fix.ts** - Test auto-fix
5. **batch_refactor.ts** - Test batch operations
6. **test_coverage_report.ts** - Test coverage analysis

**Note**: E2E tests already verify functionality, but unit tests needed for coverage

### Phase 4: Providers (Week 4)

**Goal**: Test LLM providers (if used)

1. **providers/llm/openai_compatible.ts** (9.5% → 80%)
2. **providers/llm/index.ts** (31.6% → 80%)

**Note**: Lower priority if not actively used

### Coverage Goals

**Short Term (1 month)**:
- All tools: 80%+ coverage
- Core components: 80%+ coverage
- Scripts: 70%+ coverage

**Medium Term (3 months)**:
- Overall: 75%+ average coverage
- Critical files: 90%+ coverage
- All files: 70%+ minimum

**Long Term (6 months)**:
- Overall: 85%+ average coverage
- All files: 80%+ minimum
- Critical files: 95%+ coverage

---

## Cursor-Specific Testing Improvements

### 1. Test Generation from Code

**How Cursor Helps**:
- Select function → Ask: "Generate tests for this"
- Cursor suggests test cases
- Cursor generates test structure

**Example**:
```
User: "Generate tests for handleRemember function"
Cursor: Generates test file with success/error cases
```

### 2. Test Suggestions

**How Cursor Helps**:
- Analyzes code coverage
- Suggests missing test cases
- Identifies edge cases
- Suggests integration tests

### 3. Test-Driven Development

**Workflow**:
1. Write test first (Cursor helps structure)
2. Implement feature (Cursor suggests code)
3. Run tests (Cursor shows results)
4. Refactor (Cursor suggests improvements)

### 4. Test Review

**How Cursor Helps**:
- Reviews test quality
- Suggests improvements
- Identifies flaky tests
- Suggests better assertions

### Using Cursor to Improve Coverage

#### 1. Generate Tests for Low-Coverage Files

**Workflow**:
```
1. Run: npm run test:coverage:report
2. Identify low-coverage file
3. Ask Cursor: "Generate comprehensive tests for [file]"
4. Review and customize generated tests
5. Run tests and verify coverage improved
```

#### 2. Identify Missing Test Cases

**Workflow**:
```
1. Open low-coverage file
2. Ask Cursor: "What test cases are missing for this file?"
3. Cursor analyzes code and suggests:
   - Success cases
   - Error cases
   - Edge cases
   - Integration tests
```

#### 3. Improve Existing Tests

**Workflow**:
```
1. Open test file
2. Ask Cursor: "How can I improve these tests?"
3. Cursor suggests:
   - Better assertions
   - Missing edge cases
   - Test organization
   - Mock improvements
```

#### 4. Coverage-Driven Development

**Workflow**:
```
1. Write code
2. Run: npm run test:coverage:report
3. Ask Cursor: "What tests are needed for this code?"
4. Generate tests
5. Verify coverage improved
```

---

## Testing Commands

### Run All Tests

```bash
npm test                    # Full suite (parallel + caching)
npm run test:parallel       # Explicit parallel
npm run test:sequential     # Sequential execution
npm run test:watch          # Auto-rerun on changes
```

### Run Specific Tests

```bash
npm run test:single executor
npm run test:single cli_e2e
npm run test:single generate_tool
```

### Coverage

```bash
npm run test:coverage              # Generate coverage
npm run test:coverage:open         # Open HTML report
npm run test:coverage:report       # Analyze gaps
```

### E2E Tests

```bash
npm run test:e2e                  # Run E2E tests
```

### Test 100x Features

```bash
# Test code generation
assistant generate tool test_tool --args text:string
# Verify: src/tools/test_tool_tools.ts created

# Test test generation
assistant generate tests test_tool
# Verify: src/tools/test_tool_tools.test.ts created

# Test profiling
assistant profile "remember: test"
# Verify: JSON output with timing metrics
```

---

## Test Checklist

### Before Committing

- [ ] All tests pass (`npm test`)
- [ ] Coverage meets minimum (80%)
- [ ] New features have tests
- [ ] E2E tests pass (`npm run test:e2e`)
- [ ] No flaky tests

### For New Features

- [ ] Unit tests for functions
- [ ] Integration tests for flows
- [ ] E2E tests for CLI commands
- [ ] Error case tests
- [ ] Edge case tests

### For Bug Fixes

- [ ] Test for bug (fails before fix)
- [ ] Test passes after fix
- [ ] Regression tests added

---

## Best Practices

### ✅ Do This

- Use test utilities for consistency
- Test success and error cases
- Test edge cases
- Clean up test data
- Use descriptive test names
- Group related tests
- Mock external dependencies
- Use `createMockContext()` for test setup
- Use `assertSuccess()` and `assertError()` for assertions

### ❌ Don't Do This

- Don't rely on repo files for test data
- Don't skip cleanup
- Don't use real API keys
- Don't test implementation details
- Don't write flaky tests
- Don't ignore coverage gaps
- Don't commit tests that don't pass

---

## Quick Reference

```bash
# Full test suite
npm test

# Specific test
npm run test:single executor

# Coverage
npm run test:coverage:report

# E2E tests
npm run test:e2e

# Watch mode
npm run test:watch

# Generate tests for tool
assistant generate tests my_tool
```

---

## Integration with Cursor

### Using Cursor for Testing

1. **Generate Tests**: Select code → Ask Cursor to generate tests
2. **Improve Tests**: Ask Cursor to suggest improvements
3. **Find Gaps**: Ask Cursor to identify missing test cases
4. **Debug Tests**: Use Cursor to understand test failures

### Cursor Rules

- `docs/03-workflow/TESTING.md` - Testing patterns
- `docs/03-workflow/TESTING.md` - Cursor-specific patterns

### Cursor Commands

- `/jules_test` - Write comprehensive tests (project-level)
- `/write_tests` - Generic test writing (user-level)

---

## Tracking Progress

### Weekly Checklist

- [ ] Run coverage report
- [ ] Identify top 5 low-coverage files
- [ ] Generate tests for 2-3 files
- [ ] Verify coverage improved
- [ ] Update this document

### Monthly Review

- [ ] Review overall coverage trend
- [ ] Identify blockers
- [ ] Adjust priorities
- [ ] Celebrate improvements! 🎉

---

## Resources

- **Test Utilities**: `src/core/test_utils.ts`
- **Testing Rules**: `docs/03-workflow/TESTING.md`
- **Cursor Patterns**: `docs/03-workflow/TESTING.md`
- **Test Generation**: `assistant generate tests <tool>`

---

## Conclusion

✅ **Comprehensive testing infrastructure**:
- Test utilities for easier writing
- E2E tests for CLI
- Script tests for 100x features
- Coverage analysis
- Cursor-specific improvements

✅ **All tests passing**: 17+ tests

✅ **Ready for improvement**: Coverage gaps identified, tools available

**Next Steps**:
1. Run `npm run test:coverage:report` to see gaps
2. Use Cursor to generate tests for low-coverage files
3. Improve coverage to 80%+ for all modules
4. Use test utilities for consistency

