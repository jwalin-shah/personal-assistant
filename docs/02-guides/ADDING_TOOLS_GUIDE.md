# Guide: Adding New Tools with `/impl_add_tool`

This guide explains how to add new tools to the personal assistant using the `/impl_add_tool` command pattern.

## Overview

Adding a new tool requires 5 steps:
1. **Create Zod schema** in `src/core/types.ts`
2. **Create handler function** in `src/tools/[tool_name]_tools.ts`
3. **Register handler** in `src/core/tool_registry.ts`
4. **Add to agent toolsets** in `src/agents/index.ts`
5. **Create test file** `src/tools/[tool_name]_tools.test.ts`

Additionally:
6. **Add ToolSpec** in `src/tools/schemas.ts` (for documentation)
7. **Export handler** from `src/tools/index.ts` (if new file)

## Step-by-Step Example: Adding `delete_file` Tool

### Step 1: Create Zod Schema (`src/core/types.ts`)

Add the schema definition and type inference:

```typescript
// Add after existing schemas (around line 400-550)
export const DeleteFileSchema = z.object({
    path: z.string().min(1),
    confirm: z.boolean().optional(), // For confirmation requirement
});
export type DeleteFileArgs = z.infer<typeof DeleteFileSchema>;
```

Then add to `ToolSchemas` registry (around line 518):

```typescript
export const ToolSchemas: Record<string, z.ZodTypeAny> = {
    // ... existing tools
    delete_file: DeleteFileSchema,
};
```

### Step 2: Create Handler Function (`src/tools/file_tools.ts`)

Add the handler following the pattern:

```typescript
import { makeError, makePermissionError, makeConfirmationError, ErrorCode } from '../core/tool_contract';
import { makeDebug } from '../core/debug';
import { ExecutorContext, ToolResult, DeleteFileArgs } from '../core/types';
import * as fs from 'node:fs';

/**
 * Handle delete_file tool.
 * @param args - Tool arguments containing path and optional confirm flag.
 * @param context - Execution context.
 * @returns Result object with ok, result, error, debug.
 */
export function handleDeleteFile(args: DeleteFileArgs, context: ExecutorContext): ToolResult {
    const { paths, requiresConfirmation, permissionsPath, start } = context;

    // Check confirmation requirement BEFORE path check
    if (requiresConfirmation('delete_file') && args.confirm !== true) {
        return {
            ok: false,
            result: null,
            error: makeConfirmationError('delete_file', permissionsPath),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Validate and resolve path
    let targetPath: string;
    try {
        targetPath = paths.resolveAllowed(args.path, 'write'); // Delete requires write permission
    } catch {
        return {
            ok: false,
            result: null,
            error: makePermissionError(
                'delete_file',
                args.path,
                permissionsPath,
                ErrorCode.DENIED_PATH_ALLOWLIST
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Check if file exists
    try {
        const stats = fs.statSync(targetPath);
        if (stats.isDirectory()) {
            return {
                ok: false,
                result: null,
                error: makeError(ErrorCode.EXEC_ERROR, `Path '${args.path}' is a directory, not a file.`),
                _debug: makeDebug({
                    path: 'tool_json',
                    start,
                    model: null,
                    memory_read: false,
                    memory_write: false,
                }),
            };
        }
    } catch (err: any) {
        return {
            ok: false,
            result: null,
            error: makeError(ErrorCode.EXEC_ERROR, `File not found: ${err.message}`),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Delete the file
    try {
        fs.unlinkSync(targetPath);
    } catch (err: any) {
        return {
            ok: false,
            result: null,
            error: makeError(ErrorCode.EXEC_ERROR, `Failed to delete file: ${err.message}`),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    return {
        ok: true,
        result: { deleted: args.path },
        error: null,
        _debug: makeDebug({
            path: 'tool_json',
            start,
            model: null,
            memory_read: false,
            memory_write: false,
        }),
    };
}
```

### Step 3: Register Handler (`src/core/tool_registry.ts`)

Add import at the top:

```typescript
import {
    handleWriteFile,
    handleReadFile,
    handleListFiles,
    handleDeleteFile, // Add this
} from '../tools';
```

Add to `TOOL_HANDLERS` map:

```typescript
const TOOL_HANDLERS: Record<string, ToolHandler> = {
    // ... existing tools
    delete_file: handleDeleteFile,
};
```

