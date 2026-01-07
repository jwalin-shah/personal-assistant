#!/usr/bin/env node

/**
 * Generate test cases for an existing tool based on its schema.
 *
 * Usage:
 *   npm run build && node dist/scripts/generate_tests.js my_tool
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

function findToolFile(toolName: string): string | null {
    // Use src/ not dist/ - resolve from project root
    const projectRoot = path.resolve(__dirname, '..', '..');
    const toolsDir = path.join(projectRoot, 'src', 'tools');
    const possibleFiles = [
        path.join(toolsDir, `${toolName}_tools.ts`),
        path.join(toolsDir, `${toolName}.ts`),
    ];

    for (const file of possibleFiles) {
        if (fs.existsSync(file)) {
            return file;
        }
    }

    return null;
}

function extractHandlerFromFile(
    filePath: string
): { handlerName: string; importPath: string; hasContext: boolean } | null {
    const content = fs.readFileSync(filePath, 'utf8');

    // Find exported handler function
    // Match: export function handleXxx(args: XxxArgs, context?: ExecutorContext)
    const handlerMatch = content.match(/export function (handle\w+)\([^)]*\)/);
    if (!handlerMatch) return null;

    const handlerName = handlerMatch[1];

    // Check if handler takes context parameter
    const hasContext =
        content.includes(`${handlerName}(args:`) && content.includes('context: ExecutorContext');

    // Determine import path - use file name without _tools suffix if present
    const fileName = path.basename(filePath, '.ts');
    const importPath = fileName.endsWith('_tools') ? fileName : fileName;

    return { handlerName, importPath, hasContext };
}

interface SchemaArg {
    name: string;
    type: string;
    required: boolean;
}

function extractSchemaFromFile(filePath: string): { schemaName: string; args: SchemaArg[] } | null {
    const content = fs.readFileSync(filePath, 'utf8');

    // Try to find schema definition in the file first
    const schemaMatch = content.match(/export const (\w+Schema) = z\.object\(\{([^}]+)\}\)/s);
    let schemaName: string | null = null;
    let schemaBody: string | null = null;

    if (schemaMatch) {
        schemaName = schemaMatch[1];
        schemaBody = schemaMatch[2];
    } else {
        // Try to find schema import and extract from types.ts
        // Match: import { ToolResult, ReadUrlArgs, GitStatusArgs } from '../core/types'
        // Find all Args types in imports
        const argsTypeMatches = content.matchAll(/(\w+Args)/g);
        const argsTypes: string[] = [];
        for (const match of argsTypeMatches) {
            if (match[1] && match[1].endsWith('Args')) {
                argsTypes.push(match[1]);
            }
        }

        // Try each Args type until we find a valid schema
        const projectRoot = path.resolve(__dirname, '..', '..');
        const typesFile = path.join(projectRoot, 'src', 'core', 'types.ts');

        if (argsTypes.length > 0 && fs.existsSync(typesFile)) {
            const typesContent = fs.readFileSync(typesFile, 'utf8');

            for (const argsTypeName of argsTypes) {
                // Convert Args to Schema (e.g., ReadUrlArgs -> ReadUrlSchema)
                const schemaTypeName = argsTypeName.replace(/Args$/, 'Schema');

                // Match schema - handle optional() and multiline
                // Try: z.object({...}) or z.object({...}).optional()
                let typesSchemaMatch = typesContent.match(
                    new RegExp(
                        `export const ${schemaTypeName}\\s*=\\s*z\\.object\\(\\{([\\s\\S]*?)\\}\\)`,
                        'm'
                    )
                );

                // If not found, try with .optional()
                if (!typesSchemaMatch) {
                    typesSchemaMatch = typesContent.match(
                        new RegExp(
                            `export const ${schemaTypeName}\\s*=\\s*z\\.object\\(\\{([\\s\\S]*?)\\}\\)\\.optional\\(\\)`,
                            'm'
                        )
                    );
                }

                if (typesSchemaMatch && typesSchemaMatch[1]) {
                    schemaName = schemaTypeName;
                    schemaBody = typesSchemaMatch[1];
                    break; // Use first valid schema found
                }
            }
        }
    }

    if (!schemaName || !schemaBody) return null;

    // Parse arguments from schema
    const args: Array<{ name: string; type: string; required: boolean }> = [];
    const lines = schemaBody.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//')) continue;

        // Match: field: z.string() or field: z.string().url() or field: z.string().optional()
        // Handle chained methods like .url(), .min(), etc.
        const match = trimmed.match(/(\w+):\s*z\.(\w+)\(\)(?:\.\w+\([^)]*\))*(\.optional\(\))?/);
        if (match) {
            args.push({
                name: match[1],
                type: match[2],
                required: !match[3], // optional() makes it not required
            });
        }
    }

    return { schemaName, args };
}

function matchHandlerToSchema(
    filePath: string,
    handlerName: string,
    defaultSchema: { schemaName: string; args: SchemaArg[] }
): { schemaName: string; args: SchemaArg[] } {
    // Extract handler name pattern: handleGitStatus -> GitStatus
    const handlerPattern = handlerName.replace(/^handle/, '');

    // Try to find matching Args type in function signature: handleGitStatus(args: GitStatusArgs)
    const content = fs.readFileSync(filePath, 'utf8');
    // Match: export function handleGitStatus(args: GitStatusArgs, context: ExecutorContext)
    const funcSignatureMatch = content.match(
        new RegExp(`export function ${handlerName}\\([^,)]+:\\s*(\\w+Args)`, 'm')
    );

    let argsTypeName: string | null = null;
    if (funcSignatureMatch && funcSignatureMatch[1]) {
        argsTypeName = funcSignatureMatch[1];
    } else {
        // Fallback: try to match pattern GitStatus -> GitStatusArgs
        const argsTypeMatch = content.match(new RegExp(`(\\w*${handlerPattern}Args)`, 'i'));
        if (argsTypeMatch && argsTypeMatch[1]) {
            argsTypeName = argsTypeMatch[1];
        }
    }

    if (argsTypeName) {
        const schemaTypeName = argsTypeName.replace(/Args$/, 'Schema');

        // Extract schema from types.ts
        const projectRoot = path.resolve(__dirname, '..', '..');
        const typesFile = path.join(projectRoot, 'src', 'core', 'types.ts');

        if (fs.existsSync(typesFile)) {
            const typesContent = fs.readFileSync(typesFile, 'utf8');

            // Try to find schema - check optional() version first since some schemas are optional
            let typesSchemaMatch = typesContent.match(
                new RegExp(
                    `export const ${schemaTypeName}\\s*=\\s*z\\.object\\(\\{([\\s\\S]*?)\\}\\)\\.optional\\(\\)`,
                    'm'
                )
            );

            if (!typesSchemaMatch) {
                typesSchemaMatch = typesContent.match(
                    new RegExp(
                        `export const ${schemaTypeName}\\s*=\\s*z\\.object\\(\\{([\\s\\S]*?)\\}\\)`,
                        'm'
                    )
                );
            }

            // Check if schema was found (even if empty - empty string is valid for empty schemas)
            if (typesSchemaMatch && typesSchemaMatch[1] !== undefined) {
                const schemaBody = typesSchemaMatch[1];
                const args: Array<{ name: string; type: string; required: boolean }> = [];

                // Only parse if schema body has content (not empty)
                if (schemaBody.trim().length > 0) {
                    const lines = schemaBody.split('\n');

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed.startsWith('//')) continue;

                        const match = trimmed.match(
                            /(\w+):\s*z\.(\w+)\(\)(?:\.\w+\([^)]*\))*(\.optional\(\))?/
                        );
                        if (match) {
                            args.push({
                                name: match[1],
                                type: match[2],
                                required: !match[3],
                            });
                        }
                    }
                }

                // Return schema even if empty (some handlers take empty args)
                // This ensures we use the handler's own schema, not a fallback
                return { schemaName: schemaTypeName, args };
            }
        }
    }

    // Fallback to default schema
    return defaultSchema;
}

function generateTestCases(handlerName: string, args: SchemaArg[], hasContext: boolean): string {
    const requiredArgs = args.filter(a => a.required);
    const _optionalArgs = args.filter(a => !a.required);

    const successArgs: Record<string, unknown> = {};
    for (const arg of args) {
        switch (arg.type) {
            case 'string':
                // Use better default for URL fields
                successArgs[arg.name] = arg.name === 'url' ? 'https://example.com' : 'test';
                break;
            case 'number':
            case 'integer':
                successArgs[arg.name] = 42;
                break;
            case 'boolean':
                successArgs[arg.name] = true;
                break;
        }
    }

    const testCases: string[] = [];
    const contextParam = hasContext ? ', mockContext' : '';
    const successArgsJson = args.length > 0 ? JSON.stringify(successArgs) : '{}';

    // Success case
    testCases.push(`    // Test 1: Success case
    try {
        const result = ${handlerName}(${successArgsJson}${contextParam});
        assert.equal(result.ok, true, 'Should succeed with valid args');
        assert.ok(result.result, 'Should return result');
        console.log('PASS: Success case');
    } catch (e: unknown) {
        const err = e as Error;
        console.error('FAIL: Success case', err.message);
        failures++;
    }`);

    // Missing required args (only if there are args)
    if (args.length > 0) {
        for (const arg of requiredArgs) {
            testCases.push(`    // Test: Missing required arg '${arg.name}'
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const args: any = { ...${successArgsJson} };
        delete args.${arg.name};
        const result = ${handlerName}(args${contextParam});
        assert.equal(result.ok, false, 'Should fail without ${arg.name}');
        assert.ok(result.error?.code === 'MISSING_ARGUMENT' || result.error?.code === 'VALIDATION_ERROR');
        console.log('PASS: Missing required arg ${arg.name}');
    } catch (e: unknown) {
        const err = e as Error;
        console.error('FAIL: Missing required arg ${arg.name}', err.message);
        failures++;
    }`);
        }
    }

    // Invalid types (only if there are args)
    if (args.length > 0) {
        for (const arg of args) {
            if (arg.type === 'string') {
                testCases.push(`    // Test: Invalid type for '${arg.name}' (number instead of string)
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const args: any = { ...${successArgsJson} };
        args.${arg.name} = 123; // Wrong type
        const result = ${handlerName}(args${contextParam});
        assert.equal(result.ok, false, 'Should fail with invalid type');
        assert.ok(result.error?.code === 'VALIDATION_ERROR' || result.error?.code === 'INVALID_ARGUMENT');
        console.log('PASS: Invalid type for ${arg.name}');
    } catch (e: unknown) {
        const err = e as Error;
        console.error('FAIL: Invalid type for ${arg.name}', err.message);
        failures++;
    }`);
            }
        }
    }

    // Empty string for required strings (only if there are args)
    if (args.length > 0) {
        for (const arg of requiredArgs) {
            if (arg.type === 'string') {
                testCases.push(`    // Test: Empty string for required '${arg.name}'
    try {
        const args = { ...${successArgsJson}, ${arg.name}: '' };
        const result = ${handlerName}(args${contextParam});
        assert.equal(result.ok, false, 'Should fail with empty string');
        console.log('PASS: Empty string for ${arg.name}');
    } catch (e: unknown) {
        const err = e as Error;
        console.error('FAIL: Empty string for ${arg.name}', err.message);
        failures++;
    }`);
            }
        }
    }

    return testCases.join('\n\n');
}

function generateTestFile(
    toolName: string,
    handlerName: string,
    importPath: string,
    testCases: string,
    hasContext: boolean
): string {
    const contextImport = hasContext ? `import { ExecutorContext } from '../core/types';\n\n` : '';
    const contextMock = hasContext
        ? `// Simple mock context
const mockContext: ExecutorContext = {
    paths: {
        resolve: (p: string) => p,
        assertAllowed: () => {},
        resolveAllowed: (p: string) => p,
    },
    commands: {
        runAllowed: () => ({ ok: true, result: '' }),
    },
    readJsonl: () => [],
    appendJsonl: () => {},
    readMemory: () => ({ entries: [] }),
    writeMemory: () => {},
    memoryPath: '/tmp/memory.json',
    tasksPath: '/tmp/tasks.jsonl',
    memoryLogPath: '/tmp/memory.jsonl',
    remindersPath: '/tmp/reminders.jsonl',
    emailsPath: '/tmp/emails.jsonl',
    messagesPath: '/tmp/messages.jsonl',
    contactsPath: '/tmp/contacts.jsonl',
    calendarPath: '/tmp/calendar.jsonl',
    permissionsPath: '/tmp/permissions.json',
    auditPath: '/tmp/audit.jsonl',
    memoryLimit: 1000,
    scoreEntry: () => 0,
    sortByScoreAndRecency: () => [],
    limits: {
        maxReadSize: 65536,
        maxWriteSize: 65536,
    },
    permissions: {
        allow_paths: [],
        allow_commands: [],
        require_confirmation_for: [],
        deny_tools: [],
    },
    start: Date.now(),
} as unknown as ExecutorContext;

`
        : '';

    return `import { strict as assert } from 'assert';
import { ${handlerName} } from './${importPath}';
${contextImport}${contextMock}function runTests() {

    console.log('Running ${toolName} tests...');
    let failures = 0;

${testCases}

    if (failures > 0) {
        console.error(\`\\n\${failures} test(s) failed\`);
        process.exit(1);
    }

    console.log('RESULT\\nstatus: OK\\n');
}

runTests();
export { };
`;
}

function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        console.log(
            `
Generate test cases for an existing tool based on its schema.

Usage:
  node dist/scripts/generate_tests.js <tool_name>

Examples:
  node dist/scripts/generate_tests.js my_tool
  node dist/scripts/generate_tests.js memory_add
        `.trim()
        );
        process.exit(0);
    }

    const toolName = args[0];
    const toolFile = findToolFile(toolName);

    if (!toolFile) {
        console.error(`Error: Tool file not found for ${toolName}`);
        console.error(`Searched in: src/tools/${toolName}_tools.ts, src/tools/${toolName}.ts`);
        process.exit(1);
    }

    console.log(`Found tool file: ${toolFile}`);

    const schemaInfo = extractSchemaFromFile(toolFile);
    if (!schemaInfo) {
        console.error(`Error: Could not extract schema from ${toolFile}`);
        console.error('Make sure the file contains a Zod schema definition');
        process.exit(1);
    }

    // Extract actual handler function name and import path from file
    const handlerInfo = extractHandlerFromFile(toolFile);
    if (!handlerInfo) {
        console.error(`Error: Could not find handler function in ${toolFile}`);
        process.exit(1);
    }

    const { handlerName, importPath, hasContext } = handlerInfo;
    console.log(`Found handler: ${handlerName} (import from './${importPath}')`);

    // Try to match handler to correct schema
    // e.g., handleGitStatus -> GitStatusArgs -> GitStatusSchema
    const handlerSchemaInfo = matchHandlerToSchema(toolFile, handlerName, schemaInfo);

    console.log(`Found schema: ${handlerSchemaInfo.schemaName}`);
    if (handlerSchemaInfo.args.length > 0) {
        console.log(
            `Arguments: ${handlerSchemaInfo.args.map(a => `${a.name}:${a.type}${a.required ? '' : '?'}`).join(', ')}`
        );
    } else {
        console.log(`Arguments: (empty - handler takes no arguments)`);
    }

    const testCases = generateTestCases(handlerName, handlerSchemaInfo.args, hasContext);
    const testContent = generateTestFile(toolName, handlerName, importPath, testCases, hasContext);

    const projectRoot = path.resolve(__dirname, '..', '..');
    const testFile = path.join(projectRoot, 'src', 'tools', `${toolName}_tools.test.ts`);
    fs.writeFileSync(testFile, testContent);

    console.log(`✓ Generated test file: ${testFile}`);
    console.log(
        `\nRun tests with: npm run build && TEST_DIST=1 node dist/tools/${toolName}_tools.test.js`
    );
}

if (require.main === module) {
    main();
}

export {};
