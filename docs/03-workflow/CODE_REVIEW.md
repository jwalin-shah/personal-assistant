# Code Review Guide

Complete guide to code review system, best practices, and quick reference for this project.

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Best Practices](#best-practices)
4. [Systematic Review Workflow](#systematic-review-workflow)
5. [Cursor Prompts for Review](#cursor-prompts-for-review)
6. [Measuring Progress](#measuring-progress)
7. [Commands](#commands)

---

## Overview

### Where Things Belong

**✅ Scripts → `src/scripts/`**:
- Executable code that performs actions
- `code_review.ts` - Runs reviews, analyzes code
- `code_review_fix.ts` - Auto-fixes issues
- `refactor.ts` - Detects refactoring opportunities

**✅ Patterns/Rules → project documentation in `docs/`**:
- Guidelines and patterns for AI to follow
- `code_review.mdc` - Review checklist, patterns, examples
- `security.mdc` - Security patterns
- `errors.mdc` - Error handling patterns

**Why This Separation?**:
- Scripts are executable code (TypeScript → JavaScript)
- Rules are documentation/guidelines read by Cursor AI automatically
- Scripts can reference rules for patterns
- Rules document how to use scripts

### Current Status

**Baseline Review**:
- Files reviewed: 72
- Total issues: 775
- Critical issues: 34 (security)
- Average score: 73.3/100

**Top Issues**:
- Security: 34 critical (path traversal, shell injection, secrets)
- Performance: 67 high (sync I/O, sequential async)
- Quality: 373 medium (any types, missing docs)
- Error handling: 123 (throw statements, empty catch)

---

## Quick Start

### 🚀 One-Command Review

```bash
# Review entire codebase
npm run review
```

**Output**: Score (0-100) + categorized issues + critical issues list

### 🎯 Quick Start: Fix Critical Issues

#### Step 1: Review Critical Issues

```bash
npm run review | grep -A 5 "Critical Issues"
```

#### Step 2: Fix Each Issue with Cursor

**Open file in Cursor, use this prompt**:

```markdown
"Review [file] for security vulnerabilities.
The code review tool found [specific issue] at line [N].
Fix this issue following code_review.mdc security patterns.
Review the file in isolation (no context of other files)."
```

**Example**:

```markdown
"Review src/core/config.ts for security vulnerabilities.
The code review tool found potential path traversal at line 45.
Fix this issue following code_review.mdc security patterns.
Use context.paths.resolveAllowed() for safe path resolution."
```

#### Step 3: Verify Fix

```bash
npm run review [file]
# Check score improved
```

---

## Best Practices

### Separation of Concerns

**Scripts (Executable)**:
- **Location**: `src/scripts/`
- **Purpose**: Run analysis, generate reports, auto-fix
- **Usage**: `npm run review`, `node dist/scripts/code_review.js`
- **Examples**: ESLint, Prettier, TypeScript compiler

**Rules (AI Guidance)**:
- **Location**: project documentation in `docs/`
- **Purpose**: Guide AI to follow patterns
- **Usage**: Cursor reads automatically when relevant
- **Examples**: Code style, security patterns, review checklist

### Industry Best Practices

**ESLint**:
- **Script**: `node_modules/.bin/eslint` (executable)
- **Rules**: `eslint.config.mjs` (configuration/patterns)

**Prettier**:
- **Script**: `node_modules/.bin/prettier` (executable)
- **Config**: default settings or editor-level config

**TypeScript**:
- **Script**: `node_modules/.bin/tsc` (executable)
- **Config**: `tsconfig.json` (configuration)

**Our Code Review**:
- **Script**: `src/scripts/code_review.ts` (executable) ✅
- **Rules**: `docs/03-workflow/CODE_REVIEW.md` (patterns) ✅

### When to Use What

**Use Scripts When**:
- ✅ Need to analyze code programmatically
- ✅ Need to generate reports
- ✅ Need to auto-fix issues
- ✅ Need to run in CI/CD
- ✅ Need to measure metrics

**Use Rules When**:
- ✅ Need to guide AI behavior
- ✅ Need to define patterns
- ✅ Need to provide examples
- ✅ Need to document conventions
- ✅ Need to ensure consistency

---

## Systematic Review Workflow

### Daily (5 min)

```bash
# Review changed files
git diff --name-only | grep '\.ts$' | xargs npm run review
```

### Weekly (30 min)

```bash
# 1. Review new code
git log --since="1 week ago" --name-only --pretty=format: | sort -u | grep '\.ts$' | xargs npm run review

# 2. Fix critical issues
npm run review | grep -A 10 "Critical Issues"

# 3. Improve one low-scoring file
npm run review | grep "Score: [0-6][0-9]" | head -1
# Open file, review with Cursor, fix
```

### Monthly (2 hours)

```bash
# 1. Full review
npm run review > reviews/$(date +%Y%m%d).txt

# 2. Compare progress
diff reviews/20250101.txt reviews/20250201.txt

# 3. Fix all critical issues
# 4. Improve top 10 files
```

---

## Cursor Prompts for Review

### Isolated Review (Recommended)

```markdown
"Review [file] systematically using code_review.mdc checklist.
Review it as if you have NO knowledge of other files in the codebase.
This ensures we catch issues that rely on implicit context.

Check each category:

1. Security: Path validation, command validation, secrets
2. Performance: Sync I/O, sequential async, regex
3. Quality: Type safety, naming, complexity
4. Error Handling: Throw statements, empty catch
5. Testing: Missing tests
6. Documentation: Missing JSDoc

For each issue:

- Line number
- Explanation
- Specific fix
- Code example"
```

### Fix Issues

```markdown
"Fix all issues found in the review of [file].
Apply fixes following code_review.mdc patterns.
Maintain existing functionality."
```

### Category-Focused

```markdown
"Review [file] specifically for [security/performance/quality] issues.
Provide detailed analysis with line numbers and fixes."
```

### Using Project Commands

**Project-level command**: `/review_pr`

```markdown
You are the Reviewer. Follow role.review.mdc first, then project rules.

Review this code systematically using the checklist in code_review.mdc:
- Functionality (edge cases, error handling, bugs)
- Security (validation, paths, commands, secrets)
- Performance (caching, efficiency)
- Quality (conventions, types, unused code)
- Testing (coverage, edge cases, mocks)
- Documentation (JSDoc, README updates)

Provide specific, actionable feedback. Approve only if all checks pass.
```

**User-level command**: `/code_review`

```markdown
Review this code for:
- Functionality and edge cases
- Security issues (validation, paths, secrets)
- Performance optimizations
- Code quality and conventions
- Test coverage
- Documentation

Provide specific, actionable feedback.
```

---

## Measuring Progress

### Track Scores

```bash
# Save review
npm run review > reviews/$(date +%Y%m%d).txt

# Extract metrics
grep "Average score" reviews/*.txt
grep "Critical issues" reviews/*.txt
```

### Goals

- **Week 1**: Fix all 34 critical issues
- **Week 2-4**: Improve average score 73 → 80+
- **Month 2**: Maintain 80+ with 0 critical issues

### Priority Order

1. **Critical Security** (34 issues) - Fix first!
2. **High Performance** (67 issues) - Fix next
3. **High Error Handling** (27 issues) - Then these
4. **Medium Quality** (373 issues) - Improve over time
5. **Documentation** (141 issues) - Add as you go

**Start with critical security issues today!** 🔒

---

## Commands

```bash
npm run review          # Review entire codebase
npm run review src/     # Review directory
npm run review file.ts   # Review single file
npm run review:fix       # Auto-fix simple issues (experimental)
```

---

## Integration

### Scripts Reference Rules

Scripts can reference rule files for patterns:

```typescript
// In code_review.ts
import * as fs from 'node:fs';
const rulesPath = path.join(projectRoot, 'docs/code_review.mdc');
const rules = fs.readFileSync(rulesPath, 'utf8');
// Use rules to guide analysis
```

### Rules Guide Script Usage

Rules document how to use scripts:

```markdown
# In code_review.mdc

## Running Reviews

Use the review script:

```bash
npm run review
```

This runs `src/scripts/code_review.ts` which checks...
```

---

## Related Documentation

- **Complete Strategy**: `docs/CONTINUOUS_IMPROVEMENT.md` (if exists)
- **Cursor Prompts**: `docs/CURSOR_IMPROVEMENT_STRATEGY.md` (if exists)
- **Code Review Rules**: `docs/03-workflow/CODE_REVIEW.md`
- **Security Patterns**: `docs/01-concepts/SECURITY.md`
- **Error Patterns**: `docs/04-reference/ERRORS.md`

---

## Conclusion

**Current structure is correct!** ✅

- **Scripts** (`src/scripts/`) = Executable tools
- **Rules** (`docs/`) = AI guidance patterns
- **Docs** (`docs/`) = User guides

This follows industry best practices and separation of concerns.

**Quick Start**: Run `npm run review` and fix critical issues first!
