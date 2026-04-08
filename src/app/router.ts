#!/usr/bin/env node

/**
 * Intent router - parses input and routes to tool calls or prompts.
 * @module router
 */

// All imports consolidated at the top of the file
import type { Agent, Message, ResolvedConfig, ToolSpec } from '../core';
import {
    generateCorrelationId,
    getPackageVersion,
    loadConfig,
    makeDebug,
    makeToolCall,
    nowMs,
    parseArgs,
    resolveConfig,
} from '../core';
import type { RouteReply, RouteResult, RouteToolCall, ToolResult } from '../core/types';
import { SAFE_TOOLS } from '../core/types';
import {
    parseHeuristicCommand,
    parseMemoryCommand,
    parseTaskCommand,
    validateToolInput,
} from '../parsers';
import type { LLMProvider } from '../runtime';
import { SYSTEM as DEFAULT_SYSTEM_AGENT, TOOL_SCHEMAS, buildRuntime } from '../runtime';

const VERSION = getPackageVersion();

const args = process.argv.slice(2);

const INTENTS: Record<string, string> = {
    fix: 'You are fixing a bug. Be concise. Output only the fix.',
    explain: 'Explain step by step in simple terms.',
    spike: 'Implement the simplest viable solution.',
};

const USAGE = [
    'Usage: node dist/router.js [--intent <fix|explain|spike>] [--json] "<input>"',
    '       node dist/router.js --repl',
    '       node dist/router.js --help | --version',
    '',
    'Examples:',
    '  node dist/router.js "fix: the login button is broken"',
    '  node dist/router.js "explain: how does caching work?"',
    '  node dist/router.js --json "spike: a tiny router"',
    '  node dist/router.js --tool-json "read notes.txt"',
].join('\n');

/**
 * Parse and map command line arguments for router.
 * @param {string[]} argv - Command line arguments.
 * @returns {Object} Parsed arguments.
 */
export function runParseArgs(argv: string[]) {
    const { flags, rawInput, error } = parseArgs(argv, {
        valueFlags: ['intent'],
        booleanFlags: ['json', 'tool-json', 'help', 'version', 'repl', 'execute', 'verbose'],
    });

    let forcedIntent: string | null = null;
    if (flags.intent && typeof flags.intent === 'string') {
        forcedIntent = flags.intent.toLowerCase();
    }

    let finalError = error;
    if (error && error.includes('--intent requires a value')) {
        finalError = 'Error: --intent requires a value (fix|explain|spike).';
    }

    return {
        forcedIntent,
        jsonOutput: !!flags['json'],
        toolJsonOutput: !!flags['tool-json'],
        execute: !!flags['execute'],
        help: !!flags['help'],
        version: !!flags['version'],
        repl: !!flags['repl'],
        error: finalError,
        rawInput,
        flags, // Expose flags for verbose check
    };
}

/**
 * Parse input to extract intent and content.
 * @param {string} input - Raw input.
 * @param {string|null} forcedIntent - Forced intent from flags.
 * @returns {Object} Object with intent and content.
 */
function parseInput(
    input: string,
    forcedIntent: string | null
): { intent: string; content: string } {
    if (forcedIntent && INTENTS[forcedIntent]) {
        return { intent: forcedIntent, content: input };
    }

    const match = input.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (!match) {
        return { intent: 'spike', content: input };
    }

    const intent = match[1].toLowerCase();
    if (!INTENTS[intent]) {
        return { intent: 'spike', content: input };
    }

    return { intent, content: match[2] };
}

