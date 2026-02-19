# Debugging Guide

## Verbose Mode

Enable verbose output for debugging:

```bash
# CLI
./cli.js --verbose "remember: test"

# REPL
/verbose on
```

Verbose mode shows:
- Agent selection
- Provider selection
- Routing path (regex/heuristic/LLM)
- Tool schemas sent to LLM
- Token usage

## Debug Info in Results

Every tool result includes `_debug`:

```typescript
{
    ok: true,
    result: { ... },
    _debug: {
        path: 'regex_fast_path',  // How request was routed
        duration_ms: 12,           // Execution time
        model: null,               // LLM model if used
        memory_read: true,         // Did tool read memory?
        memory_write: false,       // Did tool write memory?
    }
}
```

### Debug Path Values

| Path | Meaning |
|------|---------|
| `regex_fast_path` | Matched pre-compiled regex pattern |
| `heuristic_parse` | Matched heuristic parser |
| `cli_parse` | Matched task/memory parser |
| `llm_fallback` | Routed to LLM |
| `tool_json` | Direct tool execution |

## Common Issues

### "Command not allowed"

```
DENIED_COMMAND_ALLOWLIST: Command 'xyz' is not allowed
```

**Fix**: Add command to `permissions.json`:
```json
{
    "allow_commands": ["ls", "pwd", "cat", "xyz"]
}
```

### "Path not allowed"

```
DENIED_PATH_ALLOWLIST: Path 'foo/bar' is not allowed
```

**Fix**: Add path to `permissions.json`:
```json
{
    "allow_paths": ["./", "foo/"]
}
```

### "No API key configured"

```
Error: No API key for provider 'groq'
```

**Fix**: Set environment variable:
```bash
export GROQ_API_KEY=your-key
```

Or create config file:
```bash
mkdir -p ~/.assistant
echo '{"apiKeys":{"groq":"your-key"}}' > ~/.assistant/config.json
```

### "Tool requires agent context"

```
DENIED_AGENT_TOOLSET: tool 'X' requires agent context
```

**Fix**: Use `--agent` flag:
```bash
./cli.js --agent system "read file.txt"
```

## Logging

Add strategic logging:

```typescript
// Use consistent prefixes
console.log('[Router] Matched tool:', toolName);
console.log('[Executor] Running:', toolName, args);
console.error('[Error] Failed:', err.message);

// Conditional verbose logging
if (verbose) {
    console.log('[Verbose] Full context:', JSON.stringify(context, null, 2));
}
```

**Important**: Debug logs should go to stderr, not stdout. See `docs/01-concepts/ARCHITECTURE.md` for logging conventions.

## Inspecting Data Files

Check stored data (paths depend on `ASSISTANT_DATA_DIR`; defaults to `{project}/data/`):

```bash
# Memory (using ASSISTANT_DATA_DIR or project default)
cat ${ASSISTANT_DATA_DIR:-./data}/memory.json | jq .

# Tasks
cat ${ASSISTANT_DATA_DIR:-./data}/tasks.jsonl

# Audit log (last 10 entries)
tail -10 ${ASSISTANT_DATA_DIR:-./data}/audit.jsonl | jq .
```

## Test Debugging

Run single test with output:

```bash
npm run build
TEST_DIST=1 node dist/executor.test.js 2>&1 | tee test.log
```

Check test output file:

```bash
cat src/executor.test.output.txt
```

## Doctor Command

Run diagnostics:

```bash
npm run doctor
```

Checks:
- Config file exists and is valid
- Data directory writable
- Permissions file valid
- API keys configured

## Tracing a Request

To trace a request through the system:

### 1. Router
```typescript
// In route()
console.log('[Trace] Input:', body);
console.log('[Trace] Matched regex:', matchedPattern);
console.log('[Trace] Heuristic result:', heuristicCommand);
console.log('[Trace] Final route:', result.mode, result.tool_call?.tool_name);
```

### 2. Executor
```typescript
// In execute()
console.log('[Trace] Tool:', toolName);
console.log('[Trace] Args:', JSON.stringify(args));
console.log('[Trace] Agent:', this.agent?.name);
console.log('[Trace] Result:', result.ok, result.error?.code);
```

### 3. Tool Handler
```typescript
// In handler
console.log('[Trace] Handler start:', toolName, args);
console.log('[Trace] Handler result:', { ok, result: result?.substring?.(0, 100) });
```

## Performance Profiling

