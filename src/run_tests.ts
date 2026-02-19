#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { TestCache } from './core/test_cache';
import { runTestsInParallel } from './core/test_worker';

const baseDir = __dirname;
// Detect dist mode: either via env var or if running as compiled JS
const isDist = process.env.TEST_DIST === '1' || __filename.endsWith('.js');
const tsNodeRegister = !isDist ? require.resolve('ts-node/register') : null;

// Initialize test cache
const testCache = new TestCache();
const sourceDir = path.join(baseDir, '..', 'src');
const skipCache = process.env.TEST_SKIP_CACHE === '1';

// Parallel execution settings
const useParallel = process.env.TEST_PARALLEL !== '0'; // Default: enabled
const maxWorkers = parseInt(process.env.TEST_MAX_WORKERS || '4', 10);

function findTestFiles(dir: string): string[] {
    const files = fs.readdirSync(dir);
    const testFiles: string[] = [];
    const testExt = isDist ? '.test.js' : '.test.ts';
    const runnerName = isDist ? 'run_tests.js' : 'run_tests.ts';

    for (const file of files) {
        if (file.endsWith(testExt) && file !== runnerName) {
            const filePath = path.join(dir, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            if (
                content.includes(`from 'vitest'`) ||
                content.includes(`require('vitest')`) ||
                content.includes(`require("vitest")`)
            ) {
                continue;
            }
            testFiles.push(filePath);
        }
    }
    return testFiles;
}

function runTest(filePath: string): boolean {
    const relativePath = path.relative(process.cwd(), filePath);
    const startTime = Date.now();

    // Check cache first
    if (!skipCache && testCache.shouldSkipTest(filePath, sourceDir)) {
        console.log(`⏭️  ${relativePath} - skipped (cached pass)`);
        return true;
    }

    console.log(`Running ${relativePath}...`);

    // In dist mode, run with plain node (no loaders)
    // In TS mode, use ts-node/register
    // Limit child process memory to 256MB to stay within 8GB total RAM
    const memLimit = process.env.TEST_MAX_MEM || '256';
    const execArgs = isDist
        ? [`--max-old-space-size=${memLimit}`, filePath]
        : [`--max-old-space-size=${memLimit}`, '-r', tsNodeRegister!, filePath];

    const result = spawnSync(process.execPath, execArgs, {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '1' },
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);

    const duration = Date.now() - startTime;
    const passed = result.status === 0;

    // Save result to cache
    if (!skipCache) {
        testCache.saveResult(
            {
                file: path.basename(filePath),
                timestamp: new Date().toISOString(),
                passed,
                failures: passed ? 0 : 1,
                duration_ms: duration,
            },
            sourceDir
        );
    }

    if (!passed) {
        console.error(`❌ ${relativePath} failed with exit code ${result.status}`);
        return false;
    }

    console.log(`✅ ${relativePath} passed`);
    return true;
}

const allTestFiles = findTestFiles(baseDir);

if (allTestFiles.length === 0) {
    console.error('No test files found!');
    process.exit(1);
}

// Filter tests based on CLI args if provided
const args = process.argv.slice(2);
let testFiles: string[];

if (args.length > 0) {
    // Filter to only specified test files
    // In dist mode, map .ts extensions to .js
    const requestedTests = args.map(arg => {
        let mappedArg = arg;

        if (isDist) {
            // Map .ts extensions to .js in dist mode
            if (arg.endsWith('.test.ts')) {
                mappedArg = arg.replace(/\.test\.ts$/, '.test.js');
            } else if (arg.endsWith('.ts')) {
                mappedArg = arg.replace(/\.ts$/, '.js');
            } else {
                // No extension: assume test name, add .test.js
                mappedArg = `${arg}.test.js`;
            }
        } else {
            // TS mode: handle .test.ts, .ts, or bare name
            if (arg.endsWith('.test.ts')) {
                mappedArg = arg;
            } else if (arg.endsWith('.ts')) {
                mappedArg = arg;
            } else {
                // Assume it's a test name without extension
                mappedArg = `${arg}.test.ts`;
            }
        }

        return path.join(baseDir, mappedArg);
    });

    // Only include files that exist and are in the discovered test files
    testFiles = requestedTests.filter(file => {
        const exists = fs.existsSync(file);
        const isTestFile = allTestFiles.includes(file);
        return exists && isTestFile;
    });

    if (testFiles.length === 0) {
        console.error(`No matching test files found for: ${args.join(', ')}`);
        console.error(
            `Available test files: ${allTestFiles.map(f => path.basename(f)).join(', ')}`
        );
        process.exit(1);
    }
} else {
    // Run all discovered tests
    testFiles = allTestFiles;
}

// Main execution function (wrapped for async/await)
async function runAllTests(): Promise<void> {
    // Separate tests into cached (skip) and to-run
    const testsToRun: string[] = [];
    const skipped: string[] = [];

    for (const file of testFiles) {
        if (!skipCache && testCache.shouldSkipTest(file, sourceDir)) {
            skipped.push(file);
        } else {
            testsToRun.push(file);
        }
    }

    const total = testFiles.length;
    const startTime = Date.now();

    // Show skipped tests
    if (skipped.length > 0) {
        for (const file of skipped) {
            const relativePath = path.relative(process.cwd(), file);
            console.log(`⏭️  ${relativePath} - skipped (cached pass)`);
        }
    }

    if (testsToRun.length === 0) {
        console.log(`\n✅ All tests passed! (${skipped.length} cached, 0 run)`);
        process.exit(0);
    }

    console.log(
        `\nRunning ${testsToRun.length} test file(s)${useParallel ? ` in parallel (${maxWorkers} workers)` : ' sequentially'}...`
    );

    let failed = 0;
    let passed = 0;

    if (useParallel && testsToRun.length > 1) {
        // Parallel execution
        try {
            const results = await runTestsInParallel(testsToRun, {
                baseDir: process.cwd(),
                isDist,
                tsNodeRegister: tsNodeRegister || undefined,
                maxWorkers,
                memLimit: process.env.TEST_MAX_MEM || '256',
            });

            // Save results to cache and output
            for (const result of results) {
                const filePath =
                    testsToRun.find(f => path.basename(f) === result.file) || result.file;
                const relativePath = path.relative(process.cwd(), filePath);

                // Output test output
                if (result.stdout) process.stdout.write(result.stdout);
                if (result.stderr) process.stderr.write(result.stderr);

                // Save to cache
                if (!skipCache) {
                    testCache.saveResult(
                        {
                            file: result.file,
                            timestamp: new Date().toISOString(),
                            passed: result.passed,
                            failures: result.passed ? 0 : 1,
                            duration_ms: result.duration_ms,
                        },
                        sourceDir
                    );
                }

                if (result.passed) {
                    console.log(`✅ ${relativePath} passed (${result.duration_ms}ms)`);
                    passed++;
                } else {
                    console.error(`❌ ${relativePath} failed with exit code ${result.exitCode}`);
                    failed++;
                }
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`\n❌ Parallel execution failed: ${message}`);
            process.exit(1);
        }
    } else {
        // Sequential execution (fallback or single test)
        for (const file of testsToRun) {
            if (!runTest(file)) {
                failed++;
            } else {
                passed++;
            }
        }
    }

    const duration = Date.now() - startTime;

    // Update summary
    if (!skipCache) {
        testCache.updateSummary({
            timestamp: new Date().toISOString(),
            passed: failed === 0,
            total,
            failed,
            skipped: skipped.length,
            duration_ms: duration,
        });
    }

    if (skipped.length > 0) {
        console.log(`\n⏭️  ${skipped.length} test(s) skipped (cached)`);
    }

    if (failed > 0) {
        console.error(`\n❌ ${failed} test(s) failed.`);
        process.exit(1);
    }

    console.log(
        `\n✅ All tests passed! (${passed} run, ${skipped.length} cached) in ${(duration / 1000).toFixed(2)}s`
    );
    process.exit(0);
}

// Run tests
runAllTests().catch((err: unknown) => {
    const error = err as Error;
    console.error(`\n❌ Test runner failed: ${error.message}`);
    if (error.stack) console.error(error.stack);
    process.exit(1);
});
