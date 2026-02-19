/**
 * Interactive REPL for the Prompt Router
 *
 * Provides a command-line interface for interacting with agents.
 * Supports multi-turn conversations with tool execution.
 *
 * @module repl
 */

import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/** Helper to check if readline is closed (avoids any cast) */
function isRlClosed(rl: readline.Interface): boolean {
    return (rl as unknown as { closed?: boolean }).closed === true;
}
import { route } from './router';
import { isRouteError, isRouteToolCall } from '../core';
import { saveConfig } from '../core';
import type { AppConfig, Message, Agent, ToolSpec } from '../core';
import { AGENTS } from '../agents';
import { Dispatcher } from '../dispatcher';
import { initializeRuntime, TOOL_SCHEMAS } from '../runtime';
import { generateCorrelationId } from '../core';

/**
 * Session data structure for save/load.
 */
interface Session {
    name: string;
    created: string;
    updated: string;
    agent: string;
    history: Message[];
}

/**
 * Session statistics for tracking usage.
 */
interface SessionStats {
    llmCalls: number;
    heuristicHits: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
}

/**
 * Start the interactive REPL.
 *
 * Commands:
 *   /help     - Show available commands
 *   /config   - Set API keys
 *   /provider - Switch between groq/openrouter
 *   /stats    - Show session token usage statistics
 *   /save     - Save current session
 *   /load     - Load a saved session
 *   /sessions - List saved sessions
 *   /reset    - Reset to Supervisor agent
 *   /exit     - Exit REPL
 */
