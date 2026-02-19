# Error Handling Examples & Patterns

**This is a reference guide. For essential conventions, see `docs/04-reference/ERRORS.md`.**

## Detailed Examples

### Error Propagation

```typescript
// ✅ Good - Preserve context
async function processFile(path: string): Promise<ToolResult> {
    try {
        const content = await readFile(path);
        return processContent(content);
    } catch (err: any) {
        return {
            ok: false,
            error: makeError(
                'EXEC_ERROR',
                `Failed to process file '${path}': ${err.message}`,
                { path, originalError: err.message }
            ),
        };
    }
}

// ❌ Bad - Lose context
async function processFile(path: string): Promise<ToolResult> {
    try {
        const content = await readFile(path);
        return processContent(content);
    } catch (err: any) {
        return {
            ok: false,
            error: makeError('EXEC_ERROR', err.message), // Lost path context
        };
    }
}
```

### Validation Errors

```typescript
// ✅ Good - Specific error code
if (!args.text || args.text.trim().length === 0) {
    return {
        ok: false,
        error: makeError('MISSING_ARGUMENT', 'Text is required'),
    };
}

if (args.text.length > MAX_LENGTH) {
    return {
        ok: false,
        error: makeError(
            'INVALID_ARGUMENT',
            `Text exceeds maximum length of ${MAX_LENGTH} characters`
        ),
    };
}

// ❌ Bad - Generic error
if (!args.text) {
    return {
        ok: false,
        error: makeError('VALIDATION_ERROR', 'Invalid input'), // Too generic
    };
}
```

### Permission Errors

```typescript
// ✅ Good - Specific permission error
if (!context.agent.tools.includes(toolName)) {
    return {
        ok: false,
        error: makeError(
            'DENIED_AGENT_TOOLSET',
            `Agent '${context.agent.name}' cannot use tool '${toolName}'`
        ),
    };
}

// ❌ Bad - Generic error
if (!context.agent.tools.includes(toolName)) {
    return {
        ok: false,
        error: makeError('EXEC_ERROR', 'Permission denied'), // Too generic
    };
}
```

### Error Messages

```typescript
// ✅ Good - Actionable message
makeError(
    'DENIED_COMMAND_ALLOWLIST',
    `Command '${cmd}' is not allowed. Add it to permissions.json allow_commands array.`
)

// ✅ Good - Shows what's wrong and how to fix
makeError(
    'MISSING_ARGUMENT',
    `Required argument 'text' is missing. Provide text when calling this tool.`
)

// ❌ Bad - Vague message
makeError('EXEC_ERROR', 'Error occurred')

// ❌ Bad - Technical jargon
makeError('EXEC_ERROR', 'EACCES: permission denied, open')
```

### Error Recovery

```typescript
// ✅ Good - Suggests fix
if (!apiKey) {
    return {
        ok: false,
        error: makeError(
            'EXEC_ERROR',
            'No API key configured. Set GROQ_API_KEY environment variable or add to config.json',
            { suggestion: 'export GROQ_API_KEY=your-key' }
        ),
    };
}

// ❌ Bad - No guidance
if (!apiKey) {
    return {
        ok: false,
        error: makeError('EXEC_ERROR', 'No API key'),
    };
}
```

### Error Logging

```typescript
// ✅ Good - Log with context
if (verbose) {
    console.error(`[Error] ${error.code}: ${error.message}`);
    if (error.details) {
        console.error(`[Error] Details:`, error.details);
    }
}

// ❌ Bad - Log sensitive data
console.error(`[Error] API key: ${apiKey}`); // Never log secrets
```

### Exit Codes

```typescript
// In CLI/app layer
function exitCodeForError(error: ToolError | null): number {
    if (!error || !error.code) return 1;
    
    // Validation/permission errors = 2 (user error)
    if (
        error.code === 'VALIDATION_ERROR' ||
        error.code === 'MISSING_ARGUMENT' ||
        error.code === 'DENIED_*'
    ) {
        return 2;
    }
    
    // Execution errors = 1 (system error)
    return 1;
}
```

### Error Type Guards

```typescript
// ✅ Good - Type-safe error checking
function isValidationError(error: ToolError): boolean {
    return error.code === 'VALIDATION_ERROR' ||
           error.code === 'MISSING_ARGUMENT' ||
           error.code === 'INVALID_ARGUMENT';
}

function isPermissionError(error: ToolError): boolean {
    return error.code.startsWith('DENIED_');
}

// Usage
if (result.error) {
    if (isPermissionError(result.error)) {
        // Handle permission error
    } else if (isValidationError(result.error)) {
        // Handle validation error
    }
}
```

### Error Patterns by Context

#### Tool Handlers

```typescript
export function handleTool(args: Args, context: Context): ToolResult {
    // 1. Validate args
    const validation = validateArgs(args);
    if (!validation.ok) {
        return {
            ok: false,
            error: makeError('VALIDATION_ERROR', validation.message),
        };
    }
    
    // 2. Check permissions
    if (!hasPermission(args, context)) {
        return {
            ok: false,
            error: makeError('DENIED_*', '...'),
        };
    }
    
    // 3. Execute with error handling
    try {
        const result = execute(args);
        return { ok: true, result };
    } catch (err: any) {
        return {
            ok: false,
            error: makeError('EXEC_ERROR', err.message),
        };
    }
}
```

#### Providers

```typescript
async function chat(request: ChatRequest): Promise<ChatResponse> {
    try {
        const response = await fetch(this.endpoint, options);
        
        if (!response.ok) {
            return {
                ok: false,
                error: `API error ${response.status}: ${await response.text()}`,
            };
        }
        
        return parseResponse(await response.json());
    } catch (err: any) {
        return {
            ok: false,
            error: `Network error: ${err.message}`,
        };
    }
}
```

## Common Mistakes

### ❌ Don't Do This

```typescript
// Throwing errors
throw new Error('Something went wrong');

// Generic error messages
makeError('EXEC_ERROR', 'Error')

// Logging secrets
console.error(`API key: ${apiKey}`);

// Losing error context
catch (err) {
    return { ok: false, error: makeError('EXEC_ERROR', 'Failed') };
}
```

### ✅ Do This Instead

```typescript
// Return structured errors
return { ok: false, error: makeError('EXEC_ERROR', 'Something went wrong') };

// Specific error messages
makeError('DENIED_PATH_ALLOWLIST', `Path '${path}' is not allowed`);

// Sanitize logs
console.error('[Error] Authentication failed');

// Preserve context
catch (err: any) {
    return {
        ok: false,
        error: makeError('EXEC_ERROR', `Failed: ${err.message}`, { context }),
    };
}
```

