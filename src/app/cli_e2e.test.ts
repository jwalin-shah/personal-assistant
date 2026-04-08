#!/usr/bin/env node

/**
 * E2E tests for CLI commands including 100x features
 */

import { strict as assert } from 'assert';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const cliPath = path.join(__dirname, '..', '..', 'dist', 'app', 'cli.js');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-e2e-'));

function cleanup() {
    if (fs.existsSync(testRoot)) {
        fs.rmSync(testRoot, { recursive: true, force: true });
    }
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
    cleanup();
    process.exit(1);
});

function runCli(args: string[], cwd?: string): { status: number; stdout: string; stderr: string } {
    const result = spawnSync(process.execPath, [cliPath, ...args], {
        cwd: cwd || process.cwd(),
        encoding: 'utf8',
        env: {
            ...process.env,
            ASSISTANT_DATA_DIR: path.join(testRoot, 'data'),
            ASSISTANT_CONFIG_DIR: path.join(testRoot, 'config'),
        },
    });
    return {
        status: result.status || 0,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
    };
}

interface CommandResponse {
    ok?: boolean;
    result?: {
        total_time_ms?: number;
        tool_name?: string;
        entries?: number;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

function parseJson(output: string): CommandResponse | null {
    try {
        const lines = output.trim().split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
            try {
                return JSON.parse(lines[i]) as CommandResponse;
            } catch {
                continue;
            }
        }
    } catch {
        // ignore
    }
    return null;
}

function runTests() {
    console.log('Running CLI E2E tests...');
    let failures = 0;

    // Test 1: Generate tool command
    try {
        const result = runCli(['generate', 'tool', 'e2e_test_tool', '--args', 'text:string']);
        const json = parseJson(result.stdout);
        assert.ok(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (json as any)?.ok === true || result.status === 0,
            'Generate tool should succeed'
        );
        console.log('PASS: Generate tool command');
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('FAIL: Generate tool command', message);
        failures++;
    }

    // Test 2: Generate tests command
    try {
        // First create a tool to test against
        runCli(['generate', 'tool', 'e2e_test_tool2', '--args', 'name:string']);

        const result = runCli(['generate', 'tests', 'e2e_test_tool2']);
        const json = parseJson(result.stdout);
        assert.ok(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (json as any)?.ok === true || result.status === 0,
            'Generate tests should succeed'
        );
        console.log('PASS: Generate tests command');
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('FAIL: Generate tests command', message);
        failures++;
    }

    // Test 3: Profile command
    try {
        const result = runCli(['profile', 'remember: test']);
        const json = parseJson(result.stdout);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        assert.ok((json as any)?.ok === true, 'Profile should succeed');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        assert.ok(typeof (json as any)?.result?.total_time_ms === 'number', 'Should have timing');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        assert.ok(typeof (json as any)?.result?.tool_name === 'string', 'Should have tool name');
        console.log('PASS: Profile command');
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('FAIL: Profile command', message);
        failures++;
    }

    // Test 4: Cache commands
    try {
        const clearResult = runCli(['cache', 'clear']);
        const clearJson = parseJson(clearResult.stdout);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        assert.ok((clearJson as any)?.ok === true, 'Cache clear should succeed');

        const statsResult = runCli(['cache', 'stats']);
        const statsJson = parseJson(statsResult.stdout);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        assert.ok((statsJson as any)?.ok === true, 'Cache stats should succeed');
        assert.ok(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            typeof (statsJson as any)?.result?.entries === 'number',
            'Should have entries count'
        );
        console.log('PASS: Cache commands');
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('FAIL: Cache commands', message);
        failures++;
    }

    // Test 5: Help command
    try {
        const result = runCli(['--help']);
        assert.ok(result.stdout.includes('Usage') || result.stdout.includes('Commands'));
        console.log('PASS: Help command');
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('FAIL: Help command', message);
        failures++;
    }

    // Test 6: Version command
    try {
        const result = runCli(['--version']);
        assert.ok(result.stdout.trim().length > 0);
        console.log('PASS: Version command');
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('FAIL: Version command', message);
        failures++;
    }

    if (failures > 0) {
        console.error(`\n${failures} test(s) failed`);
        process.exit(1);
    }

    console.log('RESULT\nstatus: OK\n');
}

runTests();
export {};
