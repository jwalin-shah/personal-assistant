#!/usr/bin/env node

/**
 * Micro-tests for capability API (paths.* and commands.*)
 * These tests lock the contract to prevent regressions.
 * Tests the capability API through a minimal tool harness.
 */

import * as fs from 'node:fs';

import * as path from 'node:path';

import * as os from 'node:os';

import { z } from 'zod';
import { Executor } from './core/executor';

import { ErrorCode } from './core/tool_contract';

import { ToolResult, ToolRegistry, ToolHandler } from './core/types';

import { SYSTEM } from './agents';

// Create isolated temp directory for tests

const testRootRaw = fs.mkdtempSync(path.join(os.tmpdir(), 'capability-api-test-'));

const testRoot = fs.realpathSync(testRootRaw);

const testDataDir = path.join(testRoot, 'data');

const testConfigDir = path.join(testRoot, 'config');

fs.mkdirSync(testDataDir, { recursive: true });

fs.mkdirSync(testConfigDir, { recursive: true });

// Create minimal config

const configFile = path.join(testConfigDir, 'config.json');

fs.writeFileSync(
    configFile,

    JSON.stringify(
        {
            version: 1,

            fileBaseDir: testDataDir,
        },

        null,

        2
    ),

    'utf8'
);

// Set up environment

const testEnv: NodeJS.ProcessEnv = {
    ...process.env,

    ASSISTANT_CONFIG_DIR: testConfigDir,

    ASSISTANT_DATA_DIR: testDataDir,
};

delete testEnv.ASSISTANT_PERMISSIONS_PATH;

// Create permissions file with restrictive allowlist

const permissionsFile = path.join(testDataDir, 'permissions.json');

fs.writeFileSync(
    permissionsFile,

    JSON.stringify(
        {
            allow_paths: ['allowed.txt'],

            allow_commands: ['ls', 'pwd'],

            require_confirmation_for: [],

            deny_tools: [],
        },

        null,

        2
    ),

    'utf8'
);

interface TestArgs {
    test: string;
}

// Minimal test tool that exercises capability API

const testCapabilityAPI: ToolHandler<TestArgs> = (args, context): ToolResult => {
    const testName = args.test;

    if (testName === 'resolve_allowed_escape') {
        // Test 1: paths.resolveAllowed("../..", "read") throws (sandbox escape)

        try {
            context.paths.resolveAllowed('../..', 'read');

            return { ok: false, error: { code: 'TEST_FAIL', message: 'Expected throw for ../..' } };
        } catch (err: unknown) {
            if (
                typeof err === 'object' &&
                err !== null &&
                'code' in err &&
                (err as { code: string }).code === ErrorCode.DENIED_PATH_ALLOWLIST
            ) {
                return { ok: true, result: { test: 'resolve_allowed_escape', passed: true } };
            }

            const code =
                typeof err === 'object' && err !== null && 'code' in err
                    ? (err as { code: string }).code
                    : 'unknown';

            return {
                ok: false,

                error: {
                    code: 'TEST_FAIL',

                    message: `Expected DENIED_PATH_ALLOWLIST, got ${code}`,
                },
            };
        }
    }

    if (testName === 'assert_allowed_denied') {
        // Test 2: paths.assertAllowed(abs, "write") throws when permissions deny

        const deniedPath = path.join(context.baseDir, 'denied.txt');

        try {
            context.paths.assertAllowed(deniedPath, 'write');

            return {
                ok: false,

                error: { code: 'TEST_FAIL', message: 'Expected throw for denied path' },
            };
        } catch (err: unknown) {
            if (
                typeof err === 'object' &&
                err !== null &&
                'code' in err &&
                (err as { code: string }).code === ErrorCode.DENIED_PATH_ALLOWLIST
            ) {
                return { ok: true, result: { test: 'assert_allowed_denied', passed: true } };
            }

            const code =
                typeof err === 'object' && err !== null && 'code' in err
                    ? (err as { code: string }).code
                    : 'unknown';

            return {
                ok: false,

                error: {
                    code: 'TEST_FAIL',

                    message: `Expected DENIED_PATH_ALLOWLIST, got ${code}`,
                },
            };
        }
    }

    if (testName === 'run_allowed_denied') {
        // Test 3: commands.runAllowed("rm", ...) throws with existing deny code

        const result = context.commands.runAllowed('rm', ['file.txt']);

        if (!result.ok && result.errorCode === ErrorCode.DENIED_COMMAND_ALLOWLIST) {
            return { ok: true, result: { test: 'run_allowed_denied', passed: true } };
        }

        return {
            ok: false,

            error: {
                code: 'TEST_FAIL',

                message: `Expected DENIED_COMMAND_ALLOWLIST, got ${result.errorCode || 'ok'}`,
            },
        };
    }

    return { ok: false, error: { code: 'TEST_FAIL', message: `Unknown test: ${testName}` } };
};

// Create test registry

const createTestRegistry = (): ToolRegistry => {
    const handlers = new Map<string, ToolHandler>();

    const schemas = new Map<string, unknown>();

    handlers.set('test_capability_api', testCapabilityAPI as ToolHandler);

    schemas.set('test_capability_api', null);

    return {
        getHandler: (name: string) => handlers.get(name),

        getSchema: (name: string) => schemas.get(name) as z.ZodTypeAny,

        listTools: () => Array.from(handlers.keys()),
    };
};

async function runTests() {
    console.log('Running capability API micro-tests...');

    let failures = 0;

    try {
        const executor = new Executor({
            baseDir: testDataDir,

            limits: { maxReadSize: 1024 * 1024, maxWriteSize: 1024 * 1024 },

            permissionsPath: permissionsFile,

            registry: createTestRegistry(),

            agent: SYSTEM,
        });

        // Test 1: paths.resolveAllowed("../..", "read") throws (sandbox escape)

        const result1 = await executor.execute('test_capability_api', {
            test: 'resolve_allowed_escape',
        });

        const result = result1.result as { passed?: boolean };

        if (result1.ok && result?.passed) {
            console.log('PASS: paths.resolveAllowed("../..") throws DENIED_PATH_ALLOWLIST');
        } else {
            console.error('FAIL: paths.resolveAllowed("../..") test:', result1.error?.message);

            failures++;
        }

        // Test 2: paths.assertAllowed(abs, "write") throws when permissions deny

        const result2 = await executor.execute('test_capability_api', {
            test: 'assert_allowed_denied',
        });

        const result2Data = result2.result as { passed?: boolean };

        if (result2.ok && result2Data?.passed) {
            console.log('PASS: paths.assertAllowed(deniedPath) throws DENIED_PATH_ALLOWLIST');
        } else {
            console.error('FAIL: paths.assertAllowed(deniedPath) test:', result2.error?.message);

            failures++;
        }

        // Test 3: commands.runAllowed("rm", ...) throws with existing deny code

        const result3 = await executor.execute('test_capability_api', {
            test: 'run_allowed_denied',
        });

        const result3Data = result3.result as { passed?: boolean };

        if (result3.ok && result3Data?.passed) {
            console.log('PASS: commands.runAllowed("rm") returns DENIED_COMMAND_ALLOWLIST');
        } else {
            console.error('FAIL: commands.runAllowed("rm") test:', result3.error?.message);

            failures++;
        }
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);

        console.error('FAIL: Test setup error:', message);

        failures++;
    }

    // Cleanup

    fs.rmSync(testRoot, { recursive: true, force: true });

    if (failures > 0) {
        console.error(`\n${failures} test(s) failed.`);

        process.exit(1);
    } else {
        console.log('\nAll capability API tests passed.');
    }
}

runTests().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
});
