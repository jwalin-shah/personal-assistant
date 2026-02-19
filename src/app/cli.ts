#!/usr/bin/env node

/**
 * Assistant CLI - Unified entry point
 *
 * Subcommands:
 *   remember <text>     - Store in memory
 *   recall <query>      - Search memory
 *   task add <text>     - Add a task
 *   task list           - List tasks
 *   task done <id>      - Complete task
 *   remind add <text> --in <duration>  - Add reminder
 *   run <command>       - Execute safe shell command
 *   repl                - Interactive mode
 *   demo                - Run demo flow
 *
 * Flags:
 *   --human             - Human-readable output (default: JSON)
 *   --help              - Show help
 *   --version           - Show version
 *
 * @module cli
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CLIResult, ResolvedConfig, RouteResult, ToolResult } from '../core';
import {
    Executor,
    FileCache,
    TestCache,
    generateCorrelationId,
    getPackageVersion,
    isRouteError,
    isRouteReply,
    isRouteToolCall,
    loadAllPlugins,
    parseArgs,
    printResult,
    setHumanMode,
} from '../core';
import { CursorCommandLogger } from '../core/cursor_command_log';
import { SAFE_TOOLS } from '../core/types';
import type { Runtime } from '../runtime';
import { initializeRuntime } from '../runtime';
import { route } from './router';

/**
 * Convert executor ToolResult to CLI-friendly format
 */
function toCliResult(result: ToolResult): CLIResult {
    return {
        ok: result.ok,
        result: result.result,
        error: result.error ? result.error.message : undefined,
        _debug: result._debug,
    };
}

const VERSION = getPackageVersion();

const USAGE = `
Assistant CLI v${VERSION}

Usage: assistant <command> [options]

Commands:
  remember <text>              Store information in memory
  recall <query>               Search memory
  task add <text>              Add a new task
  task list [--status open|done|all]  List tasks
  task done <id>               Mark task as done
  remind add <text> --in <seconds>    Add a reminder
  run <command>                Execute shell command (ls|pwd|cat|du)
  git status                   Show git working tree status
  git diff [--staged]          Show changes
  git log [--limit N]          Show recent commits
  audit [--limit N]            View audit trail
  logs [recent|stats|errors]    Review command logs and metrics
  cursor [stats|recent|errors|eval]  Review Cursor IDE command logs and metrics
  cursor eval [--command NAME] [--project-only]  Evaluate Cursor custom commands
  cache clear                   Clear LLM response cache
  cache stats                   Show cache statistics
  cache test-clear              Clear test result cache
  generate tool <name> [--args] Generate new tool with boilerplate
  generate tests <name>         Generate tests for existing tool
  profile "<command>"            Profile command execution performance
  plugins list                  List loaded plugins
  web [--port N]               Start web dashboard
  repl                         Start interactive mode
  demo                         Run demonstration flow
  explain "<command>"           Explain routing decision (debugging)

Options:
  --human                      Human-readable output (default: JSON)
  --verbose                    Verbose output
  --mock                       Use mock provider (no API calls)
  --stream                     Enable streaming responses (REPL only, default: true)
  --no-stream                  Disable streaming responses (REPL only)
  --help                       Show this help
  --version                    Show version

Examples:
  assistant remember "Meeting at 3pm with Alice"
  assistant recall "meeting Alice"
  assistant task add "Review PR #123"
  assistant task list --human
  assistant git status --human
  assistant demo
`.trim();

interface ParsedArgs {
    command: string;
    subcommand: string | null;
    args: string[];
    flags: Record<string, string | boolean>;
}

/**
 * Parse CLI arguments using the shared arg_parser.
 * Maps to the CLI-specific ParsedArgs structure.
 */
