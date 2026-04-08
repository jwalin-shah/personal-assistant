/**
 * OpenAI-Compatible LLM Provider
 *
 * Works with any OpenAI-compatible API endpoint including:
 *   - Groq (https://api.groq.com/openai/v1)
 *   - OpenRouter (https://openrouter.ai/api/v1)
 *
 * TOKEN EFFICIENCY NOTES:
 * -----------------------
 * 1. Tool Descriptions: Each tool schema is sent with every request.
 *    Keep tool descriptions SHORT to minimize tokens per turn.
 *
 * 2. History Window: We use a sliding window (10 messages) to limit
 *    context size. See repl.ts getValidHistorySlice().
 *
 * 3. System Prompt: Kept minimal per agent. See agents/index.ts.
 *
 * 4. Request Structure: Only required fields are sent.
 *    - model, messages, tools (if any), tool_choice
 *
 * @module llm/openai_compatible
 */

import * as http from 'node:http';
import { request as httpRequest, IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';
import { LLMProvider, CompletionResult, StreamChunk } from './provider';
import { ToolSpec, Message, TokenUsage } from '../../core/types';
import { formatToolsCompact } from '../../tools/compact';
import { withRetry } from './retry';
import { validateToolCall } from '../../core/tool_contract';

interface FetchOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
}

interface FetchResponse {
    ok: boolean;
    status: number;
    statusText?: string;
    text: () => Promise<string>;
    json: () => Promise<unknown>;
}

type FetchLike = (url: string, options?: FetchOptions) => Promise<FetchResponse>;

function fetchFallback(url: string, options?: FetchOptions): Promise<FetchResponse> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const requestFn = urlObj.protocol === 'https:' ? httpsRequest : httpRequest;

        // Handle AbortController signal for timeout
        const signal = options?.signal as AbortSignal | undefined;
        let timeoutId: NodeJS.Timeout | null = null;
        let req: ReturnType<typeof httpsRequest> | null = null;

        const cleanup = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
        };

        const abortHandler = () => {
            cleanup();
            if (req) {
                req.destroy();
            }
            const abortError = new Error('Request aborted');
            abortError.name = 'AbortError';
            reject(abortError);
        };

        if (signal) {
            if (signal.aborted) {
                const abortError = new Error('Request aborted');
                abortError.name = 'AbortError';
                reject(abortError);
                return;
            }

            // Register abort handler - will be called after req is created
            signal.addEventListener('abort', abortHandler);
        }

        req = requestFn(
            {
                method: (options?.method as string) || 'GET',
                headers: (options?.headers as Record<string, string>) || {},
                hostname: urlObj.hostname,
                port: urlObj.port,
                path: `${urlObj.pathname}${urlObj.search}`,
            },
            res => {
                cleanup();
                if (signal) {
                    signal.removeEventListener('abort', abortHandler);
                }
                let data = '';
                res.setEncoding('utf8');
                res.on('data', chunk => {
                    data += chunk;
                });
                res.on('end', () => {
                    const status = res.statusCode || 0;
                    resolve({
                        ok: status >= 200 && status < 300,
                        status,
                        text: async () => data,
                        json: async () => JSON.parse(data),
                    });
                });
            }
        ) as http.ClientRequest;

        if (req) {
            req.on('error', (err: Error) => {
                cleanup();
                if (signal) {
                    signal.removeEventListener('abort', abortHandler);
                }
                reject(err);
            });
        }

        if (options?.body && req) req.write(options.body);
        if (req) req.end();
    });
}

function getFetch(): FetchLike {
    if (typeof fetch === 'function') return fetch.bind(globalThis) as unknown as FetchLike;
    return fetchFallback as unknown as FetchLike;
}

export class OpenAICompatibleProvider implements LLMProvider {
    constructor(
        private apiKey: string,
        private baseUrl: string,
        private model: string,
        private maxRetries: number = 3
    ) {}

