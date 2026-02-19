# Architecture Decisions Log

> **Purpose:** Record significant design decisions for this repo.  
> **Scope:** Personal Assistant only (not the parent monorepo).

---

## Active Decisions

### D015: Personal Assistant Extraction to Standalone Repo

**Date:** 2026-01-05  
**Status:** Accepted

**Context:** The monorepo contains both a personal assistant (`packages/personal-assistant/`) and a multi-agent orchestration layer (`packages/workflow-engine/`, handoff protocols). These serve different purposes and have become entangled.

**Decision:** Extract the personal assistant into a standalone repo at `/personal-assistant/` within the workspace. Leave orchestration code behind.

**Alternatives Considered:**

- Keep assistant + orchestration in one repo and isolate with package boundaries only
- Keep one repo and split by branch conventions/process
- Full rewrite in a fresh repo

**Rationale:**

- Personal assistant is feature-complete and independently useful
- Orchestration layer adds complexity without benefit for single-user CLI
- Clean separation enables focused development and simpler onboarding
- No code rewrite—just extraction and cleanup

**What We Tried / Observed:**

- Co-locating orchestration and assistant increased cognitive load for simple assistant changes.
- Cross-cutting docs/process made onboarding noisy for contributors interested only in assistant runtime work.
- Extraction delivered cleaner ownership without blocking future orchestration experiments in a separate codebase.

**Stack Decision:** Stay TypeScript (see [STACK_DECISION.md](./STACK_DECISION.md))

**Consequences:**

- ✅ Standalone repo can be versioned/released independently
- ✅ Orchestration experiments won't destabilize assistant
- ⚠️ Two repos to maintain (but orchestration may be archived)

**Migration Plan:** See [../MIGRATION_PLAN.md](../MIGRATION_PLAN.md)

---

### D016: Data Directory Policy

**Date:** 2026-01-05  
**Status:** Accepted

**Context:** Previous defaults wrote data files inside the repo (`data/`) or dist (`dist/memory.jsonl`), risking accidental commits and "root leakage."

**Decision:**

- Source default: `{project}/data/` (project-relative, for dev simplicity)
- Recommended for personal use: `ASSISTANT_DATA_DIR=~/.assistant-data` (outside repo)
- Configurable via `ASSISTANT_DATA_DIR` env var
- Never write data files to repo root or dist/

**Alternatives Considered:**

- Force all data into repo-local `data/` for deterministic paths
- Write ephemeral data into `dist/` for convenience during runs
- Use only env-driven external paths with no source default

**Consequences:**

- ✅ No accidental data commits (when using recommended env var)
- ✅ Repo can live anywhere without data pollution
- ⚠️ New devs must set `ASSISTANT_DATA_DIR` for persistent personal data

**What We Tried / Observed:**

- Repo-local defaults were convenient in development but created avoidable risk of accidental data tracking.
- Dist-based paths produced confusing behavior across build/clean cycles.
- Explicit external data paths (`ASSISTANT_DATA_DIR`) gave a safer operational model for real usage.

---

### D017: Provider Interface Architecture

**Date:** 2026-01-05  
**Status:** Accepted

**Context:** Current `LLMProvider` interface works but conflates chat completion and embeddings. Future local inference (Ollama, llama.cpp) needs clean swap points.

**Decision:** Refactor into two explicit ports:

- `ChatModel` interface for text completion/tool calling
- `EmbeddingModel` interface for vector embeddings

Adapters implement these interfaces:

- `src/llm/providers/groq.ts`
- `src/llm/providers/openrouter.ts`
- `src/llm/providers/ollama.ts` (future)
- `src/embeddings/providers/openrouter.ts`

**Alternatives Considered:**

- Keep one broad `LLMProvider` interface for both generation and embeddings
- Duplicate provider logic per feature area with no shared abstraction
- Hardcode a single vendor path for chat + embeddings

**Consequences:**

- ✅ Clear swap points for future providers
- ✅ ChatModel can be Groq while EmbeddingModel is local
- ✅ Code outside providers is agnostic to backend

**What We Tried / Observed:**

- A single provider abstraction worked initially but mixed concerns and made extension harder.
- Different latency/cost/reliability needs for generation vs embeddings pushed us toward separate ports.
- Split interfaces made future local-backend adoption (for either chat or embeddings) straightforward.

---

## Pending Decisions

_None currently._

---

## Superseded Decisions

_None yet._
