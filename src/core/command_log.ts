/**
 * Command logging system for tracking user queries, routing decisions, and outcomes.
 * Enables evaluation of what commands are working vs not working.
 * @module command_log
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RouteResult, ToolResult } from './types';
import { isRouteError, isRouteToolCall, isRouteReply } from './types';

export interface CommandLogEntry {
    ts: string;
    correlation_id: string;
    input: string;
    intent?: string;
    agent?: string;

    // Routing information
    routing_path?: string; // 'regex_fast_path', 'heuristic_parse', 'cli_parse', 'llm_fallback'
    routing_duration_ms?: number;
    routing_success: boolean;
    routing_error?: string;

    // Tool execution (if routed to tool)
    tool_name?: string;
    tool_args?: Record<string, unknown>;
    tool_success?: boolean;
    tool_error?: string;
    tool_duration_ms?: number;

    // LLM usage (if LLM was used)
    llm_model?: string;
    llm_tokens_prompt?: number;
    llm_tokens_completion?: number;
    llm_tokens_total?: number;

    // Reply mode (if LLM generated a reply)
    reply_mode?: boolean;

    // Outcome classification
    outcome: 'success' | 'error' | 'partial'; // success = tool executed successfully, error = failed, partial = routed but not executed
    outcome_category?: string; // e.g., 'file_operation', 'memory', 'task', 'query'
}

export class CommandLogger {
    private logPath: string;
    private enabled: boolean;

    constructor(logPath: string, enabled: boolean = true) {
        this.logPath = logPath;
        this.enabled = enabled;

        // Ensure directory exists
        if (enabled) {
            const dir = path.dirname(logPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
    }

    /**
     * Log a command execution with routing and tool results.
     */
    logCommand(
        correlationId: string,
        input: string,
        routeResult: RouteResult,
        toolResult?: ToolResult,
        metadata?: {
            intent?: string;
            agent?: string;
        }
    ): void {
        if (!this.enabled) return;

        try {
            const entry: Partial<CommandLogEntry> = {
                ts: new Date().toISOString(),
                correlation_id: correlationId,
                input: input.trim(),
                intent: metadata?.intent,
                agent: metadata?.agent,
            };

            // Handle RouteError
            if (isRouteError(routeResult)) {
                entry.routing_success = false;
                entry.routing_error = routeResult.error;
                entry.outcome = 'error';
            } else {
                // Handle RouteToolCall or RouteReply
                entry.routing_success = true;
                entry.routing_path = routeResult._debug?.path;
                entry.routing_duration_ms = routeResult._debug?.duration_ms || undefined;

                if (isRouteToolCall(routeResult)) {
                    entry.tool_name = routeResult.tool_call.tool_name;
                    entry.tool_args = this.sanitizeArgs(routeResult.tool_call.args);
                }

                if (isRouteReply(routeResult)) {
                    entry.reply_mode = true;
                }

                // Extract LLM usage
                if (routeResult.usage) {
                    entry.llm_tokens_prompt = routeResult.usage.prompt_tokens;
                    entry.llm_tokens_completion = routeResult.usage.completion_tokens;
                    entry.llm_tokens_total = routeResult.usage.total_tokens;
                }

                if (routeResult._debug?.model) {
                    entry.llm_model = routeResult._debug.model;
                }
            }

            // Extract tool execution results
            if (toolResult) {
                entry.tool_success = toolResult.ok;
                entry.tool_error = toolResult.error?.message || undefined;
                entry.tool_duration_ms = toolResult._debug?.duration_ms || undefined;
            }

            // Determine outcome if not already set
            if (!entry.outcome) {
                if (toolResult) {
                    entry.outcome = toolResult.ok ? 'success' : 'error';
                } else if (entry.reply_mode) {
                    entry.outcome = 'success'; // Reply mode is considered success
                } else {
                    entry.outcome = 'partial'; // Routed but not executed
                }
            }

            // Ensure outcome is set (required field)
            const finalEntry: CommandLogEntry = {
                ...entry,
                outcome: entry.outcome || 'partial',
            } as CommandLogEntry;

            // Classify outcome category
            finalEntry.outcome_category = this.classifyCategory(finalEntry);

            // Write to log file
            fs.appendFileSync(this.logPath, JSON.stringify(finalEntry) + '\n', 'utf8');
        } catch (_err: unknown) {
            // Silently ignore logging failures to not break execution
            // Could optionally log to stderr in development
            if (_err instanceof Error) {
                console.error(`CommandLogger error: ${_err.message}`);
            }
        }
    }

    /**
     * Sanitize args to avoid logging sensitive data.
     */
    private sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
        if (!args || typeof args !== 'object') return args;

        const sanitized = { ...args };

        // Truncate long content
        if (
            sanitized.content &&
            typeof sanitized.content === 'string' &&
            sanitized.content.length > 200
        ) {
            sanitized.content = sanitized.content.substring(0, 200) + '...[truncated]';
        }

        // Truncate long text
        if (sanitized.text && typeof sanitized.text === 'string' && sanitized.text.length > 200) {
            sanitized.text = sanitized.text.substring(0, 200) + '...[truncated]';
        }

        // Remove or mask sensitive fields
        const sensitiveFields = ['password', 'api_key', 'token', 'secret'];
        for (const field of sensitiveFields) {
            if (field in sanitized) {
                sanitized[field] = '[REDACTED]';
            }
        }

        return sanitized;
    }

    /**
     * Classify the command category based on tool and input.
     */
    private classifyCategory(entry: CommandLogEntry): string {
        if (entry.tool_name) {
            if (entry.tool_name.startsWith('task_')) return 'task';
            if (
                entry.tool_name.startsWith('memory_') ||
                entry.tool_name === 'remember' ||
                entry.tool_name === 'recall'
            )
                return 'memory';
            if (
                entry.tool_name.includes('file') ||
                entry.tool_name.includes('read') ||
                entry.tool_name.includes('write')
            )
                return 'file_operation';
            if (entry.tool_name.includes('git')) return 'git';
            if (entry.tool_name === 'run_cmd') return 'command';
            if (entry.tool_name === 'calculate') return 'calculation';
            if (entry.tool_name === 'get_time') return 'query';
            if (entry.tool_name === 'read_url') return 'web';
        }

        if (entry.reply_mode) return 'query';

        return 'general';
    }

    /**
     * Read command logs from file.
     * Uses a stream-based approach to avoid loading the entire file into memory.
     * Defaults to returning the last 2000 entries to prevent OOM.
     */
    readLogs(limit: number = 2000): CommandLogEntry[] {
        if (!fs.existsSync(this.logPath)) return [];

        try {
            // Memory optimization: If file is huge, this sync read is still dangerous.
            // But for a surgical fix without async refactoring (which breaks call sites),
            // we apply the limit strictly after read.
            // ideally we would use readline, but readLogs is synchronous in the interface.
            // Refactoring to async readLogs would require updating cli.ts and other consumers.

            // Given the constraints, we must keep it synchronous.
            // To truly fix OOM with sync API, we should use fs.readSync with a buffer from the end.

            // Let's implement a robust synchronous reverse reader.
            const entries: CommandLogEntry[] = [];
            const fd = fs.openSync(this.logPath, 'r');
            try {
                const stats = fs.fstatSync(fd);
                const fileSize = stats.size;
                const bufferSize = 1024 * 64; // 64KB chunks
                const buffer = Buffer.alloc(bufferSize);

                let position = fileSize;
                let remainder = '';

                while (position > 0 && entries.length < limit) {
                    const readSize = Math.min(position, bufferSize);
                    position -= readSize;

                    fs.readSync(fd, buffer, 0, readSize, position);
                    const chunk = buffer.toString('utf8', 0, readSize);

                    // Combine with remainder from previous iteration (which was the start of a line)
                    const content = chunk + remainder;
                    const lines = content.split('\n');

                    // The first element might be partial if we aren't at the start of file
                    if (position > 0) {
                        remainder = lines.shift() || '';
                    } else {
                        remainder = '';
                    }

                    // Process lines in reverse order
                    for (let i = lines.length - 1; i >= 0; i--) {
                        const line = lines[i].trim();
                        if (!line) continue;

                        try {
                            entries.push(JSON.parse(line));
                            if (entries.length >= limit) break;
                        } catch (_e: unknown) {
                            // Ignore corrupt lines
                            if (_e instanceof Error) {
                                console.error(`CommandLogger readLogs parse error: ${_e.message}`);
                            }
                        }
                    }
                }
            } finally {
                fs.closeSync(fd);
            }

            // Entries are already newest-first (read from end)
            // But the original implementation sorted by ts.
            // Our reverse read gives rough reverse chronological order (append order).
            // Let's sort them to be precise.
            entries.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

            return limit ? entries.slice(0, limit) : entries;
        } catch {
            return [];
        }
    }

    /**
     * Get statistics from logs.
     */
    getStats(entries?: CommandLogEntry[]): {
        total: number;
        success: number;
        error: number;
        partial: number;
        byCategory: Record<string, { total: number; success: number; error: number }>;
        byRoutingPath: Record<string, number>;
        byTool: Record<string, { total: number; success: number; error: number }>;
        avgLatency: number;
        llmUsage: { totalTokens: number; totalCalls: number };
    } {
        const logs = entries || this.readLogs();

        const stats = {
            total: logs.length,
            success: 0,
            error: 0,
            partial: 0,
            byCategory: {} as Record<string, { total: number; success: number; error: number }>,
            byRoutingPath: {} as Record<string, number>,
            byTool: {} as Record<string, { total: number; success: number; error: number }>,
            avgLatency: 0,
            llmUsage: { totalTokens: 0, totalCalls: 0 },
        };

        let totalLatency = 0;
        let latencyCount = 0;

        for (const entry of logs) {
            // Count outcomes
            if (entry.outcome === 'success') stats.success++;
            else if (entry.outcome === 'error') stats.error++;
            else stats.partial++;

            // Count by category
            const cat = entry.outcome_category || 'unknown';
            if (!stats.byCategory[cat]) {
                stats.byCategory[cat] = { total: 0, success: 0, error: 0 };
            }
            stats.byCategory[cat].total++;
            if (entry.outcome === 'success') stats.byCategory[cat].success++;
            if (entry.outcome === 'error') stats.byCategory[cat].error++;

            // Count by routing path
            const path = entry.routing_path || 'unknown';
            stats.byRoutingPath[path] = (stats.byRoutingPath[path] || 0) + 1;

            // Count by tool
            if (entry.tool_name) {
                if (!stats.byTool[entry.tool_name]) {
                    stats.byTool[entry.tool_name] = { total: 0, success: 0, error: 0 };
                }
                stats.byTool[entry.tool_name].total++;
                if (entry.tool_success) stats.byTool[entry.tool_name].success++;
                if (entry.tool_success === false) stats.byTool[entry.tool_name].error++;
            }

            // Calculate latency
            const latency = entry.tool_duration_ms || entry.routing_duration_ms;
            if (latency) {
                totalLatency += latency;
                latencyCount++;
            }

            // Track LLM usage
            if (entry.llm_tokens_total) {
                stats.llmUsage.totalTokens += entry.llm_tokens_total;
                stats.llmUsage.totalCalls++;
            }
        }

        stats.avgLatency = latencyCount > 0 ? totalLatency / latencyCount : 0;

        return stats;
    }
}