### Step 4: Add to Agent Toolsets (`src/agents/index.ts`)

Add to appropriate agents. For `delete_file`, add to `READY_TOOLS`:

```typescript
const READY_TOOLS = [
    'read_file',
    'write_file',
    'list_files',
    'delete_file', // Add this
    // ... rest of tools
];
```

Or add to specific agent if it's agent-specific:

```typescript
export const CODER: Agent = {
    name: 'Coder',
    description: 'Technical coding assistant.',
    systemPrompt: '...',
    tools: [
        // ... existing tools
        'delete_file', // Add here
    ],
};
```

### Step 5: Add ToolSpec (`src/tools/schemas.ts`)

Add to `TOOL_SCHEMAS` for documentation:

```typescript
export const TOOL_SCHEMAS: Record<string, ToolSpec> = {
    // ... existing tools
    delete_file: {
        status: 'ready',
        description: 'Delete a file (requires confirmation).',
        required: ['path'],
        parameters: {
            path: { type: 'string', description: 'File path to delete.' },
            confirm: { type: 'boolean', description: 'Confirmation flag (required if tool requires confirmation).' },
        },
    },
};
```

### Step 6: Export Handler (`src/tools/index.ts`)

If you created a new file, export it:

```typescript
export * from './file_tools';
export * from './delete_tools'; // If you created a new file
```

If you added to existing file (like `file_tools.ts`), it's already exported.

### Step 7: Create Test File (`src/tools/file_tools.test.ts`)

Add tests following the pattern:

```typescript
import { describe, it, expect } from '../test_runner';
import { handleDeleteFile } from './file_tools';
import { createMockContext } from '../test_utils';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('handleDeleteFile', () => {
    it('should delete a file successfully', () => {
        const context = createMockContext();
        const testFile = path.join(context.baseDir, 'test.txt');
        
        // Create test file
        fs.writeFileSync(testFile, 'test content');
        
        const result = handleDeleteFile(
            { path: 'test.txt', confirm: true },
            context
        );
        
        expect(result.ok).toBe(true);
        expect(fs.existsSync(testFile)).toBe(false);
    });

    it('should require confirmation', () => {
        const context = createMockContext({
            permissions: {
                require_confirmation_for: ['delete_file'],
            },
        });
        
        const result = handleDeleteFile(
            { path: 'test.txt' }, // No confirm flag
            context
        );
        
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('CONFIRMATION_REQUIRED');
    });

    it('should reject paths outside baseDir', () => {
        const context = createMockContext();
        
        const result = handleDeleteFile(
            { path: '../../etc/passwd', confirm: true },
            context
        );
        
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('DENIED_PATH_ALLOWLIST');
    });
});
```

## Key Patterns to Follow

### 1. Error Handling

**Never use `throw`** - always return structured errors:

```typescript
// ❌ BAD
throw new Error('File not found');

// ✅ GOOD
return {
    ok: false,
    result: null,
    error: makeError(ErrorCode.EXEC_ERROR, 'File not found'),
    _debug: makeDebug({ /* ... */ }),
};
```

### 2. Path Validation

**Always use `context.paths.resolveAllowed()`**:

```typescript
// ❌ BAD
const filePath = path.join(context.baseDir, args.path);
fs.readFileSync(filePath);

// ✅ GOOD
let targetPath: string;
try {
    targetPath = paths.resolveAllowed(args.path, 'read');
} catch {
    return {
        ok: false,
        error: makePermissionError(/* ... */),
    };
}
fs.readFileSync(targetPath);
```

### 3. Confirmation Checks

**Check confirmation BEFORE path validation**:

```typescript
// Check confirmation first
if (requiresConfirmation('tool_name') && args.confirm !== true) {
    return {
        ok: false,
        error: makeConfirmationError('tool_name', permissionsPath),
    };
}

// Then validate path
const targetPath = paths.resolveAllowed(args.path, 'write');
```

### 4. Debug Info

**Always include accurate `_debug`**:

```typescript
_debug: makeDebug({
    path: 'tool_json',        // Routing path
    start,                    // From context.start
    model: null,              // LLM model if used, null otherwise
    memory_read: false,       // Did tool read from memory?
    memory_write: false,      // Did tool write to memory?
}),
```

### 5. Zod Schema Patterns

**Common patterns**:

