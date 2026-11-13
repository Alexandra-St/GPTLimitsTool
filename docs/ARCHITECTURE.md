# Architecture

GPTLimitsTool is a native macOS prototype with JavaScript injected into the authenticated ChatGPT page. The native app owns cycle scheduling, persistence, UI, and per-chat execution. The page bridge observes supported conversation responses and drives bounded automation in the existing document.

```text
Native macOS app
  ├─ cycle engine and persistent state
  ├─ discovery and candidate/check queue
  └─ bounded per-chat execution
       ↕ JavaScript bridge
Authenticated ChatGPT page
  ├─ network conversation discovery
  ├─ deterministic virtualized-sidebar traversal
  └─ conversation history responses
       ↓
Unified discovered-conversation set
       ↓
Deduplicating aggregate and cycle result
```

Network results and sidebar rows feed one discovery state. Sidebar traversal compares semantic row snapshots while scrolling virtualized content, and stops according to bounded progress and end evidence. Candidate selection feeds the existing check queue; work that does not fit the cycle budget remains pending for later cycles.

Per-chat checks use bounded execution and pagination progress tracking. The aggregation layer retains stable message identities and combines newly observed pages with saved state. Cycle state and completed-cycle summaries persist across app launches and builds. These mechanisms make discovery and execution useful, but they do not establish complete history or authoritative context usage.