Add timing:

```typescript
const start = Date.now();
// ... operation
console.log(`[Perf] ${operationName}: ${Date.now() - start}ms`);
```

For benchmarks, use:
```bash
npm run build
node dist/benchmarks/executor_bench.js
```

## Handling Stuck Operations

### When Operations Hang or Don't Return

**If a tool call or command seems stuck:**

1. **Check for timeout**: Most operations have built-in timeouts:
   - Git commands: 10 seconds (`git_tools.ts`)
   - LLM requests: 60 seconds (`openai_compatible.ts`)
   - Fetch requests: 6 seconds (`utility_tools.ts`)
   - File reads: No timeout (synchronous, should be instant)

2. **If a command hangs:**
   ```bash
   # Check if process is actually running
   ps aux | grep <command>
   
   # Kill stuck process if needed
   kill -9 <PID>
   ```

3. **If file read fails silently:**
   - Check file exists: `ls -la <path>`
   - Check permissions: `stat <path>`
   - Try reading with `cat` to see error message
   - File may be locked by another process

4. **If terminal command returns nothing:**
   - Check exit code: `echo $?` (0 = success, non-zero = error)
   - Check stderr: Some commands write errors to stderr only
   - Command may be waiting for input (use `timeout` wrapper)
   - Command may be buffering output (use `stdbuf` or add `--no-buffer`)

### Timeout Patterns in Code

**For spawnSync commands:**
```typescript
const result = spawnSync('command', args, {
    timeout: 10000,  // 10 second timeout
    maxBuffer: 10 * 1024 * 1024,  // 10MB max output
    encoding: 'utf8'
});

if (result.error) {
    // Handle timeout or spawn error
    if (result.error.code === 'ETIMEDOUT') {
        return { ok: false, error: 'Command timed out' };
    }
}
```

**For async operations:**
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 60000);

try {
    const result = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return result;
} catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
        return { ok: false, error: 'Request timed out' };
    }
    throw err;
}
```

### When to Give Up

**Stop retrying and ask for help if:**
- Operation has timed out 3+ times
- File read fails with permission denied (may need user intervention)
- Command consistently hangs (may be waiting for user input)
- Error message is unclear and you've tried 2-3 approaches

**Before giving up, try:**
1. Check if file/command exists
2. Verify permissions
3. Try alternative approach (e.g., `cat` instead of `read_file`)
4. Check if process is stuck: `ps aux | grep <name>`
5. Read error message carefully (may indicate the issue)

### File Read Failures

**Common causes:**
- File doesn't exist: Check with `ls` or `test -f`
- Permission denied: Check with `stat` or `ls -la`
- File is directory: Use `list_files` instead
- File is locked: Another process has it open
- Path traversal blocked: Check `allow_paths` in permissions.json

**Recovery:**
```typescript
// Always wrap file reads in try/catch
try {
    const content = fs.readFileSync(path, 'utf8');
    return { ok: true, result: content };
} catch (err: any) {
    // Check specific error types
    if (err.code === 'ENOENT') {
        return { ok: false, error: 'File not found' };
    }
    if (err.code === 'EACCES') {
        return { ok: false, error: 'Permission denied' };
    }
    return { ok: false, error: `Read failed: ${err.message}` };
}
```

### Command Execution Failures

**Check result object:**
```typescript
const result = spawnSync('command', args, { timeout: 10000 });

if (result.error) {
    // Process failed to start or timed out
    return { ok: false, error: result.error.message };
}

if (result.signal) {
    // Process was killed by signal
    return { ok: false, error: `Terminated by signal ${result.signal}` };
}

if (result.status !== 0) {
    // Command failed (check stderr for details)
    const error = result.stderr || `Command failed with status ${result.status}`;
    return { ok: false, error };
}
```

### Debugging Stuck Operations

**Add timeout wrapper for testing:**
```bash
# Test if command hangs
timeout 5 command args

# Or use with spawnSync timeout option (already in code)
```

**Check what's happening:**
```bash
# See if process is running
ps aux | grep node

# Check file locks (macOS)
lsof <file-path>

