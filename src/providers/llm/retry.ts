/**
 * Retry utility with exponential backoff.
 *
 * Provides a wrapper for async operations that automatically retries
 * on transient failures (429, 5xx errors).
 *
 * @module llm/retry
 */

export interface RetryOptions {
    /** Maximum number of retry attempts. Default: 3 */
    maxRetries?: number;
    /** Base delay in milliseconds. Default: 1000 */
    baseDelayMs?: number;
    /** Maximum delay in milliseconds. Default: 30000 */
    maxDelayMs?: number;
    /** Custom function to determine if error is retryable. Default: 429 and 5xx */
    retryOn?: (error: unknown) => boolean;
    /** Called before each retry with attempt number and delay. */
    onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'retryOn'>> = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
};

/**
 * Check if an error is retryable based on HTTP status codes.
 */
export function isRetryableError(error: unknown): boolean {
    if (!error) return false;

    // Check for status code in error or response
    const err = error as {
        status?: number | string;
        statusCode?: number | string;
        response?: { status?: number | string };
        message?: string;
    };
    const status = err.status || err.statusCode || err.response?.status;

    if (status) {
        // Retry on 429 (rate limit) and 5xx (server errors)
        const s = Number(status);
        return s === 429 || (s >= 500 && s < 600);
    }

    // Retry on network errors
    const message = err.message?.toLowerCase() || '';
    return (
        message.includes('econnreset') ||
        message.includes('etimedout') ||
        message.includes('socket hang up') ||
        message.includes('network') ||
        message.includes('fetch failed')
    );
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate delay with exponential backoff and jitter.
 */
function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
    // Exponential backoff: base * 2^attempt
    const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
    // Add jitter (±25%)
    const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
    const delay = exponentialDelay + jitter;
    // Cap at max delay
    return Math.min(delay, maxDelayMs);
}

/**
 * Execute a function with automatic retries on failure.
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration options
 * @returns Result of the function
 * @throws Last error if all retries are exhausted
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => fetch('https://api.example.com/data'),
 *   { maxRetries: 3 }
 * );
 * ```
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const shouldRetry = opts.retryOn || isRetryableError;

    let lastError: Error;

    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: unknown) {
            lastError = error instanceof Error ? error : new Error(String(error));

            // Don't retry if we've exhausted attempts
            if (attempt >= opts.maxRetries) {
                break;
            }

            // Don't retry if error is not retryable
            if (!shouldRetry(error)) {
                break;
            }

            // Calculate delay and wait
            const delayMs = calculateDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);

            if (opts.onRetry) {
                opts.onRetry(attempt + 1, delayMs, lastError);
            }

            await sleep(delayMs);
        }
    }

    throw lastError!;
}

/**
 * Create a retryable version of an async function.
 *
 * @param fn - Async function to wrap
 * @param options - Retry configuration options
 * @returns Wrapped function with retry behavior
 */
export function withRetryWrapper<T extends (...args: unknown[]) => Promise<unknown>>(
    fn: T,
    options: RetryOptions = {}
): T {
    return ((...args: Parameters<T>) => withRetry(() => fn(...args), options)) as T;
}
