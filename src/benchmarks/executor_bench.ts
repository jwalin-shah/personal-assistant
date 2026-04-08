import * as fs from 'node:fs';
import * as path from 'node:path';
import { handleMemorySearch } from '../tools/memory_tools';
import { handleListFiles } from '../tools/file_tools';
import { nowMs } from '../core/debug';
import { ExecutorContext, MemoryEntry } from '../core/types';

const ITERATIONS = 100;
const BENCH_DIR = path.join(__dirname, 'bench_data');

if (!fs.existsSync(BENCH_DIR)) {
    fs.mkdirSync(BENCH_DIR);
}

// Setup dummy memory
const memoryPath = path.join(BENCH_DIR, 'memory.json');
const memoryData = {
    version: 1,
    entries: [] as MemoryEntry[],
};
for (let i = 0; i < 1000; i++) {
    memoryData.entries.push({ ts: '2026-01-01', text: `memory entry ${i} about benchmarking` });
}
fs.writeFileSync(memoryPath, JSON.stringify(memoryData));

// Setup dummy files
for (let i = 0; i < 100; i++) {
    fs.writeFileSync(path.join(BENCH_DIR, `file_${i}.txt`), 'content');
}

const context: ExecutorContext = {
    baseDir: BENCH_DIR,
    memoryLogPath: memoryPath,
    start: nowMs(),
    // Mocked helpers to match executor.ts implementation
    readJsonl: <T>(filePath: string, isValid: (entry: unknown) => boolean): T[] => {
        if (!fs.existsSync(filePath)) return [];
        const raw = fs.readFileSync(filePath, 'utf8');
        const lines = raw.split(/\r?\n/).filter(Boolean);
        const entries: T[] = [];
        for (const line of lines) {
            try {
                const parsed: unknown = JSON.parse(line);
                if (isValid(parsed)) entries.push(parsed as T);
            } catch {
                // ignore
            }
        }
        return entries;
    },

    scoreEntry: (entry: MemoryEntry, needle: string, _terms: string[]) => {
        const text = typeof entry.text === 'string' ? entry.text.toLowerCase() : '';
        let score = 0;
        if (needle) {
            let index = text.indexOf(needle);
            while (index !== -1) {
                score += 1;
                index = text.indexOf(needle, index + needle.length);
            }
        }
        return score;
    },

    sortByScoreAndRecency: (entries: MemoryEntry[], _needle: string) => {
        return entries; // Simplified sort for bench to avoid full re-impl
    },

    permissions: {
        allow_paths: [],
        allow_commands: [],
        require_confirmation_for: [],
        deny_tools: [],
        version: 1,
    },
    paths: {
        resolve: (p: string) => path.resolve(BENCH_DIR, p),
        assertAllowed: () => {},
        resolveAllowed: (p: string) => path.resolve(BENCH_DIR, p),
    },
    commands: {
        runAllowed: () => ({ ok: true, result: '' }),
    },
    requiresConfirmation: () => false,

    // Additional required fields
    memoryPath: memoryPath,
    memoryLimit: null,
    tasksPath: path.join(BENCH_DIR, 'tasks.json'),
    remindersPath: path.join(BENCH_DIR, 'reminders.json'),
    emailsPath: path.join(BENCH_DIR, 'emails.json'),
    messagesPath: path.join(BENCH_DIR, 'messages.json'),
    contactsPath: path.join(BENCH_DIR, 'contacts.json'),
    calendarPath: path.join(BENCH_DIR, 'calendar.json'),
    permissionsPath: path.join(BENCH_DIR, 'permissions.json'),
    auditPath: path.join(BENCH_DIR, 'audit.log'),
    auditEnabled: false,
    limits: {
        maxReadSize: 1024 * 1024,
        maxWriteSize: 1024 * 1024,
    },
    readMemory: () => ({ entries: [] }),
    writeMemory: () => {},
    writeJsonl: () => {},
    appendJsonl: () => {},
    agent: undefined,
};

async function benchAsync(name: string, fn: () => Promise<void>) {
    const start = nowMs();
    for (let i = 0; i < ITERATIONS; i++) {
        await fn();
    }
    const end = nowMs();
    const duration = end - start;
    console.log(
        `${name}: ${duration.toFixed(2)}ms total, ${(duration / ITERATIONS).toFixed(4)}ms/op`
    );
}

(async () => {
    console.log(`Running executor benchmarks (${ITERATIONS} iterations)...`);

    await benchAsync('Memory Search (1k entries, File I/O)', async () => {
        // handleMemorySearch(null, toolCall, permissions, context)
        await handleMemorySearch({ query: 'benchmarking' }, context);
    });

    await benchAsync('List Files (100 files)', async () => {
        // handleListFiles(args, context)
        await handleListFiles({}, context);
    });

    // Cleanup
    fs.rmSync(BENCH_DIR, { recursive: true, force: true });
})();
