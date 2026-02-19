/**
 * File operation tool handlers.
 * @module tools/file_tools
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeDebug } from '../core/debug';
import { getStatCache } from '../core/stat_cache';
import {
    ErrorCode,
    makeConfirmationError,
    makeError,
    makePermissionError,
} from '../core/tool_contract';
import {
    CopyFileArgs,
    CountWordsArgs,
    CreateDirectoryArgs,
    DeleteDirectoryArgs,
    DeleteFileArgs,
    ExecutorContext,
    FileInfoArgs,
    ListFilesArgs,
    MoveFileArgs,
    ReadFileArgs,
    ToolResult,
    WriteFileArgs,
} from '../core/types';

/**
 * Handle write_file tool.
 * @param {WriteFileArgs} args - Tool arguments containing path and content.
 * @param {Object} context - Execution context.
 * @returns {Object} Result object with ok, result, error, debug.
 */
export function handleWriteFile(args: WriteFileArgs, context: ExecutorContext): ToolResult {
    const { paths, requiresConfirmation, permissionsPath, start } = context;

    // Precedence: deny_tools (checked in executor) -> require_confirmation_for -> allow_paths
    // Check confirmation BEFORE path check
    if (requiresConfirmation('write_file') && args.confirm !== true) {
        return {
            ok: false,
            result: null,
            error: makeConfirmationError('write_file', permissionsPath),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    let targetPath: string;
    try {
        targetPath = paths.resolveAllowed(args.path, 'write');
    } catch {
        // Path resolution or permission check failed
        return {
            ok: false,
            result: null,
            error: makePermissionError(
                'write_file',
                args.path,
                permissionsPath,
                ErrorCode.DENIED_PATH_ALLOWLIST
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    const content = args.content;

    // Defensive check: ensure limits exists before destructuring
    if (!context.limits) {
        return {
            ok: false,
            result: null,
            error: makeError(ErrorCode.EXEC_ERROR, 'Internal error: limits not configured'),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    const { maxWriteSize } = context.limits;
    // Check file size limit
    if (content.length > maxWriteSize) {
        return {
            ok: false,
            result: null,
            error: makeError(
                ErrorCode.VALIDATION_ERROR,
                `Content exceeds maximum size of ${maxWriteSize} bytes.`
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    try {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, content, 'utf8');
        // Invalidate stat cache after write
        const statCache = getStatCache();
        statCache.invalidate(targetPath);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            result: null,
            error: makeError(ErrorCode.EXEC_ERROR, `Failed to write file: ${message}`),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    return {
        ok: true,
        result: {
            path: args.path,
            bytes: content.length,
            message: `File written to ${args.path}`,
        },
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

/**
 * Handle read_file tool with pagination support.
 * @param {ReadFileArgs} args - Tool arguments containing path, offset, limit.
 * @param {Object} context - Execution context.
 * @returns {Object} Result object with ok, result, error, debug.
 */
export function handleReadFile(args: ReadFileArgs, context: ExecutorContext): ToolResult {
    const { paths, permissionsPath, start } = context;

    let targetPath: string;
    try {
        targetPath = paths.resolveAllowed(args.path, 'read');
    } catch {
        // Path resolution or permission check failed
        return {
            ok: false,
            result: null,
            error: makePermissionError(
                'read_file',
                args.path,
                permissionsPath,
                ErrorCode.DENIED_PATH_ALLOWLIST
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Get file stats (with caching)
    const statCache = getStatCache();
    const stats = statCache.get(targetPath);
    if (!stats) {
        return {
            ok: false,
            result: null,
            error: makeError(ErrorCode.EXEC_ERROR, `File not found: ${args.path}`),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }
    if (stats.isDirectory()) {
        return {
            ok: false,
            result: null,
            error: makeError(
                ErrorCode.EXEC_ERROR,
                `Path '${args.path}' is a directory, not a file.`
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }
    const fileSize = stats.size;

    // Use provided offset and limit (validated by Zod schema)
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 8192;

    // Calculate actual bytes to read
    const bytesAvailable = Math.max(0, fileSize - offset);
    const bytesToRead = Math.min(limit, bytesAvailable);

    // If offset is beyond file end, return empty content with eof
    if (offset >= fileSize) {
        return {
            ok: true,
            result: {
                content: '',
                bytesRead: 0,
                nextOffset: offset,
                eof: true,
                fileSize,
            },
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

    // Read the specified byte range
    let content: string = '';
    let bytesRead: number = 0;
    try {
        const fd = fs.openSync(targetPath, 'r');
        try {
            const buffer = Buffer.alloc(bytesToRead);
            bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, offset);
            content = buffer.slice(0, bytesRead).toString('utf8');
        } finally {
            fs.closeSync(fd);
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            result: null,
            error: makeError(ErrorCode.EXEC_ERROR, `Failed to read file: ${message}`),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    const nextOffset = offset + bytesRead;
    const eof = nextOffset >= fileSize;

    return {
        ok: true,
        result: {
            content,
            bytesRead,
            nextOffset,
            eof,
            fileSize,
        },
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

/**
 * Handle list_files tool.
 * @param {ListFilesArgs} args - Tool arguments with optional path.
 * @param {Object} context - Execution context.
 * @returns {Object} Result object with ok, result, error, debug.
 */
export function handleListFiles(args: ListFilesArgs, context: ExecutorContext): ToolResult {
    const { baseDir, paths, permissionsPath, start } = context;

    // Resolve target directory - default to baseDir if no path provided
    let targetDir: string;
    if (args?.path) {
        let resolved: string;
        try {
            resolved = paths.resolveAllowed(args.path, 'list');
        } catch {
            // Path resolution or permission check failed
            return {
                ok: false,
                result: null,
                error: makePermissionError(
                    'list_files',
                    args.path,
                    permissionsPath,
                    ErrorCode.DENIED_PATH_ALLOWLIST
                ),
                _debug: makeDebug({
                    path: 'tool_json',
                    start,
                    model: null,
                    memory_read: false,
                    memory_write: false,
                }),
            };
        }
        // Verify it's a directory (with caching)
        const statCache = getStatCache();
        const stats = statCache.get(resolved);
        if (!stats || !stats.isDirectory()) {
            return {
                ok: false,
                result: null,
                error: makeError(
                    ErrorCode.VALIDATION_ERROR,
                    `Path '${args.path}' is not a directory.`
                ),
                _debug: makeDebug({
                    path: 'tool_json',
                    start,
                    model: null,
                    memory_read: false,
                    memory_write: false,
                }),
            };
        }
        targetDir = resolved;
    } else {
        targetDir = baseDir;
    }

    // Read directory with file types
    let dirEntries: fs.Dirent[];
    try {
        dirEntries = fs.readdirSync(targetDir, { withFileTypes: true });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            result: null,
            error: makeError(ErrorCode.EXEC_ERROR, `Failed to list files: ${message}`),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Filter entries and add type info (optimized: single pass instead of filter+map)
    // Exclude hidden files (starting with .) for security - they may contain sensitive data
    // like .npmrc, .bash_history, .ssh, etc.
    const entries: Array<{ name: string; type: 'file' | 'directory' }> = [];
    for (const dirent of dirEntries) {
        // Skip hidden files/directories (those starting with .)
        if (dirent.name.startsWith('.')) {
            continue;
        }
        const entryPath = path.join(targetDir, dirent.name);
        try {
            paths.assertAllowed(entryPath, 'list');
            entries.push({
                name: dirent.name,
                type: dirent.isDirectory() ? 'directory' : 'file',
            });
        } catch {
            // Skip entries that aren't allowed
        }
    }
    // Sort entries by name
    entries.sort((a, b) => a.name.localeCompare(b.name));

    return {
        ok: true,
        result: { entries },
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

/**
 * Handle delete_file tool.
 * @param args - Tool arguments containing path and optional confirm flag.
 * @param context - Execution context.
 * @returns Result object with ok, result, error, debug.
 */
export function handleDeleteFile(args: DeleteFileArgs, context: ExecutorContext): ToolResult {
    const { paths, requiresConfirmation, permissionsPath, start } = context;

    // Check confirmation requirement BEFORE path check
    if (requiresConfirmation('delete_file') && args.confirm !== true) {
        return {
            ok: false,
            result: null,
            error: makeConfirmationError('delete_file', permissionsPath),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Validate and resolve path
    let targetPath: string;
    try {
        targetPath = paths.resolveAllowed(args.path, 'write'); // Delete requires write permission
    } catch {
        return {
            ok: false,
            result: null,
            error: makePermissionError(
                'delete_file',
                args.path,
                permissionsPath,
                ErrorCode.DENIED_PATH_ALLOWLIST
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Check if file exists and is not a directory (with caching)
    const statCache = getStatCache();
    const stats = statCache.get(targetPath);
    if (!stats) {
        return {
            ok: false,
            result: null,
            error: makeError(ErrorCode.EXEC_ERROR, `File not found: ${args.path}`),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Delete the file
    try {
        fs.unlinkSync(targetPath);
        // Invalidate stat cache after delete
        const statCache = getStatCache();
        statCache.invalidate(targetPath);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            result: null,
            error: makeError(ErrorCode.EXEC_ERROR, `Failed to delete file: ${message}`),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    return {
        ok: true,
        result: { deleted: args.path },
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

/**
 * Handle move_file tool.
 * @param args - Tool arguments containing source and destination paths.
 * @param context - Execution context.
 * @returns Result object with ok, result, error, debug.
 */
export function handleMoveFile(args: MoveFileArgs, context: ExecutorContext): ToolResult {
    const { paths, requiresConfirmation, permissionsPath, start } = context;

    // Check confirmation requirement BEFORE path check
    if (requiresConfirmation('move_file') && args.confirm !== true) {
        return {
            ok: false,
            result: null,
            error: makeConfirmationError('move_file', permissionsPath),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Validate and resolve source path (requires read permission)
    let sourcePath: string;
    try {
        sourcePath = paths.resolveAllowed(args.source, 'read');
    } catch {
        return {
            ok: false,
            result: null,
            error: makePermissionError(
                'move_file',
                args.source,
                permissionsPath,
                ErrorCode.DENIED_PATH_ALLOWLIST
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Validate and resolve destination path (requires write permission)
    let destinationPath: string;
    try {
        destinationPath = paths.resolveAllowed(args.destination, 'write');
    } catch {
        return {
            ok: false,
            result: null,
            error: makePermissionError(
                'move_file',
                args.destination,
                permissionsPath,
                ErrorCode.DENIED_PATH_ALLOWLIST
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Check if source file exists and is not a directory (with caching)
    const statCache = getStatCache();
    const stats = statCache.get(sourcePath);
    if (!stats) {
        return {
            ok: false,
            result: null,
            error: makeError(ErrorCode.EXEC_ERROR, `Source file not found: ${args.source}`),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }
    if (stats.isDirectory()) {
        return {
            ok: false,
            result: null,
            error: makeError(
                ErrorCode.EXEC_ERROR,
                `Source path '${args.source}' is a directory, not a file.`
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Check if destination already exists (with caching)
    const destStats = statCache.get(destinationPath);
    if (destStats && destStats.isDirectory()) {
        return {
            ok: false,
            result: null,
            error: makeError(
                ErrorCode.EXEC_ERROR,
                `Destination path '${args.destination}' is a directory, not a file.`
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }
    // If destStats is null, destination doesn't exist, which is fine - we'll create it
    try {
        const destDir = path.dirname(destinationPath);
        fs.mkdirSync(destDir, { recursive: true });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            result: null,
            error: makeError(
                ErrorCode.EXEC_ERROR,
                `Failed to create destination directory: ${message}`
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Move the file
    try {
        fs.renameSync(sourcePath, destinationPath);
        // Invalidate stat cache for both source and destination
        const statCache = getStatCache();
        statCache.invalidate(sourcePath);
        statCache.invalidate(destinationPath);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            result: null,
            error: makeError(ErrorCode.EXEC_ERROR, `Failed to move file: ${message}`),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    return {
        ok: true,
        result: {
            source: args.source,
            destination: args.destination,
            message: `Successfully moved ${args.source} to ${args.destination}`,
        },
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

/**
 * Handle copy_file tool.
 * @param args - Tool arguments containing source and destination paths.
 * @param context - Execution context.
 * @returns Result object with ok, result, error, debug.
 */
export function handleCopyFile(args: CopyFileArgs, context: ExecutorContext): ToolResult {
    const { paths, requiresConfirmation, permissionsPath, start } = context;

    // Check confirmation requirement BEFORE path check
    if (requiresConfirmation('copy_file') && args.confirm !== true) {
        return {
            ok: false,
            result: null,
            error: makeConfirmationError('copy_file', permissionsPath),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Validate and resolve source path (requires read permission)
    let sourcePath: string;
    try {
        sourcePath = paths.resolveAllowed(args.source, 'read');
    } catch {
        return {
            ok: false,
            result: null,
            error: makePermissionError(
                'copy_file',
                args.source,
                permissionsPath,
                ErrorCode.DENIED_PATH_ALLOWLIST
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Validate and resolve destination path (requires write permission)
    let destinationPath: string;
    try {
        destinationPath = paths.resolveAllowed(args.destination, 'write');
    } catch {
        return {
            ok: false,
            result: null,
            error: makePermissionError(
                'copy_file',
                args.destination,
                permissionsPath,
                ErrorCode.DENIED_PATH_ALLOWLIST
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Check if source file exists and is not a directory (with caching)
    const statCache = getStatCache();
    const stats = statCache.get(sourcePath);
    if (!stats) {
        return {
            ok: false,
            result: null,
            error: makeError(ErrorCode.EXEC_ERROR, `Source file not found: ${args.source}`),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }
    if (stats.isDirectory()) {
        return {
            ok: false,
            result: null,
            error: makeError(
                ErrorCode.EXEC_ERROR,
                `Source path '${args.source}' is a directory, not a file.`
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Check if destination already exists (with caching)
    const destStats = statCache.get(destinationPath);
    if (destStats && destStats.isDirectory()) {
        return {
            ok: false,
            result: null,
            error: makeError(
                ErrorCode.EXEC_ERROR,
                `Destination path '${args.destination}' is a directory, not a file.`
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }
    // If destStats is null, destination doesn't exist, which is fine - we'll create it
    // If destStats exists and is a file, it will be overwritten (Node.js fs.copyFileSync behavior)

    // Ensure destination directory exists
    try {
        const destDir = path.dirname(destinationPath);
        fs.mkdirSync(destDir, { recursive: true });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            result: null,
            error: makeError(
                ErrorCode.EXEC_ERROR,
                `Failed to create destination directory: ${message}`
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Copy the file
    try {
        fs.copyFileSync(sourcePath, destinationPath);
        // Invalidate stat cache for destination (source unchanged)
        const statCache = getStatCache();
        statCache.invalidate(destinationPath);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            result: null,
            error: makeError(ErrorCode.EXEC_ERROR, `Failed to copy file: ${message}`),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    return {
        ok: true,
        result: {
            source: args.source,
            destination: args.destination,
            message: `Copied ${args.source} to ${args.destination}`,
        },
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

/**
 * Handle file_info tool.
 * @param args - Tool arguments containing path.
 * @param context - Execution context.
 * @returns Result object with ok, result, error, debug.
 */
export function handleFileInfo(args: FileInfoArgs, context: ExecutorContext): ToolResult {
    const { paths, permissionsPath, start } = context;

    // Validate and resolve path (requires read permission)
    let targetPath: string;
    try {
        targetPath = paths.resolveAllowed(args.path, 'read');
    } catch {
        return {
            ok: false,
            result: null,
            error: makePermissionError(
                'file_info',
                args.path,
                permissionsPath,
                ErrorCode.DENIED_PATH_ALLOWLIST
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Get file stats (with caching)
    const statCache = getStatCache();
    const stats = statCache.get(targetPath);
    if (!stats) {
        return {
            ok: false,
            result: null,
            error: makeError(ErrorCode.EXEC_ERROR, `File not found: ${args.path}`),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Get file permissions (Unix-style)
    let mode: string;
    try {
        mode = stats.mode.toString(8).slice(-3); // Last 3 octal digits
    } catch {
        mode = 'unknown';
    }

    // Format modified date
    const modifiedDate = stats.mtime.toISOString();

    // Determine file type
    let type: 'file' | 'directory' | 'symlink' | 'other';
    if (stats.isFile()) {
        type = 'file';
    } else if (stats.isDirectory()) {
        type = 'directory';
    } else if (stats.isSymbolicLink()) {
        type = 'symlink';
    } else {
        type = 'other';
    }

    return {
        ok: true,
        result: {
            path: args.path,
            type,
            size: stats.size,
            modified: modifiedDate,
            permissions: mode,
            isFile: stats.isFile(),
            isDirectory: stats.isDirectory(),
            isSymbolicLink: stats.isSymbolicLink(),
        },
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

/**
 * Handle create_directory tool.
 * @param args - Tool arguments containing path.
 * @param context - Execution context.
 * @returns Result object with ok, result, error, debug.
 */
export function handleCreateDirectory(
    args: CreateDirectoryArgs,
    context: ExecutorContext
): ToolResult {
    const { paths, permissionsPath, start } = context;

    // Validate and resolve path (requires write permission)
    let targetPath: string;
    try {
        targetPath = paths.resolveAllowed(args.path, 'write');
    } catch {
        return {
            ok: false,
            result: null,
            error: makePermissionError(
                'create_directory',
                args.path,
                permissionsPath,
                ErrorCode.DENIED_PATH_ALLOWLIST
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Check if path already exists (with caching)
    const statCache = getStatCache();
    const stats = statCache.get(targetPath);
    if (stats && stats.isDirectory()) {
        // Directory already exists - this is OK, return success
        return {
            ok: true,
            result: { path: args.path, created: false, message: 'Directory already exists' },
            error: null,
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    } else if (stats && stats.isFile()) {
        // Path exists but is a file
        return {
            ok: false,
            result: null,
            error: makeError(
                ErrorCode.EXEC_ERROR,
                `Path '${args.path}' already exists and is a file, not a directory.`
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    } else {
        // Path doesn't exist (stats is null) - create it
        try {
            // Create directory with parent directories (recursive)
            fs.mkdirSync(targetPath, { recursive: true });
            // Invalidate cache after creation
            statCache.invalidate(targetPath);
            return {
                ok: true,
                result: { path: args.path, created: true, message: 'Directory created' },
                error: null,
                _debug: makeDebug({
                    path: 'tool_json',
                    start,
                    model: null,
                    memory_read: false,
                    memory_write: false,
                }),
            };
        } catch (mkdirErr: unknown) {
            const message = mkdirErr instanceof Error ? mkdirErr.message : String(mkdirErr);
            return {
                ok: false,
                result: null,
                error: makeError(ErrorCode.EXEC_ERROR, `Failed to create directory: ${message}`),
                _debug: makeDebug({
                    path: 'tool_json',
                    start,
                    model: null,
                    memory_read: false,
                    memory_write: false,
                }),
            };
        }
    }
}

/**
 * Handle delete_directory tool.
 * @param args - Tool arguments containing path and optional confirm flag.
 * @param context - Execution context.
 * @returns Result object with ok, result, error, debug.
 */
export function handleDeleteDirectory(
    args: DeleteDirectoryArgs,
    context: ExecutorContext
): ToolResult {
    const { paths, requiresConfirmation, permissionsPath, start } = context;

    // Check confirmation requirement BEFORE path check
    if (requiresConfirmation('delete_directory') && args.confirm !== true) {
        return {
            ok: false,
            result: null,
            error: makeConfirmationError('delete_directory', permissionsPath),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Validate and resolve path
    let targetPath: string;
    try {
        targetPath = paths.resolveAllowed(args.path, 'write'); // Delete requires write permission
    } catch {
        return {
            ok: false,
            result: null,
            error: makePermissionError(
                'delete_directory',
                args.path,
                permissionsPath,
                ErrorCode.DENIED_PATH_ALLOWLIST
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Check if directory exists and is actually a directory (with caching)
    const statCache = getStatCache();
    const stats = statCache.get(targetPath);
    if (!stats) {
        return {
            ok: false,
            result: null,
            error: makeError(ErrorCode.EXEC_ERROR, `Directory not found: ${args.path}`),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    if (!stats.isDirectory()) {
        return {
            ok: false,
            result: null,
            error: makeError(ErrorCode.EXEC_ERROR, `Path '${args.path}' is not a directory.`),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Delete the directory and its contents recursively
    try {
        fs.rmSync(targetPath, { recursive: true, force: true });
        // Invalidate stat cache after delete
        statCache.invalidate(targetPath);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            result: null,
            error: makeError(ErrorCode.EXEC_ERROR, `Failed to delete directory: ${message}`),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    return {
        ok: true,
        result: { deleted: args.path },
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

/**
 * Handle count_words tool.
 * Counts words, lines, and characters in a file.
 * @param args - Tool arguments containing path.
 * @param context - Execution context.
 * @returns Result object with ok, result, error, debug.
 */
export function handleCountWords(args: CountWordsArgs, context: ExecutorContext): ToolResult {
    const { paths, permissionsPath, start } = context;

    // Validate and resolve path (requires read permission)
    let targetPath: string;
    try {
        targetPath = paths.resolveAllowed(args.path, 'read');
    } catch {
        return {
            ok: false,
            result: null,
            error: makePermissionError(
                'count_words',
                args.path,
                permissionsPath,
                ErrorCode.DENIED_PATH_ALLOWLIST
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Get file stats (with caching)
    const statCache = getStatCache();
    const stats = statCache.get(targetPath);
    if (!stats) {
        return {
            ok: false,
            result: null,
            error: makeError(ErrorCode.EXEC_ERROR, `File not found: ${args.path}`),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }
    if (stats.isDirectory()) {
        return {
            ok: false,
            result: null,
            error: makeError(
                ErrorCode.EXEC_ERROR,
                `Path '${args.path}' is a directory, not a file.`
            ),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Read file content
    let content: string;
    try {
        content = fs.readFileSync(targetPath, 'utf8');
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            result: null,
            error: makeError(ErrorCode.EXEC_ERROR, `Failed to read file: ${message}`),
            _debug: makeDebug({
                path: 'tool_json',
                start,
                model: null,
                memory_read: false,
                memory_write: false,
            }),
        };
    }

    // Count characters (including newlines and spaces)
    const characters = content.length;

    // Count lines (split by newline, empty file = 0 lines, file with content but no newline = 1 line)
    const lines = content.length === 0 ? 0 : content.split('\n').length;

    // Count words (split by whitespace, filter empty strings)
    const words =
        content.trim().length === 0
            ? 0
            : content
                  .trim()
                  .split(/\s+/)
                  .filter(w => w.length > 0).length;

    return {
        ok: true,
        result: {
            path: args.path,
            characters,
            words,
            word_count: words, // Alias for eval expectation
            lines,
        },
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
