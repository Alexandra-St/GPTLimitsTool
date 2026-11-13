# GPTLimitsTool

**Frozen research prototype · Native macOS and JavaScript**

GPTLimitsTool explored an early warning for conversations approaching their practical ChatGPT limit. I built a native macOS app connected to the authenticated ChatGPT page through a JavaScript/native bridge, then live-tested its conversation inspection pipeline.

The prototype reached working discovery and bounded checks across real conversations. Development stopped at a product viability gate: the available client data could not support an authoritative near-limit metric. No reliable remaining-capacity warning was shipped.

## Engineering highlights

- Deterministic discovery across ChatGPT’s virtualized sidebar, combined with network discoveries.
- A JavaScript ↔ native macOS bridge for conversation discovery and bounded inspection.
- Persistent cycle and check state across runs and builds, including deferred work.
- Budget-aware scheduling and pagination/liveness handling for long conversations.
- Live validation of the inspection pipeline and an evidence-based product viability decision.

## Why the prototype is frozen

The available page contract did not expose authoritative current context usage, remaining capacity, or an established failure threshold. Message counts can be incomplete, and estimated text tokens are heuristic. Long-history pagination also lacked the guarantees needed to prove a complete total. Using these signals for an exact remaining-capacity warning would overstate what the data supports.

The result is a working inspection prototype, not a reliable near-limit warning product. Resuming product development requires an authoritative usage signal and a trustworthy threshold to compare against.

See [Architecture](docs/ARCHITECTURE.md), [Validation](docs/VALIDATION.md), and [Postmortem](docs/POSTMORTEM.md).

## License / Usage

Source is available for portfolio review and personal, non-commercial evaluation. This project is not open source. Reuse, redistribution, derivative works, and commercial use require prior written permission. See the [Portfolio Source-Available Notice](LICENSE).
