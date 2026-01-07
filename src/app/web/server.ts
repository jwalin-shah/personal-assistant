/**
 * Web Dashboard Server
 *
 * A minimal Express-like HTTP server for the Assistant dashboard.
 * Uses Node.js built-in http module to avoid external dependencies.
 *
 * @module web/server
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { Executor } from '../../core';
import { initializeRuntime } from '../../runtime';

export interface WebServerConfig {
    port: number;
    baseDir: string;
}

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

export function startWebServer(config: WebServerConfig): void {
    const { port } = config;
    // Note: baseDir from config could be used for API path sandboxing in future

    // Build runtime via composition root
    const runtime = initializeRuntime();
    const executor = runtime.executor;
    const webDir = path.join(__dirname);

    const server = http.createServer(async (req, res) => {
        const parsedUrl = url.parse(req.url || '/', true);
        const pathname = parsedUrl.pathname || '/';

        // CORS headers for API
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // API Routes
        if (pathname.startsWith('/api/')) {
            return handleAPI(req, res, pathname, executor);
        }

        // Static file serving
        // Security: Prevent path traversal attacks
        let filePath = pathname === '/' ? '/index.html' : pathname;

        // Normalize and resolve to prevent path traversal
        const normalizedPath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
        const resolvedPath = path.resolve(webDir, normalizedPath);

        // Ensure resolved path is within webDir (prevent directory traversal)
        if (!resolvedPath.startsWith(path.resolve(webDir))) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        filePath = resolvedPath;

        const ext = path.extname(filePath);
        const contentType = MIME_TYPES[ext] || 'text/plain';

        try {
            if (!fs.existsSync(filePath)) {
                res.writeHead(404);
                res.end('Not Found');
                return;
            }

            const content = fs.readFileSync(filePath);
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        } catch {
            res.writeHead(500);
            res.end('Server Error');
        }
    });

    server.listen(port, () => {
        console.log(`\n🌐 Assistant Dashboard running at http://localhost:${port}\n`);
        console.log('   Press Ctrl+C to stop\n');
    });
}

async function handleAPI(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    executor: Executor
): Promise<void> {
    res.setHeader('Content-Type', 'application/json');

    // Parse body for POST requests
    let body: Record<string, unknown> = {};
    if (req.method === 'POST') {
        body = await parseBody(req);
    }

    try {
        let result: unknown;

        switch (pathname) {
            case '/api/tasks':
                if (req.method === 'GET') {
                    result = await executor.execute('task_list', {});
                } else if (req.method === 'POST') {
                    result = await executor.execute('task_add', body as Record<string, unknown>);
                }
                break;

            case '/api/tasks/done':
                result = await executor.execute('task_done', body as Record<string, unknown>);
                break;

            case '/api/memory':
                if (req.method === 'GET') {
                    const query = (url.parse(req.url || '', true).query.q as string) || '';
                    result = await executor.execute('recall', { query });
                } else if (req.method === 'POST') {
                    result = await executor.execute('remember', body as Record<string, unknown>);
                }
                break;

            case '/api/health':
                result = {
                    ok: true,
                    result: { status: 'healthy', timestamp: new Date().toISOString() },
                };
                break;

            default:
                res.writeHead(404);
                res.end(JSON.stringify({ ok: false, error: 'Unknown API endpoint' }));
                return;
        }

        res.writeHead(200);
        res.end(JSON.stringify(result));
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: message }));
    }
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise(resolve => {
        let data = '';
        req.on('data', chunk => (data += chunk));
        req.on('end', () => {
            try {
                resolve(JSON.parse(data));
            } catch {
                resolve({});
            }
        });
    });
}