// Pre-compiled regex patterns for fast-path matching (V8 optimization)
const RE_REMEMBER = /^remember:\s+([\s\S]+)$/i;
const RE_RECALL = /^recall:\s+([\s\S]+)$/i;
// Support quoted filenames for write command: write "my file.txt" content OR write file.txt content
const RE_WRITE = /^write\s+(?:"([^"]+)"|(\S+))\s+([\s\S]+)$/i;
const RE_READ_URL = /^(?:read\s+url\s+(\S+)|read\s+(https?:\/\/\S+))$/i;
const RE_READ = /^read\s+((?!https?:\/\/)[^\s.]+(?:\.[^\s.]+)?(?:\/\S*)?)\s*$/i; // Exclude http/https and bare domains
const RE_LIST = /^list(\s+files)?$/i;
const RE_RUN_CMD = /^(?:run\s+)?(ls|pwd|cat|du)\s*([\s\S]*)$/i;
const RE_TIME = /^(?:what time is it|current time|time now|what's the time|time|date)$/i;
const RE_CALC = /^(?:calculate|calc|compute|eval|math)[:\s]+(.+)$/i;
const RE_GIT = /^git\s+(status|diff|log)(?:\s+(.*))?$/i;
const RE_DELEGATE =
    /^(?:delegate|ask)\s+(?:to\s+)?(coder|organizer|assistant)(?:\s+(?:to\s+|for\s+)(.+))?$/i;

// Weather patterns - capture multi-word locations
const RE_WEATHER =
    /^(?:(?:get\s+|check\s+)?weather\s+(?:in|for|at)\s+(.+)|(?:get\s+|check\s+)?weather\s+(.+)|(.+)\s+weather|what(?:'s| is) the weather (?:in|for|like in)\s+(.+))$/i;

// Bare domain detection (e.g., "read github.com" -> read_url)
// Exlude common file extensions to avoid collision with read_file fast path
const RE_BARE_DOMAIN =
    /^read\s+(?!.*\.(?:txt|md|js|ts|json|py|rb|go|rs|c|h|cpp|java|xml|yml|yaml|sh)$)([a-z0-9][-a-z0-9]*(?:\.[a-z0-9][-a-z0-9]*)+(?:\/\S*)?)$/i;

// Cache for filtered tools per agent to avoid recreating on every route call
// Key: agent name + tool schemas hash, Value: filtered tools object
const toolFilterCache = new Map<string, Record<string, ToolSpec>>();
const TOOL_CACHE_MAX_SIZE = 50; // Limit cache size to prevent memory growth

/**
 * Create cache key for tool filtering.
 */
function createToolCacheKey(agentName: string, schemas: Record<string, ToolSpec>): string {
    // Use agent name + sorted tool names as key (schemas don't change often)
    const toolNames = Object.keys(schemas).sort().join(',');
    return `${agentName}::${toolNames}`;
}

/**
 * Get filtered tools for an agent, using cache when possible.
 */
function getFilteredTools(
    agent: Agent,
    schemas: Record<string, ToolSpec>
): Record<string, ToolSpec> {
    const cacheKey = createToolCacheKey(agent.name, schemas);

    // Check cache
    const cached = toolFilterCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    // Filter tools based on Agent permissions
    const allowedTools: Record<string, ToolSpec> = {};
    for (const name of agent.tools) {
        if (schemas[name]) {
            allowedTools[name] = schemas[name];
        }
    }

    // Cache the result (with size limit)
    if (toolFilterCache.size >= TOOL_CACHE_MAX_SIZE) {
        // Remove oldest entry (simple FIFO - remove first)
        const firstKey = toolFilterCache.keys().next().value;
        if (firstKey) {
            toolFilterCache.delete(firstKey);
        }
    }
    toolFilterCache.set(cacheKey, allowedTools);

    return allowedTools;
}

/**
 * Route input to intent or tool call.
 */
export interface RouterConfig {
    enableRegex?: boolean; // Default: true
    toolFormat?: 'standard' | 'compact'; // Default: 'compact'
    strategy?: 'single_step' | 'two_step'; // Default: 'single_step' (Two-step not yet implemented in logic but planned)
    /** Injected tool schemas (optional - uses default TOOL_SCHEMAS if not provided) */
    toolSchemas?: Record<string, ToolSpec>;
}

/**
 * Route input to intent or tool call.
 */
export async function route(
    input: string,
    intent: string = 'spike',
    forcedInstruction: string | null = null,
    history: Message[] = [],
    verbose: boolean = false,
    agent: Agent | undefined, // Required parameter (can be undefined, but must be explicitly passed)
    injectedProvider: LLMProvider | undefined, // Required parameter (can be undefined, but must be explicitly passed)
    routerConfig: RouterConfig = { enableRegex: true, toolFormat: 'compact' },
    config?: ResolvedConfig // Optional for backward compat; callers should pass this
): Promise<RouteResult> {
    const start = nowMs();
    const body = input.trim();

    // 1. Validation
    // If we have history (agent loop), empty body is allowed (continuation)
    if (!body && history.length > 0) {
        if (verbose) console.log(`[Verbose] Agent: ${agent?.name || 'N/A'} (Continuing loop)`);
    } else {
        const validationError = validateToolInput(body);
        if (validationError) {
            return { error: validationError, code: 2 };
        }
    }

    // 2. Heuristic Strategies

    // Helper to check if tool is allowed for current agent
    // NOTE: Router may propose tools, but Executor is authoritative for security.
    // When agent is undefined, only SAFE_TOOLS are allowed (matches executor behavior).
    const isToolAllowed = (toolName: string): boolean => {
        if (!agent) {
            // No agent: only allow safe tools (informational only, no filesystem/shell/network)
            // This prevents router from proposing tools that executor will deny
            return (SAFE_TOOLS as readonly string[]).includes(toolName);
        }
        // Agent provided: check agent's tool permissions
        return agent.tools.includes(toolName);
    };

    // A. Regex Fast Paths (with agent permission checks)
    if (routerConfig.enableRegex !== false) {
        // Pre-compiled regex patterns for fast-path matching (V8 optimization)
        // Note: defined at file level

        const rememberMatch = body.match(RE_REMEMBER);
        const recallMatch = body.match(RE_RECALL);
        const writeMatch = body.match(RE_WRITE);
        const readUrlMatch = body.match(RE_READ_URL);
        const bareDomainMatch = body.match(RE_BARE_DOMAIN);
        const readMatch = body.match(RE_READ);
        const listMatch = body.match(RE_LIST);
        const timeMatch = body.match(RE_TIME);
        const calcMatch = body.match(RE_CALC);
        const weatherMatch = body.match(RE_WEATHER);
        const delegateMatch = body.match(RE_DELEGATE);

        // New patterns for File Ops and Delegation
        const copyMatch = body.match(/^(?:copy|cp)\s+([^\s]+)\s+([^\s]+)$/i);
        const moveMatch = body.match(/^(?:move|mv|rename)\s+([^\s]+)\s+([^\s]+)$/i);
        const deleteMatch = body.match(/^(?:delete|rm)\s+([^\s]+)$/i);
        const fileInfoMatch = body.match(/^(?:file\s+info|stat|info)\s+(.+)$/i);
        const countWordsMatch = body.match(/^(?:count\s+words|wc(?:-w)?)\s+(.+)$/i);
        const delegateCodeMatch = body.match(
            /^(?:please\s+)?(?:write|create|implement)\s+(?:a|an)?\s*(?:typescript|python|js|ts|node|code|function|script|app|application).*/i
        );

        // Security Check: Helper to detect suspicious paths (absolute or traversal)
        const isSuspiciousPath = (p: string): boolean => {
            if (!p) return false;
            // Check for absolute paths (start with /) or traversal (..)
            // We want these to go to LLM for refusal explanation/policy check
            return p.trim().startsWith('/') || p.includes('..');
        };

        // Weather has high priority - check before other patterns
        if (weatherMatch && isToolAllowed('get_weather')) {
            const location = (
                weatherMatch[1] ||
                weatherMatch[2] ||
                weatherMatch[3] ||
                weatherMatch[4]
            )
                .trim()
                .replace(/[?.]$/, '');
            // Filter out likelihood of "weather" being used as a verb in a sentence that isn't about weather query
            // e.g. "whether or not" (misspelled) or complex sentences.
            // But RE_WEATHER is quite specific.
            return success(intent, 'get_weather', { location }, 'regex_fast_path', start);
        }

        if (delegateMatch) {
            // "delegate to coder code this up"
            const target = delegateMatch[1].toLowerCase(); // coder | organizer | assistant
            const task = delegateMatch[2].trim();
            const toolName = `delegate_to_${target}`;

            if (isToolAllowed(toolName)) {
                return success(intent, toolName, { task }, 'regex_fast_path', start);
            }
        }

        // Implicit Code Delegation (before RE_WRITE)
        if (delegateCodeMatch) {
            if (isToolAllowed('delegate_to_coder')) {
                return success(
                    intent,
                    'delegate_to_coder',
                    { task: body },
                    'regex_fast_path',
                    start
                );
            }
        }
        if (deleteMatch && isToolAllowed('delete_file')) {
            if (!isSuspiciousPath(deleteMatch[1])) {
                return success(
                    intent,
                    'delete_file',
                    { path: deleteMatch[1] },
                    'regex_fast_path',
                    start
                );
            }
        }

        // File Operations
        if (copyMatch && isToolAllowed('copy_file')) {
            if (!isSuspiciousPath(copyMatch[1]) && !isSuspiciousPath(copyMatch[2])) {
                return success(
                    intent,
                    'copy_file',
                    { source: copyMatch[1], destination: copyMatch[2] },
                    'regex_fast_path',
                    start
                );
            }
        }
        if (moveMatch && isToolAllowed('move_file')) {
            if (!isSuspiciousPath(moveMatch[1]) && !isSuspiciousPath(moveMatch[2])) {
                return success(
                    intent,
                    'move_file',
                    { source: moveMatch[1], destination: moveMatch[2] },
                    'regex_fast_path',
                    start
                );
            }
        }
        if (fileInfoMatch && isToolAllowed('file_info')) {
            if (!isSuspiciousPath(fileInfoMatch[1])) {
                return success(
                    intent,
                    'file_info',
                    { path: fileInfoMatch[1] },
                    'regex_fast_path',
                    start
                );
            }
        }
        if (countWordsMatch && isToolAllowed('count_words')) {
            if (!isSuspiciousPath(countWordsMatch[1])) {
                return success(
                    intent,
                    'count_words',
                    { path: countWordsMatch[1] },
                    'regex_fast_path',
                    start
                );
            }
        }

        if (rememberMatch && isToolAllowed('remember'))
            return success(
                intent,
                'remember',
                { text: rememberMatch[1] },
                'regex_fast_path',
                start
            );
        if (recallMatch && isToolAllowed('recall'))
            return success(intent, 'recall', { query: recallMatch[1] }, 'regex_fast_path', start);
        if (writeMatch && isToolAllowed('write_file')) {
            const pathArg = writeMatch[1] || writeMatch[2];
            const content = writeMatch[3];
            if (!isSuspiciousPath(pathArg)) {
                return success(
                    intent,
                    'write_file',
                    { path: pathArg, content },
                    'regex_fast_path',
                    start
                );
            }
            // If suspicious, fall through to LLM for proper refusal
        }
        if (readUrlMatch && isToolAllowed('read_url'))
            return success(
                intent,
                'read_url',
                { url: readUrlMatch[1] || readUrlMatch[2] },
                'regex_fast_path',
                start
            );
        // Bare domain detection (e.g., "read github.com" -> normalized to https://...)
        if (bareDomainMatch && isToolAllowed('read_url')) {
            const url = `https://${bareDomainMatch[1]}`;
            return success(intent, 'read_url', { url }, 'regex_fast_path', start);
        }
        if (readMatch && isToolAllowed('read_file')) {
            const pathArg = readMatch[1];
            if (!isSuspiciousPath(pathArg)) {
                return success(intent, 'read_file', { path: pathArg }, 'regex_fast_path', start);
            }
        }
        if (listMatch && isToolAllowed('list_files')) {
            // listMatch currently ignores args regex-side: RE_LIST = /^list(\s+files)?$/i;
            // If the user typed "list /tmp", RE_LIST won't match, so it falls through.
            // But check RE_RUN_CMD below for "ls /tmp".
            return success(intent, 'list_files', {}, 'regex_fast_path', start);
        }
        if (timeMatch && isToolAllowed('get_time'))
            return success(intent, 'get_time', {}, 'regex_fast_path', start);
        if (calcMatch && isToolAllowed('calculate'))
            return success(
                intent,
                'calculate',
                { expression: calcMatch[1] },
                'regex_fast_path',
                start
            );
    }

    // Git Fast Path
    if (routerConfig.enableRegex !== false) {
        const gitMatch = body.match(RE_GIT);
        if (gitMatch) {
            const sub = gitMatch[1].toLowerCase();
            const args = gitMatch[2] || '';
            if (sub === 'status' && isToolAllowed('git_status'))
                return success(intent, 'git_status', {}, 'regex_fast_path', start);
            if (sub === 'diff' && isToolAllowed('git_diff')) {
                const staged = args.includes('--staged');
                return success(intent, 'git_diff', { staged }, 'regex_fast_path', start);
            }
            if (sub === 'log' && isToolAllowed('git_log')) {
                // Simple parse for limit, default to 10 if not found or complex
                const limitMatch = args.match(/-n\s+(\d+)/) || args.match(/--limit\s+(\d+)/);
                const limit = limitMatch ? parseInt(limitMatch[1], 10) : 10;
                return success(intent, 'git_log', { limit }, 'regex_fast_path', start);
            }
        }

        // Run Command Fast Path
        const runMatch = body.match(RE_RUN_CMD);
        if (runMatch && isToolAllowed('run_cmd')) {
            const cmd = runMatch[1];
            const args = runMatch[2];
            // Check for suspicious paths in arguments
            // We want "ls /tmp" to go to LLM so it can say "I cannot access /tmp"
            // instead of trying to run `ls /tmp` and failing or succeeding.
            if (!args.includes('/') && !args.includes('..')) {
                // Wait, isSuspiciousPath checks if it starts with /.
                // args " /tmp" starts with " ".
                // But helper does trim().
                // But args could be "-l /tmp". trim() starts with -.
                // So we must check contains "/" or "..".
                if (!args.includes('/') && !args.includes('..')) {
                    return success(
                        intent,
                        'run_cmd',
                        { command: `${cmd} ${args}`.trim() },
                        'regex_fast_path',
                        start
                    );
                }
            }
        }
    }

    // A. Heuristic Parser
    const heuristicCommand = parseHeuristicCommand(body);
    if (heuristicCommand && heuristicCommand.error) {
        return { error: heuristicCommand.error, code: 2 };
    }
    if (heuristicCommand && heuristicCommand.tool) {
        // Check agent permissions for heuristic-matched tools
        if (!isToolAllowed(heuristicCommand.tool.name)) {
            if (verbose)
                console.log(
                    `[Verbose] Heuristic matched ${heuristicCommand.tool.name} but agent ${agent?.name || 'N/A'} lacks permission, skipping to LLM.`
                );
        } else {
            if (verbose)
                console.log('[Verbose] Matched Heuristic Parser:', heuristicCommand.tool.name);
            return {
                version: 1 as const,
                intent,
                mode: 'tool_call' as const,
                tool_call: makeToolCall(heuristicCommand.tool.name, heuristicCommand.tool.args),
                reply: null,
                _debug: makeDebug({
                    path: 'heuristic_parse',
                    start,
                    model: null,
                    memory_read: false,
                    memory_write: false,
                }),
            } as RouteToolCall;
        }
    }

    // B. Task Parser
    const taskCommand = parseTaskCommand(body);
    if (taskCommand && taskCommand.error) return { error: taskCommand.error, code: 2 };
    if (taskCommand && taskCommand.tool) {
        // Check agent permissions for task commands
        if (!isToolAllowed(taskCommand.tool.name)) {
            if (verbose)
                console.log(
                    `[Verbose] Task command matched ${taskCommand.tool.name} but agent ${agent?.name || 'N/A'} lacks permission, skipping to LLM.`
                );
        } else {
            return {
                version: 1 as const,
                intent,
                mode: 'tool_call' as const,
                tool_call: makeToolCall(taskCommand.tool.name, taskCommand.tool.args),
                reply: null,
                _debug: makeDebug({
                    path: 'cli_parse',
                    start,
                    model: null,
                    memory_read: false,
                    memory_write: false,
                }),
            } as RouteToolCall;
        }
    }

    // C. Memory Parser
    const memoryCommand = parseMemoryCommand(body);
    if (memoryCommand && memoryCommand.error) return { error: memoryCommand.error, code: 2 };
    if (memoryCommand && memoryCommand.tool) {
        // Check agent permissions for memory commands
        if (!isToolAllowed(memoryCommand.tool.name)) {
            if (verbose)
                console.log(
                    `[Verbose] Memory command matched ${memoryCommand.tool.name} but agent ${agent?.name || 'N/A'} lacks permission, skipping to LLM.`
                );
        } else {
            return {
                version: 1 as const,
                intent,
                mode: 'tool_call' as const,
                tool_call: makeToolCall(memoryCommand.tool.name, memoryCommand.tool.args),
                reply: null,
                _debug: makeDebug({
                    path: 'cli_parse',
                    start,
                    model: null,
                    memory_read: false,
                    memory_write: false,
                }),
            } as RouteToolCall;
        }
    }

    // 3. LLM Fallback (if provider injected)
    if (injectedProvider) {
        try {
            // Use injected tool schemas or default to module-level TOOL_SCHEMAS
            const schemas = routerConfig.toolSchemas || TOOL_SCHEMAS;

            // If agent was not provided, create minimal agent with only SAFE_TOOLS
            // This matches executor behavior: no agent = only SAFE_TOOLS allowed
            let currentAgent: Agent;
            if (!agent) {
                currentAgent = {
                    name: 'Minimal',
                    description: 'Minimal agent with safe tools only (no agent context)',
                    systemPrompt: 'You are a minimal assistant with limited safe tools only.',
                    tools: [...SAFE_TOOLS],
                    kind: 'user',
                };
            } else {
                currentAgent = agent;
            }

            const provider = injectedProvider;
            if (verbose && config)
                console.log(
                    `[Verbose] Agent: ${currentAgent.name} | Provider: ${config.defaultProvider}`
                );

            // Filter tools based on Agent permissions (with caching)
            const allowedTools = getFilteredTools(currentAgent, schemas);

            if (verbose) {
                console.log('[Verbose] Filtered Tools:', Object.keys(allowedTools));
                if (Object.keys(allowedTools).length > 0) {
                    // console.log('[Verbose] Sample Tool Schema:', JSON.stringify(allowedTools[Object.keys(allowedTools)[0]], null, 2));
                }
            }

            // We pass options via an extended interface or optional args?
            // Since LLMProvider interface is fixed, we might need to modify it OR cast it here if we assume OpenAICompatibleProvider
            // For now, we'll pass it if the provider supports it, or handle it via a side channel/globals if we must (but cleaner to strict type it).
            // Given the 'provider.complete' signature:
            // complete(prompt, tools, history, verbose, systemPrompt): Promise<CompletionResult>
            // We will check if provider has a setOptions method or just append to system prompt manually here.

            const finalSystemPrompt = currentAgent.systemPrompt;

            const res = await provider.complete(
                body,
                allowedTools,
                history,
                verbose,
                finalSystemPrompt,
                { toolFormat: routerConfig.toolFormat }
            );

            if (res.ok) {
                if (res.toolCall) {
                    if (!isToolAllowed(res.toolCall.tool_name)) {
                        const msg = `Error: Tool '${res.toolCall.tool_name}' is not allowed for agent '${currentAgent.name}'.`;
                        if (verbose) console.log(`[Verbose] ${msg}`);
                        // Return validation error instead of executing
                        return { error: msg, code: 2 };
                    }

                    return {
                        version: 1 as const,
                        intent,
                        mode: 'tool_call' as const,
                        tool_call: res.toolCall,
                        reply: null,
                        usage: res.usage || null,
                        _debug: makeDebug({
                            path: 'llm_fallback',
                            start,
                            model: config?.defaultProvider || 'unknown',
                            memory_read: false,
                            memory_write: false,
                        }),
                    } as RouteToolCall;
                }
                if (res.reply) {
                    return {
                        version: 1 as const,
                        intent,
                        mode: 'reply' as const, // LLM conversational reply
                        tool_call: null,
                        reply: {
                            instruction: forcedInstruction || intent,
                            content: res.reply,
                            prompt: body,
                        },
                        usage: res.usage || null,
                        _debug: makeDebug({
                            path: 'llm_fallback',
                            start,
                            model: config?.defaultProvider || 'unknown',
                            memory_read: false,
                            memory_write: false,
                        }),
                    } as RouteReply;
                }
            } else {
                const errorMsg = res.error || 'Unknown LLM error';
                console.error(`[LLM Error] ${errorMsg}`);
                if (history.length > 0) return { error: errorMsg, code: 2 };
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('LLM Error:', message); // Log it
            if (history.length > 0) {
                // In agent loop, failure is fatal
                return { error: `LLM Error: ${message}`, code: 2 };
            }
        }
    }

    // 4. Default Fallback
    if (intent === 'spike') {
        return { error: "I can't do that. No tool found for your request.", code: 1 };
    }

    return {
        version: 1 as const,
        intent,
        mode: 'reply' as const,
        tool_call: null,
        reply: {
            instruction: forcedInstruction || INTENTS.spike,
            content: body,
            prompt: `${forcedInstruction || INTENTS.spike}\n\n${body}`,
        },
        _debug: makeDebug({
            path: 'fallback',
            start,
            model: null,
            memory_read: false,
            memory_write: false,
        }),
    } as RouteReply;
}

function success(
    intent: string,
    tool: string,
    args: Record<string, unknown>,
    path: string,
    start: number
): RouteToolCall {
    return {
        version: 1 as const,
        intent,
        mode: 'tool_call' as const,
        tool_call: makeToolCall(tool, args),
        reply: null,
        _debug: makeDebug({ path, start, model: null, memory_read: false, memory_write: false }),
    };
}

// CLI Entry Point
if (require.main === module) {
    (async () => {
        const {
            forcedIntent,
            jsonOutput,
            toolJsonOutput,
            execute,
            help,
            version,
            repl,
            error,
            rawInput,
            flags,
        } = runParseArgs(args);
        const verbose = !!flags['verbose'];

        // Load config once at entrypoint
        const rawConfig = loadConfig();
        const resolveResult = resolveConfig(rawConfig);
        if (!resolveResult.ok) {
            process.stderr.write(`Error: ${resolveResult.error}\n`);
            process.exit(1);
        }
        const resolvedConfig = resolveResult.config;

        if (help) {
            process.stdout.write(`${USAGE}\n`);
            process.exit(0);
        }
        if (version) {
            process.stdout.write(`${VERSION}\n`);
            process.exit(0);
        }
        if (error) {
            process.stderr.write(`${error}\n`);
            process.exit(2);
        }

        if (repl) {
            if (require.main === module) {
                // Lazy import to avoid circular dep if any (router imports parsers, repl imports router)
                const { startRepl } = require('./repl');
                startRepl({ verbose });
                // Don't exit, REPL keeps process alive
                return;
            }
        }

        if (forcedIntent && !INTENTS[forcedIntent]) {
            process.stderr.write('Error: unknown intent.\n');
            process.exit(2);
        }
        if (!rawInput) {
            process.stderr.write('Error: missing input.\n');
            process.exit(2);
        }

        const { intent, content } = parseInput(rawInput, forcedIntent);
        const instruction = INTENTS[intent] || INTENTS.spike;

        if (!content.trim()) {
            process.stderr.write('Error: missing input. Provide content after the intent label.\n');
            process.exit(2);
        }

        if (execute) {
            // Build runtime once via composition root
            const runtime = buildRuntime(resolvedConfig);
            const correlationId = generateCorrelationId();

            const result = await route(
                content,
                intent,
                instruction,
                [],
                verbose,
                undefined,
                runtime.provider,
                { enableRegex: true, toolFormat: 'compact', toolSchemas: runtime.toolSchemas },
                resolvedConfig
            );

            let toolResult: ToolResult | undefined = undefined;

            if ('error' in result) {
                // Log command with routing error
                runtime.commandLogger.logCommand(correlationId, content, result, undefined, {
                    intent,
                    agent: undefined,
                });
                process.stderr.write(`${result.error}\n`);
                process.exit(result.code || 1);
            }
            if (result.mode === 'tool_call' && result.tool_call) {
                toolResult = await runtime.executor.execute(
                    result.tool_call.tool_name,
                    result.tool_call.args
                );

                // Log command with routing and tool execution results
                runtime.commandLogger.logCommand(correlationId, content, result, toolResult, {
                    intent,
                    agent: undefined,
                });

                process.stdout.write(JSON.stringify(toolResult, null, 2) + '\n');
                process.exit(toolResult.ok ? 0 : 1);
            } else if (result.mode === 'reply') {
                // Log command with reply mode
                runtime.commandLogger.logCommand(correlationId, content, result, undefined, {
                    intent,
                    agent: undefined,
                });
                // Just print reply
                process.stdout.write(result.reply.content + '\n');
                process.exit(0);
            }
        }

        // If tool-json is requested, we run specific routing logic
        // In original code, tool-json usage triggered the routing logic.
        // Standard usage (without tool-json) just echo-ed the prompt if not tool-json?
        // Wait, original 'router.js' logic:
        // if (toolJsonOutput) { ... perform routing ... }
        // else if (jsonOutput) { ... echo payload ... }
        // else { output body }

        // We want to preserve this behavior.
        if (toolJsonOutput) {
            // Tool-json mode just parses commands - no runtime needed (no LLM, no executor)
            // Use default TOOL_SCHEMAS directly
            // Use SYSTEM agent by default for tool-json mode (allows all tools for parsing)
            const result = await route(
                content,
                intent,
                instruction,
                [],
                false,
                DEFAULT_SYSTEM_AGENT, // Use SYSTEM agent for tool-json mode
                undefined,
                { enableRegex: true, toolFormat: 'compact' },
                resolvedConfig
            );
            if ('error' in result) {
                process.stderr.write(`${result.error}\n`);
                process.exit(result.code || 1);
            }
            process.stdout.write(`${JSON.stringify(result)}\n`);
            process.exit(0);
        } else if (jsonOutput) {
            // Echo only
            const payload = {
                version: 1,
                intent,
                instruction,
                content: content.trim(),
                prompt: `${instruction}\n\n${content.trim()}`,
            };
            process.stdout.write(`${JSON.stringify(payload)}\n`);
            process.exit(0);
        } else {
            // Plain text output
            const body = content.trim();
            const prompt = `${instruction}\n\n${body}`;
            const output = body ? prompt : instruction;
            process.stdout.write(output);
            process.exit(0);
        }
    })();
}
