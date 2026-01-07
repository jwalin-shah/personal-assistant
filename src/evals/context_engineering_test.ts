#!/usr/bin/env node

/**
 * Context Engineering / LLM Integration Test
 *
 * Verifies that:
 * 1. MockProvider is correctly injected into the router.
 * 2. Router correctly uses the MockProvider for tool calls.
 * 3. Router correctly uses the MockProvider for replies.
 * 4. Router respects the injected Agent (including custom system prompts).
 */

import { route } from '../app/router';
import { SYSTEM } from '../agents';
import { MockLLMProvider } from '../providers/llm/mock_provider';
import { LLMProvider } from '../providers/llm/provider';
import { ToolSpec, Message } from '../core/types';

let failures = 0;

function assert(condition: boolean, message: string) {
    if (!condition) {
        console.error(`❌ FAIL: ${message}`);
        failures++;
    } else {
        console.log(`✅ PASS: ${message}`);
    }
}

async function testMockInjection() {
    console.log('\n--- Test: Mock Injection (Reply) ---');
    const mockProvider = new MockLLMProvider({
        'test query': {
            reply: 'This is a mock response',
        },
    });

    const result = await route('test query', 'spike', null, [], false, SYSTEM, mockProvider);

    if ('mode' in result && result.mode === 'reply') {
        assert(result.reply.content === 'This is a mock response', 'Content should match mock');
    } else {
        assert(false, 'Mode should be reply');
    }
}

async function testMockToolCall() {
    console.log('\n--- Test: Mock Tool Call ---');
    const mockProvider = new MockLLMProvider({
        'calculate factorial 5': {
            toolCall: {
                tool_name: 'calculate',
                args: { expression: '5!' },
            },
        },
    });

    const result = await route(
        'calculate factorial 5',
        'spike',
        null,
        [],
        false,
        SYSTEM,
        mockProvider
    );

    if ('mode' in result && result.mode === 'tool_call') {
        assert(result.tool_call.tool_name === 'calculate', 'Tool name should be calculate');
        assert(result.tool_call.args.expression === '5!', 'Args should match');
    } else {
        assert(false, 'Mode should be tool_call');
    }
}

async function testCustomAgent() {
    console.log('\n--- Test: Custom Agent (System Prompt) ---');

    // We create a "Spy" provider that stores the system prompt it received
    let capturedSystemPrompt = '';
    const spyProvider: LLMProvider = {
        complete: async (
            prompt: string,
            tools: Record<string, ToolSpec>,
            history?: Message[],
            verbose?: boolean,
            sysPrompt?: string
        ) => {
            capturedSystemPrompt = sysPrompt || '';
            return { ok: true, reply: 'ok' };
        },
    };

    const customAgent = { ...SYSTEM, systemPrompt: 'CUSTOM_PROMPT_123' };

    await route('any input', 'spike', null, [], false, customAgent, spyProvider);

    assert(
        capturedSystemPrompt === 'CUSTOM_PROMPT_123',
        'Provider should receive custom system prompt'
    );
}

async function runTests() {
    try {
        await testMockInjection();
        await testMockToolCall();
        await testCustomAgent();
    } catch (err: unknown) {
        console.error('Unhandled Exception:', err instanceof Error ? err.message : String(err));
        failures++;
    }

    if (failures > 0) {
        console.error(`\nTests failed with ${failures} errors.`);
        process.exit(1);
    } else {
        console.log('\nAll tests passed.');
        process.exit(0);
    }
}

runTests();