export async function startRepl(options: { verbose?: boolean; stream?: boolean } = {}) {
    const { verbose, stream = true } = options;

    // Build runtime via composition root
    const runtime = initializeRuntime();
    const { executor, config: resolvedConfig } = runtime;

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: '> ',
    });
    const HISTORY: Message[] = [];
    let currentAgent: Agent = AGENTS.supervisor;

    // Initialize dispatcher for auto-dispatch and action enforcement
    const dispatcher = new Dispatcher({ verbose, autoDispatch: true, enforceActions: true });

    // Helper to update prompt based on current agent
    const updatePrompt = () => {
        const prompt = `[${currentAgent.name}] > `;
        rl.setPrompt(prompt);
    };
    updatePrompt();

    // Session statistics
    const stats: SessionStats = {
        llmCalls: 0,
        heuristicHits: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
    };

    console.log(`Prompt Router REPL (v1)${verbose ? ' [VERBOSE]' : ''}`);
    console.log('Type "/help" for commands, or just type a request.');
    rl.prompt();

    const processInput = async (input: string) => {
        if (input === '/exit') {
            rl.close();
            return;
        }

        if (input === '/reset') {
            currentAgent = AGENTS.supervisor;
            HISTORY.length = 0;
            updatePrompt(); // Reset prompt
            console.log('[System] Reset to Supervisor.');
            if (!isRlClosed(rl)) rl.prompt();
            return;
        }

        if (input === '/stats') {
            showStats(stats);
            if (!isRlClosed(rl)) rl.prompt();
            return;
        }

        // Session commands (need access to HISTORY and currentAgent)
        if (input.startsWith('/save')) {
            const name = input.split(' ')[1] || `session-${Date.now()}`;
            const result = saveSession(name, currentAgent, HISTORY);
            if (result.ok) {
                console.log(`[System] Session saved as '${name}'`);
            } else {
                console.error(`[Error] ${result.error}`);
            }
            if (!isRlClosed(rl)) rl.prompt();
            return;
        }

        if (input.startsWith('/load')) {
            const name = input.split(' ')[1];
            if (!name) {
                console.log('Usage: /load <session-name>');
            } else {
                const result = loadSession(name);
                if (result.ok && result.session) {
                    HISTORY.length = 0;
                    HISTORY.push(...result.session.history);
                    currentAgent = AGENTS[result.session.agent] || AGENTS.supervisor;
                    updatePrompt(); // Update prompt for loaded agent
                    console.log(
                        `[System] Loaded session '${name}' (${HISTORY.length} messages, agent: ${currentAgent.name})`
                    );
                } else {
                    console.error(`[Error] ${result.error}`);
                }
            }
            if (!isRlClosed(rl)) rl.prompt();
            return;
        }

        if (input === '/sessions') {
            const sessions = listSessions();
            if (sessions.length === 0) {
                console.log('No saved sessions.');
            } else {
                console.log('\n📁 Saved Sessions:');
                for (const s of sessions) {
                    const date = new Date(s.updated).toLocaleString();
                    console.log(`  ${s.name} (${s.history.length} msgs, ${s.agent}, ${date})`);
                }
                console.log('');
            }
            if (!isRlClosed(rl)) rl.prompt();
            return;
        }

        if (input === '/tools') {
            showTools(currentAgent);
            if (!isRlClosed(rl)) rl.prompt();
            return;
        }

        if (input.startsWith('/')) {
            await handleCommand(input);
            if (!isRlClosed(rl)) rl.prompt();
            return;
        }

        HISTORY.push({ role: 'user', content: input });

        let currentInput = input;
        let loopCount = 0;
        const MAX_LOOPS = 8;

        // Check for auto-dispatch before entering LLM loop
        const dispatchResult = dispatcher.analyze(input, currentAgent, HISTORY);

        if (dispatchResult.action === 'auto_dispatch' && dispatchResult.toolCall) {
            stats.heuristicHits++;
            const tool = dispatchResult.toolCall;
            console.log(`[${currentAgent.name}] Auto-dispatch: ${tool.tool_name}`);
            if (verbose) console.log('[Verbose] Pattern:', dispatchResult.debug?.matchedPattern);

            const toolCallId = `auto_${Date.now()}`;
            HISTORY.push({
                role: 'assistant',
                content: null,
                tool_calls: [
                    {
                        id: toolCallId,
                        type: 'function',
                        function: { name: tool.tool_name, arguments: JSON.stringify(tool.args) },
                    },
                ],
            });

            const execResult = await executor.execute(tool.tool_name, tool.args);
            if (execResult.ok) {
                const output = JSON.stringify(execResult.result);
                console.log(
                    '[Result]',
                    output.substring(0, 200) + (output.length > 200 ? '...' : '')
                );
            } else {
                console.error('[Error]', execResult.error);
            }

            HISTORY.push({
                role: 'tool',
                tool_call_id: toolCallId,
                name: tool.tool_name,
                content: JSON.stringify(execResult.ok ? execResult.result : execResult.error),
            });

            // Handle delegation if applicable (Auto-dispatch path)
            const delegation = handleDelegation(tool.tool_name, tool.args);
            if (delegation.switched && delegation.newAgent) {
                currentAgent = delegation.newAgent;
                updatePrompt();
                if (delegation.input) {
                    HISTORY.push({
                        role: 'tool',
                        tool_call_id: toolCallId,
                        name: tool.tool_name,
                        content: `Switched to ${currentAgent.name}.`,
                    });
                    await processInput(delegation.input);
                    return;
                }
            }

            if (!isRlClosed(rl)) rl.prompt();
            return;
        }

        while (loopCount < MAX_LOOPS) {
            loopCount++;
            try {
                // Safe Sliding Window: Ensure we don't split tool-call/result pairs
                const historyLimit = resolvedConfig.historyLimit;

                // Only slice off the last message if it's the initial user input (Loop 1)
                // In subsequent loops (tool results, delegation), strictly use full history
                const historyToSlice = loopCount === 1 ? HISTORY.slice(0, -1) : HISTORY;
                const recentHistory = getValidHistorySlice(historyToSlice, historyLimit);

                const spinner = new Spinner(`Thinking...`);
                spinner.start();

                const correlationId = generateCorrelationId();
                const inputForLogging = currentInput; // Store before clearing
                let result;
                try {
                    result = await route(
                        currentInput,
                        'spike',
                        null,
                        recentHistory,
                        verbose,
                        currentAgent,
                        runtime.provider,
                        {
                            enableRegex: true,
                            toolFormat: 'compact',
                            toolSchemas: runtime.toolSchemas,
                        },
                        resolvedConfig
                    );
                } finally {
                    spinner.stop();
                }

                currentInput = ''; // Clear for subsequent turns

                if (isRouteError(result)) {
                    // Log command with routing error
                    runtime.commandLogger.logCommand(
                        correlationId,
                        inputForLogging,
                        result,
                        undefined,
                        { intent: 'spike', agent: currentAgent.name }
                    );
                    console.error(result.error);
                    break;
                }

                // Track statistics based on routing path
                if (result._debug.path === 'llm_fallback') {
                    stats.llmCalls++;
                    if (result.usage) {
                        stats.totalPromptTokens += result.usage.prompt_tokens;
                        stats.totalCompletionTokens += result.usage.completion_tokens;
                        stats.totalTokens += result.usage.total_tokens;

                        // Show token usage for each LLM call
                        console.log(
                            `[Tokens] ${result.usage.prompt_tokens} in → ${result.usage.completion_tokens} out (${result.usage.total_tokens} total)`
                        );
                    }
                } else if (result._debug.path) {
                    stats.heuristicHits++;
                }

                if (isRouteToolCall(result)) {
                    const tool = result.tool_call;
                    console.log(`[${currentAgent.name}] Tool Call: ${tool.tool_name}`);
                    if (verbose) console.log('[Verbose] Args:', JSON.stringify(tool.args));

                    const toolCallId = `call_${Date.now()}_${loopCount}`;
                    HISTORY.push({
                        role: 'assistant',
                        content: null,
                        tool_calls: [
                            {
                                id: toolCallId,
                                type: 'function',
                                function: {
                                    name: tool.tool_name,
                                    arguments: JSON.stringify(tool.args),
                                },
                            },
                        ],
                    });

                    // Handle agent delegation
                    const delegation = handleDelegation(tool.tool_name, tool.args);
                    if (delegation.switched) {
                        if (delegation.newAgent) currentAgent = delegation.newAgent;
                        updatePrompt(); // Update prompt on switch

                        // Log and history update
                        const targetName = delegation.newAgent
                            ? delegation.newAgent.name
                            : 'Supervisor';
                        HISTORY.push({
                            role: 'tool',
                            tool_call_id: toolCallId,
                            name: tool.tool_name,
                            content: `Switched to ${targetName}.`,
                        });

                        if (delegation.input) {
                            currentInput = delegation.input;
                            continue;
                        }
                    }

                    // Execute the tool
                    const execResult = await executor.execute(tool.tool_name, tool.args);

                    // Log command with routing and tool execution results
                    runtime.commandLogger.logCommand(
                        correlationId,
                        inputForLogging,
                        result,
                        execResult,
                        { intent: 'spike', agent: currentAgent.name }
                    );

                    if (execResult.ok) {
                        const output = JSON.stringify(execResult.result);
                        console.log(
                            '[Result]',
                            output.substring(0, 100) + (output.length > 100 ? '...' : '')
                        );
                    } else {
                        console.error('[Error]', execResult.error);
                    }

                    HISTORY.push({
                        role: 'tool',
                        tool_call_id: toolCallId,
                        name: tool.tool_name,
                        content: JSON.stringify(
                            execResult.ok ? execResult.result : execResult.error
                        ),
                    });
                } else if (result.mode === 'reply') {
                    // Log command with reply mode
                    runtime.commandLogger.logCommand(
                        correlationId,
                        inputForLogging,
                        result,
                        undefined,
                        { intent: 'spike', agent: currentAgent.name }
                    );

                    // Check if we should stream this reply
                    const shouldStream =
                        stream &&
                        result._debug.path === 'llm_fallback' &&
                        runtime.provider?.completeStream;

                    if (shouldStream && runtime.provider?.completeStream) {
                        // Stream the reply
                        process.stdout.write(`[${currentAgent.name}] `);
                        let fullContent = '';
                        try {
                            const recentHistory = getValidHistorySlice(
                                HISTORY.slice(0, -1),
                                historyLimit
                            );
                            for await (const chunk of runtime.provider.completeStream(
                                currentInput || HISTORY[HISTORY.length - 1]?.content || '',
                                recentHistory,
                                verbose,
                                currentAgent.systemPrompt
                            )) {
                                if (chunk.content) {
                                    process.stdout.write(chunk.content);
                                    fullContent += chunk.content;
                                }
                                if (chunk.done) break;
                            }
                            process.stdout.write('\n');
                            HISTORY.push({ role: 'assistant', content: fullContent });
                        } catch (err: unknown) {
                            const message = err instanceof Error ? err.message : String(err);
                            console.error(`\n[Stream Error] ${message}`);
                            // Fallback to non-streamed reply
                            console.log(`[${currentAgent.name}] ${result.reply.content}`);
                            HISTORY.push({ role: 'assistant', content: result.reply.content });
                        }
                    } else {
                        // Non-streamed reply (fallback or non-LLM reply)
                        console.log(`[${currentAgent.name}] ${result.reply.content}`);
                        HISTORY.push({ role: 'assistant', content: result.reply.content });
                    }

                    // Check for unfulfilled action intent (e.g., "I will fetch...")
                    const enforceResult = dispatcher.enforceAction(
                        result.reply.content,
                        currentInput,
                        currentAgent
                    );
                    if (
                        enforceResult &&
                        enforceResult.action === 'enforced_dispatch' &&
                        enforceResult.toolCall
                    ) {
                        const tool = enforceResult.toolCall;
                        console.log(
                            `[Dispatcher] Enforcing action: ${tool.tool_name} (Reason: ${enforceResult.debug?.enforceReason})`
                        );

                        const toolCallId = `enforce_${Date.now()}`;
                        HISTORY.push({
                            role: 'assistant',
                            content: null,
                            tool_calls: [
                                {
                                    id: toolCallId,
                                    type: 'function',
                                    function: {
                                        name: tool.tool_name,
                                        arguments: JSON.stringify(tool.args),
                                    },
                                },
                            ],
                        });

                        const execResult = await executor.execute(tool.tool_name, tool.args);
                        if (execResult.ok) {
                            const output = JSON.stringify(execResult.result);
                            console.log(
                                '[Result]',
                                output.substring(0, 100) + (output.length > 100 ? '...' : '')
                            );
                        } else {
                            console.error('[Error]', execResult.error);
                        }

                        HISTORY.push({
                            role: 'tool',
                            tool_call_id: toolCallId,
                            name: tool.tool_name,
                            content: JSON.stringify(
                                execResult.ok ? execResult.result : execResult.error
                            ),
                        });

                        // Continue loop to process the tool result
                        continue;
                    }

                    break;
                } else {
                    break;
                }
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                console.error('Error:', message);
                break;
            }
        }
        if (!isRlClosed(rl)) rl.prompt();
    };

    rl.on('line', line => processInput(line.trim()));
}