function parseCliArgs(argv: string[]): ParsedArgs {
    const { flags, positionals } = parseArgs(argv, {
        valueFlags: ['in', 'status', 'limit', 'port'],
        booleanFlags: [
            'human',
            'verbose',
            'help',
            'version',
            'staged',
            'mock',
            'stream',
            'no-stream',
        ],
    });

    const command = positionals[0] || '';
    let subcommand: string | null = null;
    let args = positionals.slice(1);

    // Handle compound commands like "task add", "git status", "generate tool", "cache clear", "logs stats"
    if (
        ['task', 'remind', 'git', 'generate', 'cache', 'plugins', 'logs'].includes(command) &&
        positionals.length > 1
    ) {
        subcommand = positionals[1];
        args = positionals.slice(2);
    }

    return { command, subcommand, args, flags };
}

async function main() {
    const argv = process.argv.slice(2);
    const { command, subcommand, args, flags } = parseCliArgs(argv);

    const human = !!flags['human'];
    const verbose = !!flags['verbose'];
    const mock = !!flags['mock'];
    setHumanMode(human);

    // Handle global flags
    if (flags['help'] || command === 'help') {
        console.log(USAGE);
        process.exit(0);
    }

    if (flags['version'] || command === 'version') {
        console.log(VERSION);
        process.exit(0);
    }

    if (!command) {
        console.log(USAGE);
        process.exit(0);
    }

    // Build runtime via composition root (single place for wiring)
    const runtime = initializeRuntime({ mock });
    const { config: resolvedConfig } = runtime;

    // Route to command handlers
    let result: CLIResult;

    switch (command) {
        case 'remember':
            result = await handleRemember(runtime, args, verbose);
            break;

        case 'recall':
            result = await handleRecall(runtime, args, verbose);
            break;

        case 'task':
            result = await handleTask(runtime, subcommand, args, flags, verbose);
            break;

        case 'remind':
            result = await handleRemind(runtime, subcommand, args, flags, verbose);
            break;

        case 'run':
            result = await handleRun(runtime, args, verbose);
            break;

        case 'git':
            result = await handleGit(runtime, subcommand, flags, verbose);
            break;

        case 'audit':
            result = handleAudit(flags, resolvedConfig); // Audit is synchronous (reads file directly)
            break;

        case 'logs':
            result = handleLogs(subcommand, flags, runtime);
            break;

        case 'cursor':
            if (subcommand === 'eval' || subcommand === 'commands') {
                result = await handleCursorEval(flags, runtime);
            } else {
                result = handleCursor(subcommand, flags);
            }
            break;

        case 'cache':
            result = handleCache(subcommand, flags);
            break;

        case 'generate':
            result = handleGenerate(subcommand, args, flags);
            break;

        case 'profile':
            result = await handleProfile(runtime, args, flags, verbose);
            break;

        case 'web': {
            const webPort = flags['port'] ? parseInt(flags['port'] as string, 10) : 3000;
            const { startWebServer } = require('./web/server');
            startWebServer({ port: webPort, baseDir: resolvedConfig.fileBaseDir });
            return; // Server keeps process alive
        }

        case 'repl': {
            // Lazy import to avoid circular dependencies
            const { startRepl } = require('./repl');
            const enableStream = flags['stream'] !== false; // Default: enabled
            startRepl({ verbose, stream: enableStream });
            return; // REPL keeps process alive
        }

        case 'demo':
            await handleDemo(runtime.executor, human);
            return;

        case 'explain':
            result = await handleExplain(runtime, args, verbose);
            break;

        default:
            result = { ok: false, error: `Unknown command: ${command}. Use --help for usage.` };
    }

    printResult(result, human);
    process.exit(result.ok ? 0 : 1);
}