    /**
     * Send a completion request to the LLM.
     *
     * @param prompt - User's current input
     * @param tools - Available tool schemas (filtered by agent)
     * @param history - Conversation history (already windowed for efficiency)
     * @param verbose - Enable debug logging
     * @param systemPrompt - Agent-specific system prompt
     */
    async complete(
        prompt: string,
        tools: Record<string, ToolSpec>,
        history: Message[] = [],
        verbose: boolean = false,
        systemPrompt?: string,
        options?: { toolFormat?: 'standard' | 'compact' }
    ): Promise<CompletionResult> {
        // Build messages array with system prompt first
        const messages: Array<{ role: string; content?: string | null }> = [
            {
                role: 'system',
                content:
                    systemPrompt ||
                    'You are a helpful assistant. Use the provided tools to satisfy user requests.',
            },
            ...history,
        ];

        if (prompt) {
            messages.push({ role: 'user', content: prompt });
        }

        // Compact Tools Optimization
        // --------------------------
        // Instead of sending the full JSON Schema (heavy), we send TypeScript signatures (light)
        // and ask the model to reply with a specific JSON format.
        const useCompact = options?.toolFormat === 'compact';
        let toolsPayload: unknown = undefined;
        let systemMessageContent = messages[0].content || '';

        if (tools && Object.keys(tools).length > 0) {
            if (useCompact) {
                const compactTools = formatToolsCompact(tools);
                systemMessageContent += `\n\n# TOOLS\nYou have access to the following tools. To use a tool, YOU MUST respond with a JSON object in this format:\n{"tool": "tool_name", "args": {...}}\n\nDo not add explanation. JUST JSON.\n\n${compactTools}`;
                // Update system message
                messages[0].content = systemMessageContent;
            } else {
                // Convert tool schemas to OpenAI format
                // NOTE: Tool descriptions directly impact token usage per request
                const openAITools = Object.entries(tools).map(([name, spec]) => ({
                    type: 'function',
                    function: {
                        name: name,
                        description: spec.description || `Tool: ${name}`,
                        parameters: {
                            type: 'object',
                            properties: Object.fromEntries(
                                Object.entries(spec.parameters || {}).map(([arg, param]) => {
                                    const schema: Record<string, unknown> = {
                                        type: param.type,
                                        description: param.description,
                                    };
                                    if (param.enum) schema.enum = param.enum;
                                    return [arg, schema];
                                })
                            ),
                            required: Array.isArray(spec.required) ? spec.required : [],
                        },
                    },
                }));
                toolsPayload = openAITools;
            }
        }

        try {
            const fetchFn = getFetch();
            const bodyStr = JSON.stringify({
                model: this.model,
                messages,
                tools: toolsPayload,
                tool_choice: toolsPayload ? 'auto' : undefined,
            });

            if (verbose) {
                console.log(`[Verbose] Calling ${this.baseUrl}/chat/completions`);
                console.log(
                    `[Verbose] Request Body:\n${JSON.stringify(JSON.parse(bodyStr), null, 2)}`
                );
            }

            // Use withRetry for automatic exponential backoff
            const res = await withRetry(
                async () => {
                    // Create AbortController for timeout
                    const controller = new AbortController();
                    const timeoutMs = 60000; // 60 second timeout
                    const timeoutId = setTimeout(() => {
                        controller.abort();
                    }, timeoutMs);

                    try {
                        const response = await fetchFn(`${this.baseUrl}/chat/completions`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${this.apiKey}`,
                            },
                            body: bodyStr,
                            signal: controller.signal,
                        } as FetchOptions);

                        clearTimeout(timeoutId);

                        // Throw on retryable errors so withRetry can handle them
                        if (!response.ok && (response.status === 429 || response.status >= 500)) {
                            const error = Object.assign(new Error(`API Error ${response.status}`), {
                                status: response.status,
                            });
                            throw error;
                        }

                        return response;
                    } catch (err: unknown) {
                        clearTimeout(timeoutId);
                        // Handle timeout/abort errors
                        const errObj = err as { name?: string };
                        if (errObj.name === 'AbortError' || controller.signal.aborted) {
                            const timeoutError = Object.assign(
                                new Error('Request timeout after 60 seconds'),
                                { status: 408 }
                            ); // Request Timeout
                            throw timeoutError;
                        }
                        throw err;
                    }
                },
                {
                    maxRetries: this.maxRetries,
                    baseDelayMs: 1000,
                    onRetry: (attempt, delayMs, error) => {
                        if (verbose) {
                            const msg = error instanceof Error ? error.message : String(error);
                            console.log(
                                `[Verbose] ${msg}. Retrying in ${Math.round(delayMs)}ms... (attempt ${attempt}/${this.maxRetries})`
                            );
                        }
                    },
                }
            );

            if (!res) {
                return { ok: false, error: 'Network failed after retries' };
            }

            if (verbose) {
                console.log(`[Verbose] Response Status: ${res.status}`);
            }

            if (!res.ok) {
                const text = await res.text();
                return { ok: false, error: `API Error ${res.status}: ${text}` };
            }

            const rawData = await res.json();
            // Type assertion for OpenAI-compatible response format
            const data = rawData as {
                usage?: {
                    prompt_tokens?: number;
                    completion_tokens?: number;
                    total_tokens?: number;
                };
                choices?: Array<{
                    message: {
                        content?: string | null;
                        tool_calls?: Array<{
                            function: { name: string; arguments: string };
                        }>;
                    };
                }>;
            };

            if (verbose) {
                console.log(`[Verbose] Response Body:\n${JSON.stringify(data, null, 2)}`);
            }

            // Extract token usage from API response
            const usage: TokenUsage | null = data.usage
                ? {
                      prompt_tokens: data.usage.prompt_tokens || 0,
                      completion_tokens: data.usage.completion_tokens || 0,
                      total_tokens: data.usage.total_tokens || 0,
                  }
                : null;

            if (verbose && usage) {
                console.log(
                    `[Tokens] In: ${usage.prompt_tokens}, Out: ${usage.completion_tokens}, Total: ${usage.total_tokens}`
                );
            }

            const choice = data.choices?.[0];

            if (!choice) return { ok: false, error: 'No choices returned', usage };

            const message = choice.message;

            // Handle tool calls
            if (message.tool_calls && message.tool_calls.length > 0) {
                const tc = message.tool_calls[0];
                return {
                    ok: true,
                    toolCall: {
                        tool_name: tc.function.name,
                        args: JSON.parse(tc.function.arguments),
                        _debug: null,
                    },
                    usage,
                };
            }

            if (!message.content) {
                return {
                    ok: false,
                    error: 'Model returned an empty response. Try rephrasing.',
                    usage,
                };
            }

            // Handle Compact Tool Calls (Parsing JSON from content)
            if (useCompact && message.content) {
                try {
                    // Extract JSON from markdown or raw text
                    let jsonStr = message.content.trim();

                    // Try to extract from markdown code blocks first
                    if (jsonStr.startsWith('```')) {
                        const matches = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                        if (matches && matches[1]) {
                            jsonStr = matches[1].trim();
                        }
                    }

                    // Find the first complete JSON object
                    // Only accept if we can parse a complete, valid JSON object
                    const firstBrace = jsonStr.indexOf('{');
                    if (firstBrace >= 0) {
                        // Try to find a complete JSON object starting from first brace
                        let braceCount = 0;
                        let endPos = -1;

                        for (let i = firstBrace; i < jsonStr.length; i++) {
                            if (jsonStr[i] === '{') braceCount++;
                            else if (jsonStr[i] === '}') {
                                braceCount--;
                                if (braceCount === 0) {
                                    endPos = i;
                                    break;
                                }
                            }
                        }

                        // Only proceed if we found a complete, balanced JSON object
                        if (endPos > firstBrace) {
                            jsonStr = jsonStr.substring(firstBrace, endPos + 1);
                            const parsed = JSON.parse(jsonStr);

                            // Defensive checks: must be an object with expected structure
                            if (
                                typeof parsed !== 'object' ||
                                Array.isArray(parsed) ||
                                parsed === null
                            ) {
                                // Not a valid object, treat as text reply
                            } else if (
                                parsed.tool &&
                                typeof parsed.tool === 'string' &&
                                parsed.args &&
                                typeof parsed.args === 'object' &&
                                !Array.isArray(parsed.args)
                            ) {
                                // Convert compact format (tool) to standard format (tool_name)
                                const toolCall = {
                                    tool_name: parsed.tool,
                                    args: parsed.args,
                                };

                                // Validate through the same path as normal tool calls
                                const validation = validateToolCall(toolCall);
                                if (validation.ok && validation.value) {
                                    return {
                                        ok: true,
                                        toolCall: {
                                            tool_name: validation.value.tool_name,
                                            args: validation.value.args,
                                            _debug: {
                                                path: 'llm_manual_parse',
                                                model: this.model,
                                                memory_read: false,
                                                memory_write: false,
                                                manual_parse: true,
                                            },
                                        },
                                        usage,
                                    };
                                }
                                // Validation failed, treat as text reply
                            }
                            // Missing required fields, treat as text reply
                        }
                    }
                } catch {
                    // Not valid JSON, treat as text reply
                }
            }

            return {
                ok: true,
                reply: message.content,
                usage,
            };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return { ok: false, error: message };
        }
    }

    /**
     * Stream completion for conversational replies.
     * Uses Server-Sent Events (SSE) format.
     */
    async *completeStream(
        prompt: string,
        history: Message[] = [],
        _verbose: boolean = false,
        systemPrompt?: string
    ): AsyncGenerator<StreamChunk, void, unknown> {
        const messages: Array<{ role: string; content?: string | null }> = [
            {
                role: 'system',
                content: systemPrompt || 'You are a helpful assistant.',
            },
            ...history,
        ];

        if (prompt) {
            messages.push({ role: 'user', content: prompt });
        }

        const bodyStr = JSON.stringify({
            model: this.model,
            messages,
            stream: true,
        });

        const urlObj = new URL(`${this.baseUrl}/chat/completions`);
        const requestFn = urlObj.protocol === 'https:' ? httpsRequest : httpRequest;

        // Create timeout for stream request
        const timeoutMs = 60000; // 60 second timeout
        let timeoutId: NodeJS.Timeout | null = null;
        let requestCompleted = false;
        let req: ReturnType<typeof httpsRequest> | null = null;

        let response: IncomingMessage;
        try {
            response = await new Promise<IncomingMessage>((resolve, reject) => {
                timeoutId = setTimeout(() => {
                    if (!requestCompleted) {
                        requestCompleted = true;
                        if (req) {
                            req.destroy();
                        }
                        reject(new Error('Request timeout after 60 seconds'));
                    }
                }, timeoutMs);

                req = requestFn(
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${this.apiKey}`,
                        },
                        hostname: urlObj.hostname,
                        port: urlObj.port,
                        path: `${urlObj.pathname}${urlObj.search}`,
                    },
                    res => {
                        if (timeoutId) {
                            clearTimeout(timeoutId);
                            timeoutId = null;
                        }
                        requestCompleted = true;
                        resolve(res);
                    }
                ) as http.ClientRequest;

                if (req) {
                    req.on('error', (err: Error) => {
                        if (timeoutId) {
                            clearTimeout(timeoutId);
                            timeoutId = null;
                        }
                        requestCompleted = true;
                        reject(err);
                    });
                }

                if (req) {
                    req.write(bodyStr);
                    req.end();
                }
            });
        } catch (err: unknown) {
            // Handle timeout and other errors
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            const message = err instanceof Error ? err.message : 'Stream request failed';
            yield {
                content: '',
                done: true,
                error: {
                    message,
                    code: message.includes('timeout') ? 'TIMEOUT' : 'STREAM_ERROR',
                },
            } as StreamChunk & { error?: { message: string; code: string; statusCode?: number } };
            return;
        }

        if (response.statusCode !== 200) {
            yield {
                content: '',
                done: true,
                error: {
                    message: `HTTP ${response.statusCode}`,
                    code: 'HTTP_ERROR',
                    statusCode: response.statusCode,
                },
            } as StreamChunk & { error?: { message: string; code: string; statusCode?: number } };
            return;
        }

        response.setEncoding('utf8');
        let buffer = '';

        try {
            for await (const chunk of response) {
                buffer += chunk as string;
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();

                    if (data === '[DONE]') {
                        yield { content: '', done: true };
                        return;
                    }

                    try {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const parsed = JSON.parse(data) as any;
                        const content = parsed.choices?.[0]?.delta?.content || '';
                        if (content) {
                            yield { content, done: false };
                        }
                    } catch {
                        // Ignore malformed chunks (non-fatal)
                    }
                }
            }

            yield { content: '', done: true };
        } catch (err: unknown) {
            // Handle stream reading errors
            const message = err instanceof Error ? err.message : 'Stream read error';
            yield {
                content: '',
                done: true,
                error: {
                    message,
                    code: 'STREAM_READ_ERROR',
                },
            } as StreamChunk & { error?: { message: string; code: string; statusCode?: number } };
        }
    }
}
