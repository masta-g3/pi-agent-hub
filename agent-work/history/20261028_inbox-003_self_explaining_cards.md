# inbox-003 — Self-explaining cards

**Outcome:** Implemented, reviewed and reflected on branch `inbox-003`.
**Integration target:** `inbox-integration`; parent owns integration and worktree closeout.
**Design:** `agent-work/decks/inbox-design-lab.html`, frozen D1/D2/D3/D6/D8/D9/D10.

## Delivered

- No-pin Status/Repo fleet cards retain separate task and request lines. Group, repo and branch share metadata; the producer grid appears at 80+, a plain step below 80, task counts/age at 160+, and incomplete live activity at 100+. Branch drops before repo. Selected task/request content windows instead of height elision; unselected neighbors retain their density ladder.
- Selected fleet actions and Details expand inside the card. The fleet side column, synthetic-header blank column and fleet full-screen workspace are retired. The board retains its wide column and narrow full-screen workspace; normal pinned strips keep their height ladder. Commands remain catalog-owned, whole-item-fitted and exact-target guarded; continuation rows retain owner mouse targets.
- One `setCardPanel()`/`clearCardPanel()` API and `renderFocusedPanel()` renderer serve fleet, both board surfaces, pin and follow strips. Identity/local keys are reserved, body text wraps and scrolls, and overflowing panels take the list viewport. Short panels keep neighbors when they fit; focused strips grow while retaining a list row. Tiny heights offer Open in Pi. Messages/flashes stay inside the panel rather than replacing local keys.
- `writeInteraction()` keeps one in-memory receipt per exact managed/Pi/instance target: Submitting, Accepted, Rejected or Delivery unknown. It blocks duplicate pending writes and uses the five-second deadline without retry. Accepted clears on an observed new running transition or the next write; terminal errors persist until dismissal or target invalidation. Send text and configured shortcuts share this path. `afterInteractionWrite()` separates activity bookkeeping errors from confirmed delivery.
- Follow view is opt-in. The footer keeps Next request, All actions and Help first, with compact phone labels and whole-item fitting. Catalog labels use Details and Open in Pi.
- `AGENTS.md` and `docs/STRUCTURE.md` now state the actual fleet/board/pin boundaries, shared slot, D2 hierarchy, Enter/Details semantics and opt-in follow. Every replaced paragraph is shorter. Follow-default statements in `docs/FEATURES.md` and `docs/CONFIG.md` were corrected.

## Scope and review

The maintainer extended D8 during execution to require the same panel slot in every selected-session host; fixture tests cover all five hosts. No editor ships here. Reply, Answer, previews and Conversation cutover remain with inbox-004/inbox-005; inbox-007 owns the broader narrative, not contradictory source guidance.

Code-critic accepted the implementation after fixing its local-key overwrite finding. Owning review also fixed missed Accepted-to-running transitions behind dialogs and stale card action hits after narrow renders. Regression tests reproduce all three issues.

- Code-critic job `63d1d0d7-8be0-4a7b-bef4-b84a1da4752b`: material-fix rerun **LGTM**, 32 focused tests passed; one finding accepted, none rejected.
- Docs-critic job `c1fea4e3-06c7-41a6-9718-215fe29b6f17`: **LGTM**, no findings. Both specialist sessions were stopped after completion.
- Reflection candidates were resolved in place. No follow-up tickets were created or updated.

## Verification

- Baseline: typecheck and 1,332 tests passed.
- Before commit, the authorized merge of local `inbox-integration` at `881ce7825e1110f31e285a1f1608e99923101bc4` reported already up to date; no conflicts occurred.
- Post-merge `npm run typecheck`: passed. `npm test`: **1,365 passed, 0 failed**.
- Fifteen real `buildRenderModel → renderSessions` captures covered normal cards, Accepted receipts and focused panels at 160/120/80/60/30 columns. Width, separate task/request content, inline actions and panel scrolling matched the approved anatomy. Existing tree gutters and exceptional workspace guidance remain through the reuse path; future Reply/Answer controls were not simulated.
- `git diff --check` and guidance-length checks passed. Temporary scripts, captures and logs were removed; permanent tests and snapshots retain useful verification.

No push, PR or worktree cleanup is part of this ticket-branch handoff.