// Helper: Route CLI command through Router and execute
async function routeAndExecute(
    input: string,
    runtime: Runtime,
    verbose: boolean = false
): Promise<CLIResult> {
    const correlationId = generateCorrelationId();

    try {
        const routed = await route(
            input,
            'spike',
            null,
            [],
            verbose,
            runtime.defaultAgent,
            runtime.provider,
            { enableRegex: true, toolFormat: 'compact', toolSchemas: runtime.toolSchemas },
            runtime.config
        );

        let toolResult: ToolResult | undefined = undefined;

        if (isRouteError(routed)) {
            // Log command with routing error
            runtime.commandLogger.logCommand(correlationId, input, routed, undefined, {
                intent: 'spike',
                agent: runtime.defaultAgent?.name,
            });
            return { ok: false, error: routed.error };
        }

        if (isRouteToolCall(routed)) {
            toolResult = await runtime.executor.execute(
                routed.tool_call.tool_name,
                routed.tool_call.args
            );

            // Log command with routing and tool execution results
            runtime.commandLogger.logCommand(correlationId, input, routed, toolResult, {
                intent: 'spike',
                agent: runtime.defaultAgent?.name,
            });

            return toCliResult(toolResult);
        } else if (isRouteReply(routed)) {
            // Log command with reply mode
            runtime.commandLogger.logCommand(correlationId, input, routed, undefined, {
                intent: 'spike',
                agent: runtime.defaultAgent?.name,
            });
            // Router returned a reply instead of a tool call
            return { ok: true, result: routed.reply.content || 'No response' };
        } else {
            // Log command with unknown result
            runtime.commandLogger.logCommand(correlationId, input, routed, undefined, {
                intent: 'spike',
                agent: runtime.defaultAgent?.name,
            });
            return { ok: false, error: 'Router did not return a tool call or reply' };
        }
    } catch (err: unknown) {
        // Log command with exception
        const message = err instanceof Error ? err.message : 'Routing failed';
        const errorRouteResult = {
            error: message,
            _debug: {
                path: 'exception',
                duration_ms: null,
                model: null,
                memory_read: false,
                memory_write: false,
            },
        } as const;
        runtime.commandLogger.logCommand(
            correlationId,
            input,
            errorRouteResult as unknown as RouteResult,
            undefined,
            {
                intent: 'spike',
                agent: runtime.defaultAgent?.name,
            }
        );
        return { ok: false, error: message };
    }
}

// Command Handlers

async function handleRemember(
    runtime: Runtime,
    args: string[],
    verbose: boolean
): Promise<CLIResult> {
    const text = args.join(' ').trim();
    if (!text) {
        return { ok: false, error: 'Usage: assistant remember <text>' };
    }
    return await routeAndExecute(`remember: ${text}`, runtime, verbose);
}

async function handleRecall(
    runtime: Runtime,
    args: string[],
    verbose: boolean
): Promise<CLIResult> {
    const query = args.join(' ').trim();
    if (!query) {
        return { ok: false, error: 'Usage: assistant recall <query>' };
    }
    return await routeAndExecute(`recall: ${query}`, runtime, verbose);
}

async function handleTask(
    runtime: Runtime,
    subcommand: string | null,
    args: string[],
    flags: Record<string, string | boolean>,
    verbose: boolean
): Promise<CLIResult> {
    switch (subcommand) {
        case 'add': {
            const text = args.join(' ').trim();
            if (!text) {
                return { ok: false, error: 'Usage: assistant task add <text>' };
            }
            return await routeAndExecute(`task add ${text}`, runtime, verbose);
        }

        case 'list': {
            const status = (flags['status'] as string) || 'all';
            const input = status === 'all' ? 'task list' : `task list --status ${status}`;
            return await routeAndExecute(input, runtime, verbose);
        }

        case 'done': {
            const id = parseInt(args[0], 10);
            if (isNaN(id)) {
                return { ok: false, error: 'Usage: assistant task done <id>' };
            }
            return await routeAndExecute(`task done ${id}`, runtime, verbose);
        }

        default:
            return { ok: false, error: 'Usage: assistant task <add|list|done> [args]' };
    }
}

