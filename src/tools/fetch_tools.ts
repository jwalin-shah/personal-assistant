import { ToolResult, ReadUrlArgs, ExecutorContext } from '../core/types';
import { makeError, ErrorCode } from '../core/tool_contract';
import * as dns from 'node:dns/promises';

/**
 * Check if an IP address is private or loopback.
 */
function isPrivateIP(ip: string): boolean {
    // IPv4 checks
    if (ip.includes('.')) {
        const parts = ip.split('.').map(Number);
        if (parts.length !== 4) return false; // Invalid IPv4

        // 127.0.0.0/8 (Loopback)
        if (parts[0] === 127) return true;
        // 10.0.0.0/8 (Private)
        if (parts[0] === 10) return true;
        // 172.16.0.0/12 (Private)
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
        // 192.168.0.0/16 (Private)
        if (parts[0] === 192 && parts[1] === 168) return true;
        // 169.254.0.0/16 (Link-local)
        if (parts[0] === 169 && parts[1] === 254) return true;

        return false;
    }

    // IPv6 checks
    // ::1 (Loopback)
    if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
    // fe80::/10 (Link-local)
    if (ip.toLowerCase().startsWith('fe80:')) return true;
    // fc00::/7 (Unique Local)
    // fc00 - fdff
    const firstGroup = parseInt(ip.split(':')[0], 16);
    if (firstGroup >= 0xfc00 && firstGroup <= 0xfdff) return true;

    return false;
}

/**
 * Handle reading content from a URL using native fetch.
 * Includes SSRF protection to block localhost and private IP ranges.
 */
export async function handleReadUrl(
    args: ReadUrlArgs,
    _context: ExecutorContext
): Promise<ToolResult> {
    const { url } = args;

    // Security: Block file:// and only allow http/https
    let urlObj: URL;
    try {
        urlObj = new URL(url);
        const allowedSchemes = ['http:', 'https:'];
        if (!allowedSchemes.includes(urlObj.protocol)) {
            return {
                ok: false,
                error: makeError(
                    ErrorCode.VALIDATION_ERROR,
                    `URL scheme '${urlObj.protocol}' is not allowed. Only http:// and https:// are permitted.`
                ),
            };
        }
    } catch (err: unknown) {
        return {
            ok: false,
            error: makeError(
                ErrorCode.VALIDATION_ERROR,
                `Invalid URL format: ${err instanceof Error ? err.message : String(err)}`
            ),
        };
    }

    // SSRF Protection: Resolve DNS and check IP
    try {
        const { address } = await dns.lookup(urlObj.hostname);
        if (isPrivateIP(address)) {
            return {
                ok: false,
                error: makeError(
                    ErrorCode.VALIDATION_ERROR,
                    `Access to private/loopback IP ${address} is not allowed (SSRF protection)`
                ),
            };
        }
    } catch (err: unknown) {
        return {
            ok: false,
            error: makeError(
                ErrorCode.EXEC_ERROR,
                `DNS resolution failed for ${urlObj.hostname}: ${err instanceof Error ? err.message : String(err)}`
            ),
        };
    }

    try {
        // Use native fetch with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000); // 6 second timeout

        let response: Response;
        try {
            response = await fetch(url, {
                signal: controller.signal,
                redirect: 'follow',
                headers: {
                    'User-Agent': 'PersonalAssistant/1.0',
                },
            });
            clearTimeout(timeoutId);
        } catch (err: unknown) {
            clearTimeout(timeoutId);
            const message = err instanceof Error ? err.message : 'Unknown network error';
            return {
                ok: false,
                error: makeError(ErrorCode.EXEC_ERROR, `Failed to fetch URL: ${message}`),
            };
        }

        if (!response.ok) {
            return {
                ok: false,
                error: makeError(
                    ErrorCode.EXEC_ERROR,
                    `HTTP ${response.status}: ${response.statusText}`
                ),
            };
        }

        // Limit response size to 10MB
        const MAX_SIZE = 10 * 1024 * 1024;
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > MAX_SIZE) {
            return {
                ok: false,
                error: makeError(ErrorCode.EXEC_ERROR, 'Response too large (max 10MB)'),
            };
        }

        const html = await response.text();

        // Basic HTML stripping to get text content
        // Security: Improved regex to handle edge cases (spaces, case variations)
        const text = html
            // Remove scripts and styles first (handle spaces and case variations)
            .replace(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gim, '')
            .replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gim, '')
            // Replace <br>, <p>, <div> endings with newlines to preserve some structure
            .replace(/<br\s*\/?>/gim, '\n')
            .replace(/<\/p>/gim, '\n')
            .replace(/<\/div>/gim, '\n')
            // Remove remaining tags
            .replace(/<[^>]+>/g, ' ')
            // Normalize whitespace (collapse multiple spaces/newlines)
            .replace(/\s+/g, ' ')
            .trim();

        // Limit the output size
        const MAX_LENGTH = 8000;
        const truncated =
            text.length > MAX_LENGTH ? text.substring(0, MAX_LENGTH) + '...[truncated]' : text;

        return {
            ok: true,
            result: {
                url,
                content: truncated,
                length: text.length,
            },
        };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            error: makeError(ErrorCode.EXEC_ERROR, `System error: ${message}`),
        };
    }
}