# Check network connections
netstat -an | grep ESTABLISHED
```

**If Cursor itself seems stuck:**
- Check if tool call is waiting for response
- Look for error messages in stderr
- Try simpler operation to verify system is responsive
- May need to restart Cursor if completely frozen

## Cursor AI: Detecting Terminal Hanging

### When Running Terminal Commands via Tools

**Cursor AI should detect hanging terminal commands and abort gracefully:**

1. **Timeout Detection**:
   - If `run_terminal_cmd` tool call exceeds expected duration:
     - Git commands: > 15 seconds (normal: < 10s)
     - File operations: > 5 seconds (normal: < 1s)
     - Build commands: > 60 seconds (normal: < 30s)
     - General commands: > 30 seconds (normal: < 10s)
   - **Action**: Abort tool call, report timeout to user

2. **No Response Detection**:
   - If command returns no output after 20 seconds
   - If command shows no progress indicators
   - **Action**: Check if process is stuck, abort if needed

3. **Pattern Recognition**:
   ```typescript
   // Signs a command is hanging:
   - No output for > 20 seconds
   - Process still running but no progress
   - Command waiting for input (detect prompts)
   - Network request stuck (no response)
   - File operation blocked (permissions/locks)
   ```

4. **Abort Strategy**:
   - If timeout detected: Report to user immediately
   - Don't wait indefinitely for tool responses
   - Suggest alternative approaches
   - Check if command needs user input

### Cursor AI Behavior for Stuck Commands

**When a terminal command appears stuck:**

1. **Wait reasonable time** (based on command type):
   - Quick commands (ls, cat): 5 seconds max
   - Medium commands (git status, npm install): 30 seconds max
   - Long commands (build, tests): 60 seconds max

2. **If no response after timeout**:
   ```markdown
   "Command appears to be hanging. This may indicate:
   - Process waiting for input
   - Network timeout
   - File lock/permission issue
   - Process stuck in infinite loop
   
   Attempting to abort and check status..."
   ```

3. **Check process status**:
   ```bash
   # Check if process is actually running
   ps aux | grep <command-name>
   
   # Check if file is locked
   lsof <file-path>
   ```

4. **Report to user**:
   - Explain what command was running
   - Suggest possible causes
   - Offer alternative approaches
   - Don't retry indefinitely

### Tool Call Timeout Guidelines

**For Cursor AI when using `run_terminal_cmd`:**

| Command Type | Max Wait Time | When to Abort |
|-------------|---------------|---------------|
| File read/write | 5 seconds | If no response |
| Git commands | 15 seconds | If no output |
| npm/node commands | 60 seconds | If no progress |
| Build/compile | 90 seconds | If stuck |
| Network requests | 30 seconds | If no response |
| Test execution | 120 seconds | If no output |

**Abort pattern:**
```markdown
"Command '[command]' appears to be hanging after [X] seconds.
This may indicate:
- [Possible cause 1]
- [Possible cause 2]

Attempting to check process status or abort..."
```

### Preventing Hanging in Tool Calls

**Always use timeouts in code:**
```typescript
// ✅ Good: Has timeout
const result = spawnSync('command', args, {
    timeout: 10000,  // 10 second timeout
    maxBuffer: 10 * 1024 * 1024
});

// ❌ Bad: No timeout (can hang forever)
const result = spawnSync('command', args);
```

**For async operations:**
```typescript
// ✅ Good: AbortController with timeout
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 30000);

try {
    const result = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return result;
} catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
        return { ok: false, error: 'Request timed out' };
    }
    throw err;
}
```

### Cursor AI Detection Checklist

**Before assuming a command is stuck, check:**

- [ ] Has it been > 20 seconds with no output?
- [ ] Is the command type known to be slow?
- [ ] Are there any error messages in stderr?
- [ ] Is the process actually running? (`ps aux | grep`)
- [ ] Is there a file lock? (`lsof <file>`)
- [ ] Is the command waiting for input? (check for prompts)

**If command is confirmed stuck:**
1. Report to user immediately
2. Explain what was attempted
3. Suggest alternative approach
4. Don't retry the same command

### Example: Handling Hanging Git Command

```markdown
User: "Check git status"

Cursor AI runs: git status

After 15 seconds with no response:

Cursor AI reports:
"Git status command appears to be hanging. This may indicate:
- Large repository taking time to scan
- Git lock file present (.git/index.lock)
- Network issue if using remote

Checking for git lock file..."

Cursor AI checks: ls -la .git/index.lock

If lock exists:
"Found git lock file. Another git process may be running.
Please wait for it to complete or remove the lock file manually."

If no lock:
"Git command is taking longer than expected. This may be normal for large repositories.
Would you like me to try a different approach or wait longer?"
```

