# GPTLimitsTool

**Frozen research prototype**

GPTLimitsTool explored whether a local macOS app could warn when a ChatGPT conversation was approaching its practical conversation or context limit.

## What was built

- A native macOS prototype integrated with the authenticated ChatGPT page.
- Network and deterministic virtualized-sidebar discovery, combined into one conversation set.
- Bounded conversation inspection, persistent cycle state, budget-aware scheduling, deferred work, and pagination/liveness handling.
- Cached-history aggregation with stable message deduplication.

The discovery and execution pipeline became functional and was exercised against real conversations. The available ChatGPT web-client contract did not expose authoritative current context usage, remaining capacity, or an established failure threshold. Long-history pagination also lacked enough guarantees to establish a trustworthy complete total.

An exact “remaining capacity” warning would therefore present heuristics as authoritative data. The project was intentionally frozen rather than shipping a misleading metric.

See [Architecture](docs/ARCHITECTURE.md), [Validation](docs/VALIDATION.md), and [Postmortem](docs/POSTMORTEM.md).
