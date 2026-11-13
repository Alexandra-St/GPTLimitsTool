# Validation

## Working / verified

- Network discovery and sidebar discovery were exercised together in live cycles.
- Real cycles discovered hundreds of conversations.
- After budget-aware scheduling changes, admitted checks reached matching queued, started, and completed counts; deferred work remained pending for later cycles.
- A cross-build persistence bug that discarded a completed cycle snapshot was identified and fixed.
- A false no-progress result during active pagination was identified and fixed; subsequent live validation showed no recurrence of that false classification.
- Cached page aggregation and message deduplication were covered by focused tests.

## Limitations / not proven

- The page contract did not expose authoritative current conversation/context usage, remaining capacity, or the applicable failure threshold.
- Collected message counts can be incomplete. Estimated text tokens are heuristic.
- The available pagination contract did not prove chronological order within each page and contiguous cursor-linked page adjacency. Complete long-history totals and a safe incremental frontier were therefore not established.
- No live validation established reliable near-limit warning accuracy. The prototype does not meet that product requirement.
