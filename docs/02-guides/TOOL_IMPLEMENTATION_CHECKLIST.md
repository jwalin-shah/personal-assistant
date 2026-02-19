# Tool Implementation Checklist

Use this checklist to implement tools one by one. Copy the tool name and description to use with `/impl_add_tool`.

## Quick Start

1. Pick a tool from the list below
2. Run: `/impl_add_tool [tool_name] - [description]`
3. Check off the tool when done
4. Move to next tool

---

## Phase 1: Core File Operations (Priority: High)

- [x] `delete_file` - Delete a file (requires confirmation if configured). ✅ **DONE**
- [x] `move_file` - Move or rename a file from one path to another. ✅ **DONE**
- [x] `copy_file` - Copy a file from source to destination path. ✅ **DONE**
- [x] `file_info` - Get file metadata (size, modified date, permissions, type). ✅ **DONE**
- [x] `create_directory` - Create a directory (with parent directories if needed). ✅ **DONE**
- [x] `delete_directory` - Delete a directory and its contents (requires confirmation). ✅ **DONE**

## Phase 2: Search and Discovery (Priority: High)

- [x] `grep` - Search for text patterns in files (fast regex search across files). ✅ **DONE**
- [ ] `fuzzy_find` - Fuzzy file search (like fzf - finds files by name pattern).
- [ ] `find_files` - Search for files by name pattern (supports glob patterns).
- [ ] `find_by_content` - Find files containing specific text content.
- [ ] `find_duplicates` - Find duplicate files by content hash.

## Phase 3: Git Operations (Priority: Medium)

- [ ] `git_add` - Stage files for commit (requires confirmation).
- [ ] `git_commit` - Create a git commit with message (requires confirmation).
- [ ] `git_branch` - List, create, or switch git branches.
- [ ] `git_auto_commit` - Auto-generate commit message from changes (requires confirmation).
- [ ] `git_remote` - Show git remote information.
- [ ] `git_tag` - List or create git tags.

## Phase 4: Text Processing (Priority: Medium)

- [x] `count_words` - Count words, lines, and characters in a file. ✅ **DONE**
- [ ] `format_json` - Format and validate JSON content.
- [ ] `extract_lines` - Extract specific line ranges from a file.
- [ ] `search_replace` - Find and replace text across multiple files (requires confirmation).
- [ ] `parse_csv` - Parse CSV files and return structured data.
- [ ] `convert_format` - Convert between formats (JSON ↔ YAML, etc.).

## Phase 5: Task and Memory Extensions (Priority: Medium)

- [ ] `task_update` - Update task details (text, due date, priority).
- [ ] `task_delete` - Delete a task (requires confirmation).
- [ ] `task_search` - Search tasks by text or filters.
- [ ] `task_stats` - Show task statistics (completed, pending, by priority).
- [ ] `memory_delete` - Delete memory entries by ID or query.
- [ ] `memory_update` - Update existing memory entries.

## Phase 6: Notes and Documentation (Priority: Medium)

- [ ] `note_add` - Create structured notes (separate from memory system).
- [ ] `note_search` - Search notes by content or tags.
- [ ] `note_list` - List notes by tag, category, or date.
- [ ] `generate_readme` - Generate README from codebase analysis.
- [ ] `generate_docs` - Auto-generate documentation from code comments.
- [ ] `create_changelog` - Generate changelog from git commits.

## Phase 7: System Information (Priority: Low)

- [ ] `disk_usage` - Check disk space usage for current directory or specified path.
- [ ] `system_info` - Get OS, memory, CPU information.
- [ ] `environment_vars` - List or get environment variables.
- [ ] `process_list` - List running processes (filtered, safe subset).

## Phase 8: Package Management (Priority: Low)

- [ ] `npm_list` - List installed npm packages in current directory.
- [ ] `npm_search` - Search npm packages (read-only, no install).
- [ ] `check_updates` - Check for outdated packages in package.json.
- [ ] `audit_security` - Run npm audit for security vulnerabilities.

## Phase 9: Productivity Tools (Priority: Low)

- [ ] `time_track` - Track time spent on tasks or projects.
- [ ] `pomodoro` - Start a pomodoro timer (25-minute work session).
- [ ] `journal_entry` - Create daily journal entries.
- [ ] `habit_tracker` - Track habits with daily check-ins.

## Phase 10: Network Utilities (Priority: Low)

- [ ] `ping` - Ping a host to check connectivity.
- [ ] `check_port` - Check if a network port is open.
- [ ] `download_file` - Download files from URLs to local path.
- [ ] `curl` - Make HTTP requests (safe subset, read-only by default).

## Phase 11: Clipboard Operations (Priority: Low)

- [ ] `clipboard_read` - Read current clipboard content (macOS/Linux).
- [ ] `clipboard_write` - Write text to clipboard (macOS/Linux).

## Phase 12: Backup and Archive (Priority: Low)

- [ ] `backup_files` - Create backup of files or directories.
- [ ] `archive_create` - Create zip/tar archives from files.
- [ ] `archive_extract` - Extract zip/tar archives.
- [ ] `sync_directory` - Sync directories (compare and copy differences).

## Phase 13: AI-Powered Code Assistance (Priority: High, Requires LLM)

- [ ] `explain_code` - Explain what code does in plain language (uses LLM).
- [ ] `generate_code` - Generate code snippets from natural language (uses LLM).
- [ ] `refactor_code` - Suggest and apply code refactoring (uses LLM).
- [ ] `add_comments` - Automatically add comments/docstrings to code (uses LLM).
- [ ] `generate_tests` - Generate test files for existing code (uses LLM).
- [ ] `code_review` - Automated code review with suggestions (uses LLM).

## Phase 14: Code Understanding (Priority: Medium)

- [ ] `codebase_summary` - Generate summary of codebase structure.
- [ ] `find_usage` - Find where functions/classes are used.
- [ ] `dependency_graph` - Visualize code dependencies.
- [ ] `complexity_analysis` - Analyze code complexity metrics.

## Phase 15: Advanced Features (Priority: Low)

- [ ] `secret_store` - Securely store secrets locally (encrypted).
- [ ] `secret_retrieve` - Retrieve secrets (with permission checks).
- [ ] `workflow_create` - Create automated workflows (save command sequences).
- [ ] `workflow_run` - Execute saved workflows.
- [ ] `scaffold_project` - Generate project from templates.
- [ ] `file_tree` - Generate directory tree structure.

---

## Usage Examples

### Example 1: Implement move_file
```
/impl_add_tool move_file - Move or rename a file from one path to another
```

### Example 2: Implement grep
```
/impl_add_tool grep - Search for text patterns in files (fast regex search across files)
```

### Example 3: Implement git_add
```
/impl_add_tool git_add - Stage files for commit (requires confirmation)
```

---

## Progress Tracking

**Total Tools:** ~100+
**Completed:** 4 (`delete_file`, `move_file`, `copy_file`, `file_info`)
**Remaining:** ~96+

**Current Phase:** Phase 1 (Core File Operations)
**Next Recommended:** `move_file` or `copy_file`

---

## Notes

- Tools are organized by priority and complexity
- Start with Phase 1 for highest value, easiest implementation
- Phase 13 (AI-Powered) requires LLM provider to be configured
- All destructive operations should require confirmation
- See `docs/02-guides/ADDING_TOOLS_GUIDE.md` for implementation patterns
