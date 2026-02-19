#!/usr/bin/env node

/**
 * Generate a new tool with schema, handler, registration, and tests.
 *
 * Usage:
 *   npm run build && node dist/scripts/generate_tool.js my_tool --args text:string,limit:number:optional
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

interface ArgDef {
    name: string;
    type: 'string' | 'number' | 'integer' | 'boolean';
    required: boolean;
    description: string;
}

function parseArgs(argsStr: string): ArgDef[] {
    if (!argsStr) return [];

    return argsStr.split(',').map(arg => {
        const parts = arg.trim().split(':');
        const name = parts[0];
        const typeStr = parts[1] || 'string';
        const isOptional = typeStr.includes('optional');
        const type = typeStr.replace(':optional', '') as ArgDef['type'];

        return {
            name,
            type:
                type === 'integer'
                    ? 'integer'
                    : type === 'number'
                      ? 'number'
                      : type === 'boolean'
                        ? 'boolean'
                        : 'string',
            required: !isOptional,
            description: `The ${name} parameter`,
        };
    });
}

function toPascalCase(str: string): string {
    return str
        .split('_')
        .map(s => s.charAt(0).toUpperCase() + s.slice(1))
        .join('');
}

function _toCamelCase(str: string): string {
    const parts = str.split('_');
    return (
        parts[0] +
        parts
            .slice(1)
            .map(s => s.charAt(0).toUpperCase() + s.slice(1))
            .join('')
    );
}

function generateSchema(toolName: string, args: ArgDef[]): string {
    const schemaName = `${toPascalCase(toolName)}Schema`;
    const typeName = `${toPascalCase(toolName)}Args`;

    const zodImports = new Set<string>();
    const shape: string[] = [];

    for (const arg of args) {
        let zodType = '';
        switch (arg.type) {
            case 'string':
                zodType = 'z.string()';
                zodImports.add('string');
                break;
            case 'number':
                zodType = 'z.number()';
                zodImports.add('number');
                break;
            case 'integer':
                zodType = 'z.number().int()';
                zodImports.add('number');
                break;
            case 'boolean':
                zodType = 'z.boolean()';
                zodImports.add('boolean');
                break;
        }

        if (arg.required) {
            shape.push(`    ${arg.name}: ${zodType},`);
        } else {
            shape.push(`    ${arg.name}: ${zodType}.optional(),`);
        }
    }

    return `export const ${schemaName} = z.object({
${shape.join('\n')}
});

export type ${typeName} = z.infer<typeof ${schemaName}>;
`;
}

function generateHandler(toolName: string, args: ArgDef[]): string {
    const handlerName = `handle${toPascalCase(toolName)}`;
    const typeName = `${toPascalCase(toolName)}Args`;
    const argsList = args.map(a => a.name).join(', ');

    return `/**
 * Handle ${toolName} tool.
 * @param args - Tool arguments.
 * @param context - Execution context.
 * @returns Result object with ok, result, error, debug.
 */
export function ${handlerName}(args: ${typeName}, context: ExecutorContext): ToolResult {
    const { start } = context;
    
    // IMPLEMENTATION REQUIRED: Replace this placeholder with actual tool logic
    // Access validated args: ${argsList || 'none'}
    // Use context.paths, context.commands, context.readMemory, etc. as needed
    const result = {
        // IMPLEMENTATION REQUIRED: Return the actual result data here
        success: true,
    };
    
    return {
        ok: true,
        result,
        error: null,
        _debug: makeDebug({
            path: 'tool_json',
            start,
            model: null,
            memory_read: false,
            memory_write: false,
        }),
    };
}
`;
}

function generateToolSpec(toolName: string, args: ArgDef[]): string {
    // Single-pass filter to extract required argument names
    const required: string[] = [];
    for (const arg of args) {
        if (arg.required) {
            required.push(arg.name);
        }
    }
    const parameters: string[] = [];

    for (const arg of args) {
        parameters.push(`        ${arg.name}: {
            type: '${arg.type}',
            description: '${arg.description}',
        },`);
    }

    return `export const ${toolName.toUpperCase()}_TOOL_SPEC: ToolSpec = {
    status: 'ready',
    description: 'IMPLEMENTATION REQUIRED: Add description for ${toolName}',
    required: ${JSON.stringify(required)},
    parameters: {
${parameters.join('\n')}
    },
};
`;
}

function generateTest(toolName: string, args: ArgDef[]): string {
    const handlerName = `handle${toPascalCase(toolName)}`;
    const typeName = `${toPascalCase(toolName)}Args`;
    const requiredArgs = args.filter(a => a.required);
    const _optionalArgs = args.filter(a => !a.required);

    const successArgs: Record<string, unknown> = {};
    for (const arg of args) {
        switch (arg.type) {
            case 'string':
                successArgs[arg.name] = 'test';
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

    return `import { strict as assert } from 'assert';