async function handleRemind(
    runtime: Runtime,
    subcommand: string | null,
    args: string[],
    flags: Record<string, string | boolean>,
    verbose: boolean
): Promise<CLIResult> {
    if (subcommand !== 'add') {
        return { ok: false, error: 'Usage: assistant remind add <text> --in <seconds>' };
    }

    const text = args.join(' ').trim();
    const inSeconds = parseInt(flags['in'] as string, 10);

    if (!text || isNaN(inSeconds)) {
        return { ok: false, error: 'Usage: assistant remind add <text> --in <seconds>' };
    }

    // Convert seconds to appropriate unit for Router's task parser
    let unit = 'second';
    let amount = inSeconds;
    if (inSeconds >= 3600 && inSeconds % 3600 === 0) {
        unit = 'hour';
        amount = inSeconds / 3600;
    } else if (inSeconds >= 60 && inSeconds % 60 === 0) {
        unit = 'minute';
        amount = inSeconds / 60;
    }

    // Format for Router's task parser: "remind me in X seconds/minutes/hours to Y"
    const routerInput = `remind me in ${amount} ${unit}${amount !== 1 ? 's' : ''} to ${text}`;
    return await routeAndExecute(routerInput, runtime, verbose);
}

async function handleRun(runtime: Runtime, args: string[], verbose: boolean): Promise<CLIResult> {
    const command = args.join(' ').trim();
    if (!command) {
        return { ok: false, error: 'Usage: assistant run <command>' };
    }
    return await routeAndExecute(`run ${command}`, runtime, verbose);
}

async function handleGit(
    runtime: Runtime,
    subcommand: string | null,
    flags: Record<string, string | boolean>,
    verbose: boolean
): Promise<CLIResult> {
    switch (subcommand) {
        case 'status':
            return await routeAndExecute('git status', runtime, verbose);

        case 'diff': {
            const stagedFlag = flags['staged'] ? ' --staged' : '';
            return await routeAndExecute(`git diff${stagedFlag}`, runtime, verbose);
        }

        case 'log': {
            const limit = flags['limit'] ? parseInt(flags['limit'] as string, 10) : 10;
            return await routeAndExecute(`git log --limit ${limit}`, runtime, verbose);
        }

        default:
            return { ok: false, error: 'Usage: assistant git <status|diff|log> [options]' };
    }
}

function handleAudit(flags: Record<string, string | boolean>, config: ResolvedConfig): CLIResult {
    const limit = flags['limit'] ? parseInt(flags['limit'] as string, 10) : 20;
    const baseDir = config.fileBaseDir;
    const auditPath = path.join(baseDir, 'audit.jsonl');

    if (!fs.existsSync(auditPath)) {
        return { ok: true, result: { entries: [], message: 'No audit entries yet' } };
    }

    try {
        const lines = fs.readFileSync(auditPath, 'utf8').split('\n').filter(Boolean).slice(-limit);

        const entries = lines
            .map(line => {
                try {
                    return JSON.parse(line);
                } catch {
                    return null;
                }
            })
            .filter(Boolean);

        return { ok: true, result: { count: entries.length, entries } };
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { ok: false, error: `Failed to read audit log: ${message}` };
    }
}

