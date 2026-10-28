# Project memory

## Streaming display

The user wants smooth, word-by-word text reveal like Codex across all models, including fast DeepSeek and Llama responses. Preserve this preference when changing chat rendering.

The October 24, 2026 investigation found incremental SSE arriving through both Hono and Vite. Fast generation plus frame batching made answers look instantaneous. Keep network consumption at full speed and pace the display separately.

When changing streaming, read `src/client/chat/display-queue.ts`, `run-stream.ts`, and their tests in `tests/unit/`. Preserve these behaviors:

- Reveal words gradually, with faster catch-up for large backlogs and exact final Markdown/Unicode text.
- Keep the run active until successful output finishes displaying. Stop freezes the visible prefix and clears queued text, including after the network has finished.
- On stream failure, show all text already received before displaying the error. Retry eligibility depends on received tokens.
- Measure time to first token and throughput from network arrival/completion, independently of display pacing.
- Respect reduced-motion preferences with immediate display.

When checking architecture or distinguishing implemented features from plans, read `docs/architecture.md`.
