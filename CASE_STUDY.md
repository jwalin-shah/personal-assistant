# Personal Assistant Case Study

## Project Focus

Build a local-first assistant runtime that executes tools reliably, not just chats well.

## What I Built

- Deterministic-first routing stack with LLM fallback.
- Tool execution layer with validation/safety boundaries.
- Provider-agnostic model integration.
- CLI/REPL-centered workflows with benchmark and eval hooks.

## Technologies Used

- TypeScript/Node runtime
- Deterministic router + LLM fallback orchestration
- Plugin-based tool interface model
- CLI/REPL surfaces with evaluation and benchmark utilities

## What I Learned

- Reliability comes from routing and validation design more than model size.
- Data and task specification are bigger bottlenecks than swapping to the newest model.
- Prompt and instruction style are backend/model dependent and require targeted tuning.
- Fine-tuning has strong upside only after core routing and eval baselines are stable.

## What Worked

- Deterministic routing before model calls.
- Clear contracts for tool invocation and output validation.
- Layered fallbacks instead of single-shot model decisions.

## What Did Not Work

- Pure LLM orchestration without deterministic guardrails.
- Uniform confidence thresholds across heterogeneous tasks.
- Rapid prompt changes without fixed eval snapshots.
