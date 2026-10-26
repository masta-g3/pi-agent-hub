# Board consistency

**Feature:** ui-polish-007

**Branch:** `ui-polish-007`

**Integration target:** `ui-polish-integration`

**Epic:** ui-polish-000, critique finding 14

**Depends on:** ui-polish-004

## Implemented

- Board title rows reuse `fleetWorkflowCell`, aligned under lane-header labels from the existing board projection's canonical producer vocabulary. Incompatible or over-wide rows retain an explicit compact current-step label.
- Lane headings use bold Active-tier tone with parent counts beside the label. Indented group headings use muted text and show only nonzero `?N` attention counts.
- Cards under group headings omit repeated group badges. Narrow boards retain badges when headings are absent.
- Modes and ages precede the grid so its columns stay fixed. Narrow fitting retains a compact step label before dropping workflow information.
- Board footer reads `S Fleet`.
- Lane membership, ordering, disclosure, keyboard/mouse targets, and board-only progress behavior remain unchanged. No new settings, persistence, or projection were introduced.
- Updated `AGENTS.md` and `docs/STRUCTURE.md` contracts.

## Review and reflection

- Preserved the existing full rail for wide Repo Backlog rows; removed only its unused ticket-tail option. Added a regression test for this non-board boundary.
- Accepted the code critic's narrow-grid fitting finding and added a regression test. Follow-up review returned LGTM.
- Code critic: `1e94a802-06b0-4124-92a0-15d8b76d1bc3`; result: `/Users/manager/.pi/agent/pi-tmux-subagents/jobs/1e94a802-06b0-4124-92a0-15d8b76d1bc3/result.md`.
- No scope deviations, unresolved reflection candidates, or follow-up tickets. Reflection required no further durable guidance; docs critic was skipped.

## Validation

- Tests cover grid alignment at 120 and 160 columns, with and without the action workspace; canonical vocabulary across lanes; incompatible pipelines; heading styles/counts; badge placement; narrow step retention; and unchanged Repo Backlog rails.
- Existing producer-to-heartbeat completion, board navigation/disclosure, progress, and hit-map tests pass.
- Merged integration tip `c987c58` before final verification, including ui-polish-001 through ui-polish-004. Autostash reapplied cleanly; no conflict resolution was needed. Preserved ui-polish-002 key notation and session vocabulary.
- `env -u PI_TMUX_SUBAGENTS_JOB_ID npm test`: **1,196 passed, 0 failed**.
- `git diff --check`: passed.

## Handoff

Commit remains on the ticket branch for parent-owned integration. No push, PR, worktree cleanup, or installed/global Hub changes were performed.
