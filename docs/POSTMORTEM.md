# Postmortem

## Original hypothesis

A local macOS tool could warn before a ChatGPT conversation became unusable or needed continuation in a new chat.

## Technical approach

The prototype combined a native macOS cycle engine with JavaScript running in the authenticated ChatGPT page. Network and deterministic sidebar discovery fed a unified conversation set. A bounded queue checked selected conversations, persisted unfinished work across cycles, and merged observed history using stable message identities.

## What worked

Discovery, cycle persistence, budget-aware scheduling, deferred work, and pagination progress handling became functional and were exercised against real conversations. Focused regression tests preserved these mechanisms as the implementation evolved.

## What failed

The product needed a trustworthy estimate of how close a conversation was to its practical limit. The available page contract did not expose current context usage, remaining capacity, or the threshold corresponding to failure. History pagination could return useful pages but did not provide enough ordering and adjacency guarantees to prove a complete long-history total.

## Important bugs and lessons

The work uncovered and fixed issues in completed-cycle persistence, scheduling under a finite cycle budget, and pagination liveness. Accepted page activity, aggregated new messages, and proven history completion are separate facts; treating one as another produced misleading state. Preserving those distinctions improved the execution pipeline but did not solve the product’s measurement problem.

## Viability gate

Observed message counts are lower bounds when history is incomplete. `estimatedTextTokens` is a heuristic derived from collected text, and locally learned thresholds are heuristic rather than tied to the actual failure condition. These estimates were rejected as insufficient for a reliable near-limit warning.

## Why the project was frozen

The prototype was not frozen because conversation discovery or execution could not be implemented. It was frozen because the available source data could not satisfy the accuracy guarantee required by the product. Presenting an exact remaining-capacity warning from these estimates would be misleading.

## What a future redesign would require

A future version must begin with an authoritative signal for current conversation/context usage or remaining capacity, plus the trustworthy limit threshold being compared against. Implementation should not resume until both sides of that comparison have established semantics.
