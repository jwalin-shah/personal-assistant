# Personal Data Engine (repo: personal-assistant)

Local-first personal data engine for turning heterogeneous datasets into reliable retrieval and tool execution.

## TL;DR

- **What it is:** AI assistant infrastructure (not a single domain app)
- **Primary UX:** CLI + REPL
- **Core strength:** Deterministic-first routing with LLM fallback
- **Use it for:** Building assistants that must call tools safely and predictably

## Why This Project

Most assistant demos optimize for chat quality. This project optimizes for **execution quality**:

- route correctly
- invoke the right tool
- enforce safety boundaries
- keep provider choice flexible

## Key Capabilities

- Multi-stage router: regex -> heuristic -> parser -> LLM fallback
- Tool orchestration: files, git, shell, tasks, memory, communication tools
- Plugin model: external tools via `~/.assistant/plugins/`
- Provider-agnostic model layer: Groq, OpenRouter, mock/offline paths
- Interfaces: CLI/REPL, optional web dashboard, VS Code extension

## Architecture Snapshot

```text
Input (CLI/REPL/Web)
  -> Router (deterministic-first, LLM fallback)
  -> Execution Layer (built-in + plugin tools)
  -> Safety + Validation
  -> Output + Telemetry (responses, evals, benchmarks)
```

## Run In 60 Seconds

```bash
npm run showcase:setup
npm run showcase:run
npm run showcase:verify
```

Manual path:

```bash
npm install
npm run build
npm run repl
```

## Engineering Decisions

- Kept scope to a **single-assistant runtime** (not multi-agent orchestration).
- Chose deterministic-first routing to reduce cost and improve reliability.
- Isolated provider interfaces so backend models can be swapped cleanly.
- Kept local-first execution with explicit safety/validation boundaries.

## What We Tried

- Monorepo + orchestration coupling: too much complexity for assistant runtime iteration.
- One broad provider interface: evolved into cleaner split interfaces.
- Repo-local data defaults: convenient for dev, riskier for real usage; external data paths are preferred.
- LLM-only routing: rejected in favor of deterministic-first behavior.

## Documentation

- [Documentation Map](docs/START_HERE.md)
- [Architecture](docs/01-concepts/ARCHITECTURE.md)
- [Commands](docs/04-reference/COMMANDS.md)
- [Design Decisions](docs/meta/DECISIONS.md)
- [Stack Decision](docs/meta/STACK_DECISION.md)

## Non-Goals

This repository does not implement multi-agent orchestration/handoff systems.

## License

MIT