```typescript
// Required string
z.string().min(1)

// Optional string
z.string().optional()

// Number with bounds
z.number().int().min(0).max(100)

// Enum
z.enum(['low', 'medium', 'high'])

// Boolean with default
z.boolean().optional().default(false)

// Nested object
z.object({
    name: z.string().min(1),
    age: z.number().int().min(0).optional(),
})
```

## Tool Categories

### File Operations
- Place in: `src/tools/file_tools.ts`
- Examples: `read_file`, `write_file`, `list_files`, `delete_file`, `move_file`, `copy_file`

### Git Operations
- Place in: `src/tools/git_tools.ts`
- Examples: `git_status`, `git_diff`, `git_log`, `git_add`, `git_commit`

### Memory/Task Operations
- Place in: `src/tools/memory_tools.ts` or `src/tools/task_tools.ts`
- Examples: `remember`, `recall`, `task_add`, `task_list`

### Utility Operations
- Place in: `src/tools/utility_tools.ts`
- Examples: `calculate`, `get_time`, `get_weather`

### Communication
- Place in: `src/tools/comms_tools.ts`
- Examples: `email_send`, `message_send`

### Productivity
- Place in: `src/tools/productivity_tools.ts`
- Examples: `contact_add`, `calendar_event_add`

## Checklist

Before completing a tool, verify:

- [ ] Zod schema defined in `src/core/types.ts`
- [ ] Schema added to `ToolSchemas` registry
- [ ] Handler function created with proper error handling
- [ ] Handler registered in `src/core/tool_registry.ts`
- [ ] Tool added to appropriate agent(s) in `src/agents/index.ts`
- [ ] ToolSpec added to `src/tools/schemas.ts`
- [ ] Handler exported from `src/tools/index.ts` (if new file)
- [ ] Test file created with success and error cases
- [ ] Path validation uses `context.paths.resolveAllowed()`
- [ ] Confirmation checks implemented (if needed)
- [ ] Debug info includes accurate flags
- [ ] All errors use `makeError()` (never `throw`)

## Common Mistakes to Avoid

1. **Forgetting to add schema to ToolSchemas registry** - Tool won't validate
2. **Not registering handler in tool_registry.ts** - Tool won't execute
3. **Not adding to agent toolsets** - Tool won't be accessible
4. **Using `throw` instead of returning errors** - Breaks error handling
5. **Not using `paths.resolveAllowed()`** - Security vulnerability
6. **Missing confirmation checks** - Security issue for destructive operations
7. **Incorrect debug flags** - Breaks analytics/debugging

## Testing Your Tool

After implementation:

```bash
# Run tests
npm test src/tools/[tool_name]_tools.test.ts

# Test in REPL
npm run dev:watch
# Then try: "delete file test.txt"

# Run preflight checks
npm run preflight
```

## Next Steps

After adding a tool:

1. **Commit automatically** (see `docs/03-workflow/GIT.md`)
2. **Update documentation** if tool is user-facing
3. **Add router patterns** in `src/app/router.ts` (optional, for natural language matching)

## Example: Complete Tool Implementation

See existing tools for complete examples:
- `src/tools/file_tools.ts` - File operations
- `src/tools/task_tools.ts` - Task management
- `src/tools/git_tools.ts` - Git operations

## Related Documentation

- `docs/02-guides/ADDING_TOOLS_GUIDE.md` - Tool implementation patterns
- `docs/04-reference/ERRORS.md` - Error handling patterns
- `docs/01-concepts/SECURITY.md` - Security patterns
- `docs/03-workflow/TESTING.md` - Testing patterns
- `docs/02-guides/ADDING_TOOLS_GUIDE.md` - Implementer role guide

# Quick Reference: Adding Tools with `/impl_add_tool`

## 5-Step Checklist

### ✅ Step 1: Zod Schema (`src/core/types.ts`)
```typescript
// Define schema
export const MyToolSchema = z.object({
    field: z.string().min(1),
    optional: z.number().optional(),
});
export type MyToolArgs = z.infer<typeof MyToolSchema>;

// Add to registry
export const ToolSchemas: Record<string, z.ZodTypeAny> = {
    // ... existing
    my_tool: MyToolSchema,
};
```