/**
 * Display session statistics.
 */
function showStats(stats: SessionStats) {
    console.log('\n📊 Session Statistics');
    console.log('─'.repeat(40));
    console.log(`  LLM Calls:        ${stats.llmCalls}`);
    console.log(`  Heuristic Hits:   ${stats.heuristicHits}`);
    console.log(
        `  Hit Rate:         ${
            stats.llmCalls + stats.heuristicHits > 0
                ? ((stats.heuristicHits / (stats.llmCalls + stats.heuristicHits)) * 100).toFixed(
                      1
                  ) + '%'
                : 'N/A'
        }`
    );
    console.log('');
    console.log(`  Prompt Tokens:    ${stats.totalPromptTokens.toLocaleString()}`);
    console.log(`  Completion Tokens: ${stats.totalCompletionTokens.toLocaleString()}`);
    console.log(`  Total Tokens:     ${stats.totalTokens.toLocaleString()}`);
    console.log(
        `  Avg per LLM Call: ${
            stats.llmCalls > 0
                ? Math.round(stats.totalTokens / stats.llmCalls).toLocaleString()
                : 'N/A'
        }`
    );
    console.log('─'.repeat(40) + '\n');
}

/**
 * Handle delegation logic.
 */
function handleDelegation(
    toolName: string,
    args: Record<string, unknown>
): { switched: boolean; input: string | null; newAgent?: Agent } {
    if (toolName === 'delegate_to_coder') {
        const task = args.task as string;
        console.log(`[System] Switching to Coder for: "${task}"`);
        return {
            switched: true,
            input: `[System: Handoff to Coder] Task: ${task}`,
            newAgent: AGENTS.coder,
        };
    }

    if (toolName === 'delegate_to_organizer') {
        const task = args.task as string;
        console.log(`[System] Switching to Organizer for: "${task}"`);
        return {
            switched: true,
            input: `[System: Handoff to Organizer] Task: ${task}`,
            newAgent: AGENTS.organizer,
        };
    }

    if (toolName === 'delegate_to_assistant') {
        const task = args.task as string;
        console.log(`[System] Switching to Assistant for: "${task}"`);
        return {
            switched: true,
            input: `[System: Handoff to Assistant] Task: ${task}`,
            newAgent: AGENTS.assistant,
        };
    }

    if (toolName === 'return_to_supervisor') {
        console.log(`[System] Returning to Supervisor.`);
        return {
            switched: true,
            input: `[System: Returned to Supervisor]`,
            newAgent: AGENTS.supervisor,
        };
    }

    return { switched: false, input: null };
}

