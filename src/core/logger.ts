/**
 * Structured logging module for the Assistant CLI.
 * Supports JSON and human-readable output formats.
 * @module logger
 */

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

export interface LogEntry {
    ts: string;
    level: string;
    msg: string;
    correlationId?: string;
    agent?: string;
    tool?: string;
    durationMs?: number;
    [key: string]: unknown;
}

let currentLevel: LogLevel = LogLevel.INFO;

/**
 * Set the minimum log level for output.
 * @param level - The minimum log level to output.
 */
export function setLogLevel(level: LogLevel): void {
    currentLevel = level;
}

/**
 * Get the current log level.
 * @returns The current log level.
 */
export function getLogLevel(): LogLevel {
    return currentLevel;
}

/**
 * Generate a unique correlation ID for request tracing.
 */
export function generateCorrelationId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Log a message at the specified level.
 * @param level - The log level.
 * @param msg - The log message.
 * @param data - Optional additional data to log.
 */
export function log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (level < currentLevel) return;

    const entry: LogEntry = {
        ts: new Date().toISOString(),
        level: LogLevel[level],
        msg,
        ...data,
    };

    if (process.env.LOG_FORMAT === 'json') {
        console.log(JSON.stringify(entry));
    } else {
        const parts: string[] = [`[${entry.level}]`];

        if (data?.correlationId) {
            parts.push(`[${String(data.correlationId)}]`);
        }
        if (data?.agent) {
            parts.push(`[${String(data.agent)}]`);
        }
        if (data?.tool) {
            parts.push(`[${String(data.tool)}]`);
        }

        parts.push(msg);

        if (data?.durationMs !== undefined) {
            parts.push(`(${String(data.durationMs)}ms)`);
        }

        console.log(parts.join(' '));
    }
}

/**
 * Logger object with convenience methods for each log level.
 */
export const logger = {
    debug: (msg: string, data?: Record<string, unknown>): void => log(LogLevel.DEBUG, msg, data),
    info: (msg: string, data?: Record<string, unknown>): void => log(LogLevel.INFO, msg, data),
    warn: (msg: string, data?: Record<string, unknown>): void => log(LogLevel.WARN, msg, data),
    error: (msg: string, data?: Record<string, unknown>): void => log(LogLevel.ERROR, msg, data),
};

/**
 * Create a child logger with preset context (e.g., correlationId).
 * Useful for maintaining context across a request.
 */
export function createChildLogger(baseContext: Record<string, unknown>) {
    return {
        debug: (msg: string, data?: Record<string, unknown>): void =>
            log(LogLevel.DEBUG, msg, { ...baseContext, ...data }),
        info: (msg: string, data?: Record<string, unknown>): void =>
            log(LogLevel.INFO, msg, { ...baseContext, ...data }),
        warn: (msg: string, data?: Record<string, unknown>): void =>
            log(LogLevel.WARN, msg, { ...baseContext, ...data }),
        error: (msg: string, data?: Record<string, unknown>): void =>
            log(LogLevel.ERROR, msg, { ...baseContext, ...data }),
    };
}

/**
 * Initialize logger from environment variables.
 * Sets log level based on LOG_LEVEL env var (DEBUG, INFO, WARN, ERROR)
 */
export function initLogger(): void {
    const levelStr = process.env.LOG_LEVEL?.toUpperCase();
    if (levelStr && levelStr in LogLevel) {
        setLogLevel(LogLevel[levelStr as keyof typeof LogLevel]);
    }
}