function handleLogs(
    subcommand: string | null,
    flags: Record<string, string | boolean>,
    runtime: Runtime
): CLIResult {
    const limit = flags['limit'] ? parseInt(flags['limit'] as string, 10) : 50;
    const statsOnly = flags['stats'] === true;
    const category = flags['category'] as string | undefined;
    const tool = flags['tool'] as string | undefined;
    const outcome = flags['outcome'] as string | undefined;

    try {
        const entries = runtime.commandLogger.readLogs();

        // Filter entries
        let filtered = entries;
        if (category) {
            filtered = filtered.filter(e => e.outcome_category === category);
        }
        if (tool) {
            filtered = filtered.filter(e => e.tool_name === tool);
        }
        if (outcome) {
            filtered = filtered.filter(e => e.outcome === outcome);
        }

        // Limit results
        const limited = filtered.slice(0, limit);

        if (statsOnly || subcommand === 'stats') {
            // Return statistics
            const stats = runtime.commandLogger.getStats(filtered);
            return {
                ok: true,
                result: {
                    summary: {
                        total: stats.total,
                        success: stats.success,
                        error: stats.error,
                        partial: stats.partial,
                        success_rate:
                            stats.total > 0
                                ? ((stats.success / stats.total) * 100).toFixed(1) + '%'
                                : '0%',
                        avg_latency_ms: Math.round(stats.avgLatency),
                    },
                    by_category: stats.byCategory,
                    by_routing_path: stats.byRoutingPath,
                    by_tool: stats.byTool,
                    llm_usage: {
                        total_tokens: stats.llmUsage.totalTokens,
                        total_calls: stats.llmUsage.totalCalls,
                        avg_tokens_per_call:
                            stats.llmUsage.totalCalls > 0
                                ? Math.round(stats.llmUsage.totalTokens / stats.llmUsage.totalCalls)
                                : 0,
                    },
                },
            };
        } else if (subcommand === 'recent' || !subcommand) {
            // Return recent entries
            return {
                ok: true,
                result: {
                    count: limited.length,
                    entries: limited.map(e => ({
                        ts: e.ts,
                        input: e.input,
                        outcome: e.outcome,
                        category: e.outcome_category,
                        routing_path: e.routing_path,
                        tool_name: e.tool_name,
                        tool_success: e.tool_success,
                        error: e.routing_error || e.tool_error,
                        duration_ms: e.tool_duration_ms || e.routing_duration_ms,
                    })),
                },
            };
        } else if (subcommand === 'errors') {
            // Return only errors
            const errors = filtered.filter(e => e.outcome === 'error').slice(0, limit);
            return {
                ok: true,
                result: {
                    count: errors.length,
                    entries: errors.map(e => ({
                        ts: e.ts,
                        input: e.input,
                        routing_path: e.routing_path,
                        tool_name: e.tool_name,
                        error: e.routing_error || e.tool_error,
                    })),
                },
            };
        } else {
            return {
                ok: false,
                error: 'Usage: assistant logs [recent|stats|errors] [--limit N] [--category CAT] [--tool TOOL] [--outcome success|error|partial] [--stats]',
            };
        }
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { ok: false, error: `Failed to read command logs: ${message}` };
    }
}

function handleCursor(
    subcommand: string | null,
    flags: Record<string, string | boolean>
): CLIResult {
    const limit = flags['limit'] ? parseInt(flags['limit'] as string, 10) : 50;
    const statsOnly = flags['stats'] === true;
    const category = flags['category'] as string | undefined;
    const command = flags['command'] as string | undefined;

    try {
        const logger = new CursorCommandLogger();
        const entries = logger.readLogs();

        // Filter entries
        let filtered = entries;
        if (category) {
            filtered = filtered.filter(e => e.category === category);
        }
        if (command) {
            filtered = filtered.filter(e => e.command_id === command);
        }

        // Limit results
        const limited = filtered.slice(0, limit);

        if (statsOnly || subcommand === 'stats') {
            // Return statistics
            const stats = logger.getStats(filtered);
            return {
                ok: true,
                result: {
                    summary: {
                        total: stats.total,
                        success: stats.success,
                        error: stats.error,
                        success_rate: stats.success_rate,
                        avg_latency_ms: stats.avg_latency_ms,
                    },
                    by_category: stats.by_category,
                    by_command: stats.by_command,
                },
            };
        } else if (subcommand === 'recent' || !subcommand) {
            // Return recent entries
            return {
                ok: true,
                result: {
                    count: limited.length,
                    entries: limited.map(e => ({
                        ts: e.ts,
                        command_id: e.command_id,
                        command_title: e.command_title,
                        category: e.category,
                        success: e.success,
                        error: e.error,
                        duration_ms: e.duration_ms,
                        context: e.context,
                    })),
                },
            };
        } else if (subcommand === 'errors') {
            // Return only errors
            const errors = filtered.filter(e => !e.success).slice(0, limit);
            return {
                ok: true,
                result: {
                    count: errors.length,
                    entries: errors.map(e => ({
                        ts: e.ts,
                        command_id: e.command_id,
                        command_title: e.command_title,
                        category: e.category,
                        error: e.error,
                        duration_ms: e.duration_ms,
                    })),
                },
            };
        } else {
            return {
                ok: false,
                error: 'Usage: assistant cursor [recent|stats|errors] [--limit N] [--category CAT] [--command CMD] [--stats]',
            };
        }
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { ok: false, error: `Failed to read cursor command logs: ${message}` };
    }
}