/**
 * Display available tools grouped by status.
 */
function showTools(currentAgent: Agent) {
    console.log('\n🔧 Available Tools');
    console.log('─'.repeat(50));

    // Get tools available to this agent
    const agentTools = new Set(currentAgent.tools);

    // Group tools by status
    const readyTools: Array<[string, ToolSpec]> = [];
    const experimentalTools: Array<[string, ToolSpec]> = [];

    for (const [name, spec] of Object.entries(TOOL_SCHEMAS)) {
        const toolSpec = spec as { description: string; status?: string };
        if (!agentTools.has(name)) continue;

        if (toolSpec.status === 'ready') {
            readyTools.push([name, toolSpec]);
        } else if (toolSpec.status === 'experimental') {
            experimentalTools.push([name, toolSpec]);
        }
    }

    if (readyTools.length > 0) {
        console.log('\n✅ Ready:');
        for (const [name, spec] of readyTools) {
            const description = spec.description || '';
            const desc = description.substring(0, 50) + (description.length > 50 ? '...' : '');
            console.log(`  ${name.padEnd(22)} ${desc}`);
        }
    }

    if (experimentalTools.length > 0) {
        console.log('\n⚠️  Experimental:');
        for (const [name, spec] of experimentalTools) {
            const description = spec.description || '';
            const desc = description.replace('[EXPERIMENTAL] ', '').substring(0, 45);
            console.log(`  ${name.padEnd(22)} ${desc}`);
        }
    }

    console.log('\n' + '─'.repeat(50));
    console.log(`Agent: ${currentAgent.name} (${agentTools.size} tools available)\n`);
}