### ✅ Step 2: Handler Function (`src/tools/[category]_tools.ts`)
```typescript
export function handleMyTool(args: MyToolArgs, context: ExecutorContext): ToolResult {
    const { paths, start } = context;
    
    // Validate path (if file operation)
    let targetPath: string;
    try {
        targetPath = paths.resolveAllowed(args.path, 'read');
    } catch {
        return {
            ok: false,
            error: makePermissionError(/* ... */),
            _debug: makeDebug({ path: 'tool_json', start, model: null, memory_read: false, memory_write: false }),
        };
    }
    
    // Implementation...
    
    return {
        ok: true,
        result: { /* ... */ },
        error: null,
        _debug: makeDebug({ path: 'tool_json', start, model: null, memory_read: false, memory_write: false }),
    };
}
```

### ✅ Step 3: Register Handler (`src/core/tool_registry.ts`)
```typescript
// Import
import { handleMyTool } from '../tools/[category]_tools';

// Add to map
const TOOL_HANDLERS: Record<string, ToolHandler> = {
    // ... existing
    my_tool: handleMyTool,
};
```

### ✅ Step 4: Add to Agent (`src/agents/index.ts`)
```typescript
const READY_TOOLS = [
    // ... existing
    'my_tool',
];
```

### ✅ Step 5: Add ToolSpec (`src/tools/schemas.ts`)
```typescript
export const TOOL_SCHEMAS: Record<string, ToolSpec> = {
    // ... existing
    my_tool: {
        status: 'ready',
        description: 'What this tool does.',
        required: ['field'],
        parameters: {
            field: { type: 'string', description: 'Field description.' },
        },
    },
};
```

## File Locations by Tool Type

| Tool Type | Handler File | Examples |
|-----------|--------------|----------|
| File ops | `src/tools/file_tools.ts` | `read_file`, `write_file`, `delete_file` |
| Git ops | `src/tools/git_tools.ts` | `git_status`, `git_diff`, `git_commit` |
| Memory | `src/tools/memory_tools.ts` | `remember`, `recall`, `memory_add` |
| Tasks | `src/tools/task_tools.ts` | `task_add`, `task_list`, `task_done` |
| Utility | `src/tools/utility_tools.ts` | `calculate`, `get_time`, `get_weather` |
| Comm | `src/tools/comms_tools.ts` | `email_send`, `message_send` |
| Productivity | `src/tools/productivity_tools.ts` | `contact_add`, `calendar_event_add` |

## Critical Patterns

### ❌ Never Do This
```typescript
throw new Error('...');  // Never throw
const path = path.join(baseDir, userInput);  // Never construct paths directly
fs.readFileSync(userPath);  // Never use raw fs without validation
```

### ✅ Always Do This
```typescript
return { ok: false, error: makeError(ErrorCode.EXEC_ERROR, '...') };  // Return errors
const safePath = paths.resolveAllowed(args.path, 'read');  // Use capability API
// Use context.paths, context.commands, context.readJsonl, etc.
```

## Common Zod Patterns

```typescript
// Required string
z.string().min(1)

// Optional with default
z.string().optional().default('')

// Number with bounds
z.number().int().min(0).max(100)

// Enum
z.enum(['low', 'medium', 'high'])

// Boolean
z.boolean().optional()
```

## Confirmation Pattern

```typescript
// Check BEFORE path validation
if (requiresConfirmation('tool_name') && args.confirm !== true) {
    return {
        ok: false,
        error: makeConfirmationError('tool_name', permissionsPath),
    };
}
```

## Test Template

```typescript
import { describe, it, expect } from '../test_runner';
import { handleMyTool } from './[category]_tools';
import { createMockContext } from '../test_utils';

describe('handleMyTool', () => {
    it('should succeed with valid args', () => {
        const context = createMockContext();
        const result = handleMyTool({ field: 'value' }, context);
        expect(result.ok).toBe(true);
    });

    it('should fail with invalid path', () => {
        const context = createMockContext();
        const result = handleMyTool({ path: '../../etc/passwd' }, context);
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('DENIED_PATH_ALLOWLIST');
    });
});
```

## Quick Commands

```bash
# Test your tool
npm test src/tools/[tool_name]_tools.test.ts

# Test in REPL
npm run dev:watch

# Run preflight
npm run preflight
```

## See Also

- Full guide: `docs/ADDING_TOOLS_GUIDE.md`
- Patterns: `docs/02-guides/ADDING_TOOLS_GUIDE.md`
- Errors: `docs/04-reference/ERRORS.md`
- Security: `docs/01-concepts/SECURITY.md`