async function handleCursorEval(
    flags: Record<string, string | boolean>,
    runtime: Runtime
): Promise<CLIResult> {
    try {
        const commandName = flags['command'] as string | undefined;
        const projectOnly = flags['project-only'] === true;

        const result = await runtime.executor.execute('cursor_command_eval', {
            command_name: commandName,
            project_only: projectOnly,
        });

        return toCliResult(result);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { ok: false, error: `Failed to evaluate cursor commands: ${message}` };
    }
}

function handleCache(
    subcommand: string | null,
    _flags: Record<string, string | boolean>
): CLIResult {
    switch (subcommand) {
        case 'clear': {
            const cache = new FileCache();
            cache.clear();
            const pruned = cache.prune();
            return {
                ok: true,
                result: { message: `Cleared LLM cache (${pruned} entries removed)` },
            };
        }

        case 'stats': {
            const cache = new FileCache();
            const stats = cache.stats();
            return {
                ok: true,
                result: {
                    entries: stats.total,
                    size_bytes: stats.size,
                    size_mb: (stats.size / 1024 / 1024).toFixed(2),
                },
            };
        }

        case 'test-clear': {
            const testCache = new TestCache();
            testCache.clear();
            return { ok: true, result: { message: 'Cleared test result cache' } };
        }

        default:
            return { ok: false, error: 'Usage: assistant cache <clear|stats|test-clear>' };
    }
}

function handleGenerate(
    subcommand: string | null,
    args: string[],
    _flags: Record<string, string | boolean>
): CLIResult {
    const { spawnSync } = require('node:child_process');

    switch (subcommand) {
        case 'tool': {
            if (args.length === 0) {
                return {
                    ok: false,
                    error: 'Usage: assistant generate tool <tool_name> [--args <args>]',
                };
            }

            const toolName = args[0];
            const argsIndex = args.indexOf('--args');
            const argsStr =
                argsIndex >= 0 && argsIndex < args.length - 1 ? args[argsIndex + 1] : '';

            const scriptPath = path.join(__dirname, '..', 'scripts', 'generate_tool.js');
            const result = spawnSync(
                process.execPath,
                [scriptPath, toolName, ...(argsStr ? ['--args', argsStr] : [])],
                {
                    stdio: 'inherit',
                    cwd: path.join(__dirname, '..', '..'),
                }
            );

            return {
                ok: result.status === 0,
                result:
                    result.status === 0
                        ? { message: `Tool ${toolName} generated successfully` }
                        : undefined,
                error:
                    result.status !== 0
                        ? `Generation failed with exit code ${result.status}`
                        : undefined,
            };
        }

        case 'tests': {
            if (args.length === 0) {
                return { ok: false, error: 'Usage: assistant generate tests <tool_name>' };
            }

            const toolName = args[0];
            const scriptPath = path.join(__dirname, '..', 'scripts', 'generate_tests.js');
            const result = spawnSync(process.execPath, [scriptPath, toolName], {
                stdio: 'inherit',
                cwd: path.join(__dirname, '..', '..'),
            });

            return {
                ok: result.status === 0,
                result:
                    result.status === 0
                        ? { message: `Tests for ${toolName} generated successfully` }
                        : undefined,
                error:
                    result.status !== 0
                        ? `Test generation failed with exit code ${result.status}`
                        : undefined,
            };
        }

        default:
            return {
                ok: false,
                error: 'Usage: assistant generate <tool|tests> [args]\n  tool <name> [--args <args>]  - Generate new tool\n  tests <name>                  - Generate tests for tool',
            };
    }
}