import { ${handlerName}, ${typeName} } from './${toolName}_tools';
import { ExecutorContext } from '../core/types';

// Simple mock context
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

function runTests() {
    console.log('Running ${toolName} tests...');
    let failures = 0;

    // Test 1: Success case
    try {
        const result = ${handlerName}(${JSON.stringify(successArgs)}, mockContext);
        assert.equal(result.ok, true, 'Should succeed with valid args');
        assert.ok(result.result, 'Should return result');
        console.log('PASS: Success case');
    } catch (e: unknown) {
        const err = e as Error;
        console.error('FAIL: Success case', err.message);
        failures++;
    }

${requiredArgs
    .map(
        arg => `    // Test: Missing required arg '${arg.name}'
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const args: any = { ...${JSON.stringify(successArgs)} };
        delete args.${arg.name};
        const result = ${handlerName}(args, mockContext);
        assert.equal(result.ok, false, 'Should fail without ${arg.name}');
        assert.ok(result.error?.code === 'MISSING_ARGUMENT' || result.error?.code === 'VALIDATION_ERROR');
        console.log('PASS: Missing required arg ${arg.name}');
    } catch (e: unknown) {
        const err = e as Error;
        console.error('FAIL: Missing required arg ${arg.name}', err.message);
        failures++;
    }
`
    )
    .join('\n')}

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
Generate a new tool with schema, handler, registration, and tests.

Usage:
  node dist/scripts/generate_tool.js <tool_name> [--args <args>]

Arguments:
  tool_name  - Name of the tool (snake_case, e.g., my_tool)
  --args     - Comma-separated list of arguments (e.g., text:string,limit:number:optional)

Examples:
  node dist/scripts/generate_tool.js my_tool --args text:string
  node dist/scripts/generate_tool.js search_tool --args query:string,limit:number:optional
        `.trim()
        );
        process.exit(0);
    }

    const toolName = args[0];
    const argsIndex = args.indexOf('--args');
    const argsStr = argsIndex >= 0 && argsIndex < args.length - 1 ? args[argsIndex + 1] : '';

    const argDefs = parseArgs(argsStr);

    console.log(`Generating tool: ${toolName}`);
    console.log(
        `Arguments: ${argDefs.map(a => `${a.name}:${a.type}${a.required ? '' : ':optional'}`).join(', ') || 'none'}`
    );

    // Determine which tools file to use (use src/ not dist/)
    const projectRoot = path.resolve(__dirname, '..', '..');
    const toolsDir = path.join(projectRoot, 'src', 'tools');
    const toolsFile = path.join(toolsDir, `${toolName}_tools.ts`);
    const testFile = path.join(toolsDir, `${toolName}_tools.test.ts`);
    const _typesFile = path.join(projectRoot, 'src', 'core', 'types.ts');

    // Generate schema (to add to types.ts)
    const schema = generateSchema(toolName, argDefs);
    const toolSpec = generateToolSpec(toolName, argDefs);
    const handler = generateHandler(toolName, argDefs);
    const test = generateTest(toolName, argDefs);

    // Write handler file
    const handlerContent = `/**
 * ${toolName} tool handler.
 * @module tools/${toolName}_tools
 */

import { z } from 'zod';
import { makeError } from '../core/tool_contract';
import { makeDebug } from '../core/debug';
import {
    ExecutorContext,
    ToolResult,
    ToolSpec,
} from '../core/types';

${schema}

${toolSpec}

${handler}
`;

    fs.writeFileSync(toolsFile, handlerContent);
    console.log(`✓ Created ${toolsFile}`);

    // Write test file
    fs.writeFileSync(testFile, test);
    console.log(`✓ Created ${testFile}`);

    // Instructions for manual steps
    console.log(
        `
✓ Tool files generated!

Next steps (manual):
1. Add schema to src/core/types.ts:
${schema
    .split('\n')
    .map(l => '   ' + l)
    .join('\n')}

2. Add handler import to src/core/tool_registry.ts:
   import { handle${toPascalCase(toolName)} } from '../tools/${toolName}_tools';

3. Add to TOOL_HANDLERS in src/core/tool_registry.ts:
   ${toolName}: handle${toPascalCase(toolName)},

4. Add to ToolSchemas in src/core/types.ts:
   ${toolName}: ${toPascalCase(toolName)}Schema,

5. Add tool to appropriate agent in src/agents/index.ts

6. Implement the handler logic in ${toolsFile}

7. Run tests: npm run build && TEST_DIST=1 node dist/tools/${toolName}_tools.test.js
    `.trim()
    );
}

if (require.main === module) {
    main();
}

export {};