/**
 * Get a valid slice of history that doesn't break tool call/result pairs.
 * This is important for token efficiency - we only send recent context.
 *
 * Ensures:
 * 1. If slice starts with 'tool' message, include preceding 'assistant' with tool_calls
 * 2. If slice ends with 'assistant' that has tool_calls, include following 'tool' results
 */
function getValidHistorySlice(history: Message[], limit: number): Message[] {
    if (history.length <= limit) return history;

    let start = history.length - limit;
    const end = history.length;

    // If the first message is a 'tool' result, include the preceding 'assistant' call
    while (start > 0 && history[start].role === 'tool') {
        start--;
    }

    // Get the slice
    const slice = history.slice(start, end);

    // Check if the last message is an 'assistant' with tool_calls but no tool result follows in slice
    // This shouldn't happen in practice since tool results follow immediately, but handle it defensively
    if (slice.length > 0) {
        const lastMsg = slice[slice.length - 1];
        if (lastMsg.role === 'assistant' && lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
            // Check if there are tool results after this in the full history
            const sliceEndIndex = start + slice.length;
            if (sliceEndIndex < history.length && history[sliceEndIndex].role === 'tool') {
                // Include all consecutive tool results
                let extendEnd = sliceEndIndex;
                while (extendEnd < history.length && history[extendEnd].role === 'tool') {
                    extendEnd++;
                }
                return history.slice(start, extendEnd);
            }
        }
    }

    return slice;
}