async function handleProfile(
    runtime: Runtime,
    args: string[],
    flags: Record<string, string | boolean>,
    verbose: boolean
): Promise<CLIResult> {
    const input = args.join(' ');
    if (!input) {
        return { ok: false, error: 'Usage: assistant profile "<command>"' };
    }

    const startTime = Date.now();
    const memBefore = process.memoryUsage();

    // Route and execute
    const routed = await route(
        input,
        'spike',
        null,
        [],
        verbose,
        runtime.defaultAgent,
        runtime.provider,
        { enableRegex: true, toolFormat: 'compact', toolSchemas: runtime.toolSchemas },
        runtime.config
    );

    let executionTime = 0;
    let toolName: string | null = null;
    let cacheHit = false;

    if (isRouteToolCall(routed)) {
        const execStart = Date.now();
        const _execResult = await runtime.executor.execute(
            routed.tool_call.tool_name,
            routed.tool_call.args
        );
        executionTime = Date.now() - execStart;
        toolName = routed.tool_call.tool_name;

        // Check if LLM was used (cache hit if model is null)
        if (isRouteToolCall(routed) || isRouteReply(routed)) {
            if (routed._debug?.model) {
                cacheHit = false; // LLM was called
            } else if (
                routed._debug?.path === 'regex_fast_path' ||
                routed._debug?.path === 'heuristic_parse'
            ) {
                cacheHit = true; // No LLM call needed
            }
        }
    }

    const totalTime = Date.now() - startTime;
    const memAfter = process.memoryUsage();

    const profile = {
        command: input,
        total_time_ms: totalTime,
        routing_time_ms: totalTime - executionTime,
        execution_time_ms: executionTime,
        tool_name: toolName,
        routing_path:
            isRouteToolCall(routed) || isRouteReply(routed) ? routed._debug?.path : 'error',
        cache_hit: cacheHit,
        llm_used: isRouteToolCall(routed) || isRouteReply(routed) ? !!routed._debug?.model : false,
        token_usage: isRouteToolCall(routed) || isRouteReply(routed) ? routed.usage || null : null,
        memory_delta_mb: ((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2),
        memory_used_mb: (memAfter.heapUsed / 1024 / 1024).toFixed(2),
    };

    return {
        ok: true,
        result: profile,
    };
}

function _handlePlugins(
    subcommand: string | null,
    _flags: Record<string, string | boolean>
): CLIResult {
    switch (subcommand) {
        case 'list': {
            const plugins = loadAllPlugins();
            if (plugins.length === 0) {
                return {
                    ok: true,
                    result: {
                        message: 'No plugins found',
                        plugins: [],
                        plugins_dir: path.join(os.homedir(), '.assistant', 'plugins'),
                    },
                };
            }

            const pluginList = plugins.map(p => ({
                name: p.name,
                version: p.version,
                description: p.description,
                tools: Array.from(p.tools.keys()),
            }));

            return {
                ok: true,
                result: {
                    plugins: pluginList,
                    total: plugins.length,
                    plugins_dir: path.join(os.homedir(), '.assistant', 'plugins'),
                },
            };
        }

        default:
            return { ok: false, error: 'Usage: assistant plugins <list>' };
    }
}

async function handleExplain(
    runtime: Runtime,
    args: string[],
    verbose: boolean
): Promise<CLIResult> {
    const input = args.join(' ').trim();
    if (!input) {
        return { ok: false, error: 'Usage: assistant explain "<command>"' };
    }

    // Route without executing
    const routed = await route(
        input,
        'spike',
        null,
        [],
        verbose,
        runtime.defaultAgent,
        runtime.provider,
        { enableRegex: true, toolFormat: 'compact', toolSchemas: runtime.toolSchemas },
        runtime.config
    );

    const explanation: Record<string, unknown> = {
        input,
        routing_result: {
            stage: isRouteError(routed) ? 'error' : routed._debug?.path || 'unknown',
            duration_ms: isRouteError(routed) ? null : routed._debug?.duration_ms || null,
            model: isRouteError(routed) ? null : routed._debug?.model || null,
        },
    };

    if (isRouteError(routed)) {
        explanation.error = routed.error;
        explanation.code = routed.code;
        explanation.would_execute = false;
    } else if (isRouteToolCall(routed)) {
        explanation.tool_call = {
            tool_name: routed.tool_call.tool_name,
            args: routed.tool_call.args,
        };
        explanation.would_execute = true;

        // Check if executor would allow it
        const schema = runtime.registry.getSchema(routed.tool_call.tool_name);
        if (schema) {
            const validation = schema.safeParse(routed.tool_call.args);
            explanation.validation = {
                valid: validation.success,
                error: validation.success ? null : validation.error?.message || 'Validation failed',
            };
        }

        // Check agent permissions
        if (runtime.defaultAgent) {
            const isSystem = runtime.defaultAgent.kind === 'system';
            const hasTool = runtime.defaultAgent.tools.includes(routed.tool_call.tool_name);
            explanation.permissions = {
                agent: runtime.defaultAgent.name,
                agent_kind: runtime.defaultAgent.kind || 'user',
                has_access: isSystem || hasTool,
                reason: isSystem
                    ? 'System agent has full access'
                    : hasTool
                      ? 'Tool in agent allowlist'
                      : 'Tool not in agent allowlist',
            };
        } else {
            const isSafe = (SAFE_TOOLS as readonly string[]).includes(routed.tool_call.tool_name);
            explanation.permissions = {
                agent: null,
                has_access: isSafe,
                reason: isSafe
                    ? 'Tool is in SAFE_TOOLS (no agent required)'
                    : 'Tool requires agent context',
            };
        }
    } else if (isRouteReply(routed)) {
        explanation.reply = {
            content: routed.reply.content,
            instruction: routed.reply.instruction,
        };
        explanation.would_execute = false;
    }

    return {
        ok: true,
        result: explanation,
    };
}

async function handleDemo(executor: Executor, human: boolean): Promise<void> {
    console.log(human ? '🎬 Assistant Demo\n' : '{"demo": "starting"}');

    const steps = [
        { label: 'Creating task', tool: 'task_add', args: { text: 'Buy groceries' } },
        {
            label: 'Storing note',
            tool: 'remember',
            args: { text: 'Shopping list: eggs, milk, bread' },
        },
        { label: 'Recalling note', tool: 'recall', args: { query: 'shopping list' } },
        { label: 'Listing tasks', tool: 'task_list', args: {} },
        { label: 'Completing task', tool: 'task_done', args: { id: 1 } },
        {
            label: 'Setting reminder',
            tool: 'reminder_add',
            args: { text: 'Check groceries delivered', in_seconds: 3600 },
        },
    ];

    for (const step of steps) {
        if (human) {
            process.stdout.write(`${step.label}... `);
        }

        const result = await executor.execute(step.tool, step.args);

        if (human) {
            console.log(result.ok ? '✓' : '✗');
            if (
                result.result &&
                step.tool === 'recall' &&
                typeof result.result === 'object' &&
                result.result !== null &&
                'entries' in result.result
            ) {
                const recallResult = result.result as { entries: unknown[] };
                console.log(`   → Found: ${JSON.stringify(recallResult.entries?.slice(0, 2))}`);
            }
        } else {
            console.log(JSON.stringify({ step: step.label, ...result }));
        }
    }

    console.log(human ? '\n✅ Demo complete!' : '{"demo": "complete"}');
    process.exit(0);
}

// Run CLI
main().catch((err: unknown) => {
    const verbose = process.argv.includes('--verbose');

    if (verbose && err instanceof Error && err.stack) {
        // Print stack trace to stderr when --verbose is set
        console.error(err.stack);
    }

    // Always print the error message (current behavior)
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ ok: false, error: errorMessage }));
    process.exit(1);
});
