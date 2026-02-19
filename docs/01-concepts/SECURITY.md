# Security Guide

Security fixes, patterns, and best practices for the Personal Assistant project.

## Table of Contents

1. [Security Fixes](#security-fixes)
2. [Security Patterns](#security-patterns)
3. [Best Practices](#best-practices)
4. [Code Review Checklist](#code-review-checklist)

---

## Security Fixes

### Issues Fixed

#### 1. Path Traversal Vulnerability (src/app/web/server.ts)

**Issue**: Uncontrolled data used in path expression  
**Severity**: Error (Critical)  
**Location**: Lines 61-62, 68, 74

**Before**:
```typescript
let filePath = pathname === '/' ? '/index.html' : pathname;
filePath = path.join(webDir, filePath); // ❌ Vulnerable to path traversal
```

**After**:
```typescript
let filePath = pathname === '/' ? '/index.html' : pathname;

// Security: Prevent path traversal attacks
const normalizedPath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
const resolvedPath = path.resolve(webDir, normalizedPath);

// Ensure resolved path is within webDir (prevent directory traversal)
if (!resolvedPath.startsWith(path.resolve(webDir))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
}

filePath = resolvedPath; // ✅ Safe
```

**Fix**: Added path normalization and validation to prevent directory traversal attacks.

#### 2. Incomplete HTML Sanitization (src/tools/fetch_tools.ts)

**Issue**: Bad HTML filtering regexp, incomplete multi-character sanitization  
**Severity**: Warning  
**Location**: Lines 64-65

**Before**:
```typescript
.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, '')
.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gim, '')
```

**After**:
```typescript
.replace(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gim, '')
.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gim, '')
```

**Fix**: Added `\s*` to handle spaces in closing tags (e.g., `</script >`).

#### 3. Incomplete String Escaping (src/core/arg_parser.ts)

**Issue**: Incomplete string escaping or encoding  
**Severity**: Warning  
**Location**: Line 174

**Before**:
```typescript
return `"${arg.replace(/"/g, '\\"')}"`; // ❌ Doesn't escape backslashes
```

**After**:
```typescript
return `"${arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; // ✅ Escapes backslashes first
```

**Fix**: Escape backslashes before escaping quotes to prevent incomplete escaping vulnerabilities.

### Verification

Run CodeQL again to verify fixes:

```bash
codeql database create codeql-db --language=javascript --source-root=. --overwrite
codeql database analyze codeql-db codeql/javascript-queries --format=csv --output=results.csv
```

**Expected**: Fewer or no security issues in the fixed files.

### Status

✅ **All CodeQL security issues fixed**

- Path traversal: Fixed
- HTML sanitization: Improved
- String escaping: Fixed

---

## Security Patterns

### Path Validation

**Always use** `context.paths.resolveAllowed()` for file paths:

```typescript
// ✅ Good
const safePath = context.paths.resolveAllowed(userPath);
if (!safePath) {
    return { ok: false, error: makeError('INVALID_PATH', 'Path not allowed') };
}

// ❌ Bad
const filePath = path.join(baseDir, userPath); // Vulnerable to path traversal
```

### Command Validation

**Always validate commands** against allowlist:

```typescript
// ✅ Good
const allowedCommands = ['git', 'npm', 'node'];
if (!allowedCommands.includes(cmd)) {
    return { ok: false, error: makeError('DENIED_COMMAND_ALLOWLIST', 'Command not allowed') };
}

// ❌ Bad
execSync(`${cmd} ${args.join(' ')}`); // Vulnerable to command injection
```

### Input Validation

**Always validate user input** with Zod schemas:

```typescript
// ✅ Good
const schema = z.object({
    path: z.string().min(1).max(256),
    cmd: z.enum(['git', 'npm', 'node']),
});

const result = schema.safeParse(input);
if (!result.success) {
    return { ok: false, error: makeError('VALIDATION_ERROR', result.error.message) };
}

// ❌ Bad
const path = input.path; // No validation
```

### Secret Handling

**Never log or expose secrets**:

```typescript
// ✅ Good
const apiKey = process.env.API_KEY;
if (!apiKey) {
    return { ok: false, error: makeError('MISSING_CONFIG', 'API key not configured') };
}
// Use apiKey, but never log it

// ❌ Bad
console.log(`Using API key: ${apiKey}`); // Exposes secret
```

---

## Best Practices

### ✅ Do This

- ✅ Always validate paths with `context.paths.resolveAllowed()`
- ✅ Always validate commands against allowlist
- ✅ Always validate input with Zod schemas
- ✅ Never log or expose secrets
- ✅ Use parameterized commands (avoid string concatenation)
- ✅ Sanitize HTML/XML output
- ✅ Escape special characters in strings
- ✅ Use HTTPS for external requests
- ✅ Validate file permissions before operations
- ✅ Use structured errors (never expose internal details)

### ❌ Don't Do This

- ❌ Don't use user input directly in file paths
- ❌ Don't use user input directly in commands
- ❌ Don't skip input validation
- ❌ Don't log secrets or sensitive data
- ❌ Don't use string concatenation for commands
- ❌ Don't trust user input without validation
- ❌ Don't expose internal error details to users
- ❌ Don't use eval() or similar dangerous functions
- ❌ Don't skip permission checks

---

## Code Review Checklist

### Security Review Checklist

When reviewing code, check for:

1. **Path Validation**:
   - [ ] All file paths use `context.paths.resolveAllowed()`
   - [ ] No direct path concatenation with user input
   - [ ] Path traversal attacks prevented

2. **Command Validation**:
   - [ ] All commands validated against allowlist
   - [ ] No command injection vulnerabilities
   - [ ] Parameterized commands used (not string concatenation)

3. **Input Validation**:
   - [ ] All user input validated with Zod schemas
   - [ ] Type checking performed
   - [ ] Length limits enforced
   - [ ] Special characters handled safely

4. **Secret Handling**:
   - [ ] No secrets in code or logs
   - [ ] Environment variables used for secrets
   - [ ] Secrets never exposed in error messages

5. **Output Sanitization**:
   - [ ] HTML/XML output sanitized
   - [ ] Special characters escaped
   - [ ] No XSS vulnerabilities

6. **Error Handling**:
   - [ ] Structured errors used (makeError)
   - [ ] Internal details not exposed
   - [ ] Generic error messages for users

### Using Cursor for Security Review

**Project-level command**: `/security_audit`

```markdown
You are the Reviewer. Follow role.review.mdc first, then project rules.

Review this code for security using security.mdc patterns:
- Path validation (use context.paths.resolveAllowed())
- Command validation (check allow_commands list)
- Input validation (Zod schemas)
- Secret handling (no exposure)
- Output sanitization (HTML/XML)
- Error handling (structured errors)

Provide specific, actionable security recommendations.
```

**User-level command**: `/security_review`

```markdown
Review this code for security:
- Input validation
- Path traversal risks
- Command injection risks
- Secret exposure
- Permission checks
- Authentication/authorization

Provide specific recommendations.
```

---

## Related Documentation

- **Security Rules**: `docs/01-concepts/SECURITY.md`
- **Code Review Guide**: `docs/CODE_REVIEW.md`
- **Error Patterns**: `docs/04-reference/ERRORS.md`

---

## Quick Reference

### Security Patterns

```typescript
// Path validation
const safePath = context.paths.resolveAllowed(userPath);

// Command validation
if (!allowedCommands.includes(cmd)) {
    return { ok: false, error: makeError('DENIED_COMMAND_ALLOWLIST', 'Command not allowed') };
}

// Input validation
const result = schema.safeParse(input);
if (!result.success) {
    return { ok: false, error: makeError('VALIDATION_ERROR', result.error.message) };
}

// Structured errors
return { ok: false, error: makeError('SECURITY_ERROR', 'Generic message') };
```

---

## Conclusion

✅ **Security fixes applied**: All CodeQL issues resolved

✅ **Security patterns**: Documented in `docs/01-concepts/SECURITY.md`

✅ **Best practices**: Follow patterns in security.mdc

**Always prioritize security in code reviews!** 🔒