/**
 * Handle REPL slash commands.
 * Only groq and openrouter are supported.
 */
async function handleCommand(input: string) {
    const [cmd, ...args] = input.split(' ');

    switch (cmd) {
        case '/help':
            console.log('Commands:');
            console.log('  /tools                        List available tools');
            console.log('  /config set <provider> <key>  Set API key (groq, openrouter)');
            console.log('  /provider <name>              Switch provider (groq, openrouter)');
            console.log('  /stats                        Show session token usage statistics');
            console.log('  /save [name]                  Save current session');
            console.log('  /load <name>                  Load a saved session');
            console.log('  /sessions                     List saved sessions');
            console.log('  /reset                        Reset agent to Supervisor');
            console.log('  /exit                         Exit REPL');
            break;
        case '/exit':
            process.exit(0);
            break;
        case '/config':
            if (args[0] === 'set' && args[2]) {
                const provider = args[1] as keyof AppConfig['apiKeys'];
                const key = args[2];
                if (['groq', 'openrouter'].includes(provider)) {
                    saveConfig({ apiKeys: { [provider]: key } });
                    console.log(`Updated ${provider} key.`);
                } else {
                    console.log('Invalid provider. Use: groq, openrouter');
                }
            } else {
                console.log('Usage: /config set <provider> <key>');
            }
            break;
        case '/provider':
            if (args[0]) {
                const provider = args[0] as AppConfig['defaultProvider'];
                if (['groq', 'openrouter'].includes(provider)) {
                    saveConfig({ defaultProvider: provider });
                    console.log(`Switched to ${provider}.`);
                } else {
                    console.log('Invalid provider. Use: groq, openrouter');
                }
            }
            break;
        default:
            console.log('Unknown command. Type /help for options.');
    }
}

/**
 * Get sessions directory path.
 */
function getSessionsDir(): string {
    return path.join(os.homedir(), '.assistant', 'sessions');
}

/**
 * Ensure sessions directory exists.
 */
function ensureSessionsDir(): void {
    const dir = getSessionsDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * Save session to file.
 */
function saveSession(
    name: string,
    agent: Agent,
    history: Message[]
): { ok: boolean; error?: string } {
    try {
        ensureSessionsDir();
        const filePath = path.join(getSessionsDir(), `${name}.json`);

        const existingCreated = fs.existsSync(filePath)
            ? JSON.parse(fs.readFileSync(filePath, 'utf8')).created
            : new Date().toISOString();

        const session: Session = {
            name,
            created: existingCreated,
            updated: new Date().toISOString(),
            agent: agent.name.toLowerCase(),
            history,
        };

        fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf8');
        return { ok: true };
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { ok: false, error: message };
    }
}

/**
 * Load session from file.
 */
function loadSession(name: string): { ok: boolean; session?: Session; error?: string } {
    try {
        const filePath = path.join(getSessionsDir(), `${name}.json`);
        if (!fs.existsSync(filePath)) {
            return { ok: false, error: `Session '${name}' not found` };
        }

        const data = fs.readFileSync(filePath, 'utf8');
        const session = JSON.parse(data) as Session;
        return { ok: true, session };
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { ok: false, error: message };
    }
}

/**
 * List all saved sessions.
 */
function listSessions(): Session[] {
    try {
        ensureSessionsDir();
        const dir = getSessionsDir();
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

        return files
            .map(file => {
                const data = fs.readFileSync(path.join(dir, file), 'utf8');
                return JSON.parse(data) as Session;
            })
            .sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
    } catch {
        return [];
    }
}

/**
 * Simple CLI Spinner
 */
class Spinner {
    private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    private timer: NodeJS.Timeout | null = null;
    private index = 0;

    constructor(private text: string = '') {}

    start() {
        if (this.timer) return;
        process.stdout.write('\x1B[?25l'); // Hide cursor
        this.timer = setInterval(() => {
            const frame = this.frames[(this.index = (this.index + 1) % this.frames.length)];
            process.stdout.write(`\r${frame} ${this.text}`);
        }, 80);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            process.stdout.write('\r\x1B[K'); // Clear line
            process.stdout.write('\x1B[?25h'); // Show cursor
        }
    }
}
