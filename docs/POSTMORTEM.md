# Postmortem

## Hypothesis

A local macOS tool could warn before a ChatGPT conversation approached the point where it became unusable or needed continuation in a new chat.

## Architecture and implementation

The native macOS app owned cycle scheduling, persistence, and per-chat execution. A JavaScript bridge in the authenticated ChatGPT page combined network discovery with deterministic traversal of the virtualized sidebar. A bounded queue checked discovered conversations, preserved deferred work across cycles, and aggregated observed history using stable message identities.

## Live evidence

The discovery and inspection pipeline worked against real conversations. Live cycles exercised unified network/sidebar discovery, budget-aware scheduling, persistent cycle state, and completed checks. Regression work corrected cross-build completion persistence, budget over-admission, and a false no-progress watchdog result. These fixes made the pipeline more dependable; they did not establish that all history had been collected.

## Data-contract limitation

The page contract did not provide authoritative current context usage, remaining capacity, or a trustworthy threshold tied to the point of failure. Message counts were lower bounds when history was incomplete. `estimatedTextTokens` and locally learned thresholds were heuristics. Pagination responses lacked enough ordering and cursor-adjacency guarantees to prove a complete long-history total or reconstruct a safe incremental frontier.

## Decision

I rejected using those estimates as an exact near-limit warning. The prototype reached a working inspection pipeline, then development was intentionally stopped at the viability gate because the available data source could not support the product’s accuracy requirement. The exact remaining-capacity warning was not shipped.

## Redesign requirement

A viable redesign must begin with an authoritative signal for current conversation/context usage or remaining capacity, and an established limit threshold for comparison. Implementation should resume only after both signals and their semantics are confirmed.
