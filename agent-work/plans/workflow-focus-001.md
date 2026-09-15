**Feature:** workflow-focus-001 → Workflow focus status
**Session:** pi-agent-hub
**Worktree:** `agent-work/worktrees/workflow-focus-001/pi-agent-hub` on branch `workflow-focus-001`
**Start branch:** `main`
**PR target:** `main`

## Goal

Make producer-reported Focus and transient compaction state visible without changing the session's operational meaning. A valid Focus decoration may appear without a workflow rail; Focus remains runtime-only presentation metadata. Compaction remains operationally visible during short heartbeat gaps. Liveness, workflow position, attention, and lifecycle/tier classification remain independent axes.

## Confirmed product decisions

- Reuse the existing producer `workflow-runtime.activeMode` wire field. Do not introduce a second producer-facing `focus` field.
- Parse and carry `activeMode` independently from the base workflow. A valid mode survives an absent or invalid workflow step list for the current fresh heartbeat.
- Render the existing producer short code (`FOC` in the example) as an indicator, not as a workflow rail or lane signal.
- Preserve transient running state during a known compaction heartbeat gap. Do not change the generic missing-heartbeat fallback for all running sessions.
- Focus is fresh-heartbeat-only and runtime-only. It must not be persisted in `registry.json`, retained across shutdown/stale/missing state, or alter ordering.

## Current state and problem

- `src/core/heartbeat.ts` parses `activeMode` only inside `workflowSnapshot()`. Because `parseWorkflowSnapshot()` requires a valid nonempty step list and active index, mode-only metadata cannot reach the dashboard.
- `src/core/types.ts` places `activeMode` on `WorkflowRuntimeSnapshot`, while `ManagedSession.workflow` deliberately strips it before persistence. The runtime controller stores the mode in a separate map, but only when a valid workflow exists.
- `src/app/controller.ts` overlays the mode onto `RuntimeSession.workflow`, so there is no representation for mode-only Focus. `src/app/explain-session.ts` repeats that overlay independently, so the CLI explanation would also miss mode-only Focus.
- `src/tui/layout.ts` derives row decoration from `session.workflow`, and therefore cannot render Focus without a workflow.
- Compaction already publishes a transient running heartbeat and restores the prior state. However, a temporarily missing/invalid heartbeat is reduced through the ordinary fallback path, which can turn a running compaction into waiting/idle and then `QUIET`.
- Existing tests cover valid workflow modes, malformed decorations, transient compaction heartbeats, and independent workflow/liveness rules, but not mode-only metadata or compaction gaps.

## Scope

### In scope

- Extend the trusted heartbeat/runtime projection so valid `activeMode` is available without a valid base workflow.
- Keep producer parsing centralized and independent: invalid mode must not hide valid workflow; invalid workflow must not hide valid mode.
- Render mode-only Focus in project rows, workflowless `OTHER ACTIVE`/board-compatible presentation where applicable, and the selected-session workspace only where the existing compact mode indicator is already appropriate.
- Add a narrowly scoped transient compaction signal and fallback retention path so known compaction remains running during a bounded heartbeat gap.
- Preserve exact current tier, ordering, attention, workflow lane, persistence, stale/shutdown, and stopped-session behavior.
- Update focused tests and durable producer/configuration and structure documentation.

### Out of scope

- New lifecycle statuses, cockpit tiers, workflow lanes, or ordering rules.
- A new producer `focus` schema or Hub interpretation of private Focus execution state.
- Persisting Focus or compaction state in the registry.
- Changing generic stale-heartbeat behavior for ordinary running sessions.
- Capturing tmux output, reading Pi conversation content, or adding another runtime store.
- Redesigning the existing workflow rail or changing producer-owned vocabulary.

## Reuse

- `src/core/heartbeat.ts` — central unknown-data validation and independent optional metadata parsing.
- `src/core/types.ts` — existing `WorkflowModeDisplay`, `Heartbeat`, `RuntimeSession`, and `HeartbeatOperation` contracts.
- `src/extension/index.ts` — one serialized atomic heartbeat writer and lifecycle/compaction event handling.
- `src/core/status.ts` — centralized liveness reduction, freshness rules, and runtime-only workflow retention.
- `src/app/controller.ts` — one observation pass, runtime overlays, and lifecycle-safe map cleanup.
- `src/tui/render-model.ts` — pure session projection and existing independent cockpit placement rules.
- `src/tui/layout.ts` — existing width-safe workflow/mode decoration, theme helpers, and workspace rendering.
- `test/heartbeat.test.ts`, `test/extension.test.ts`, `test/status.test.ts`, `test/controller.test.ts`, and `test/render-model.test.ts` — existing contract fixtures and test-first seams.
- `docs/CONFIG.md`, `docs/STRUCTURE.md`, and `docs/FEATURES.md` — existing producer contract and state-separation documentation.

No new library or service is needed. Add only small pure helpers or a transient controller field if existing shapes cannot carry the independent runtime facts safely.

## Data flow

### Mode-only Focus

```text
workflow-runtime entry
  { activeMode: { id, short, ... }, invalid-or-absent base workflow }
        │
        ▼
Hub extension extracts activeMode independently
        │
        ▼
validated heartbeat.activeMode (fresh only)
        │
        ▼
controller runtime overlay → RuntimeSession.focus/mode decoration
        │
        ▼
render model/layout → FOC indicator
        │
        └── cockpit tier and workflow lane use status/base workflow only
```

Use one runtime-only `activeMode?: WorkflowModeDisplay` field on the validated Heartbeat and RuntimeSession projections. Preserve the existing nested producer wire shape (`workflow-runtime.data.activeMode`) but make the producer adapter return `{ workflow, activeMode }`, with each member optional and independently validated. Remove/quarantine `activeMode` from the normalized `WorkflowRuntimeSnapshot` representation so `ManagedSession.workflow` remains mode-free and all consumers use `Heartbeat.activeMode`/`RuntimeSession.activeMode`; do not synthesize an empty workflow. Reuse the existing controller `workflowModes` map, renaming only if clarity requires it. Update `src/app/explain-session.ts` through the same projection rule so `pi-hub explain` and the TUI agree.

### Compaction gap

```text
session_before_compact
        │
        ▼
extension publishes bounded compaction-running signal + running heartbeat
        │
        ├─ fresh heartbeat → normal running reduction
        └─ brief missing/incomplete heartbeat → controller retains running
              │
              └─ fresh completion/restore or bounded expiry clears signal
```

The signal must be transient, session-ID scoped, and never persisted. Because a heartbeat-only signal cannot be read after the file disappears, keep a controller-side cache such as `{ tmuxSession, seenAt, expiresAt }` populated only by a fresh valid `compact/running` heartbeat, with an explicit bounded TTL (use the existing heartbeat-staleness window unless implementation evidence requires a smaller constant). Pass that fact into `computeStatus` through `StatusInput` and give the resulting decision a dedicated evidence reason; do not label retained compaction as ordinary fallback activity. Retain only for an absent/invalid heartbeat while the same tmux target is present. Clear on a fresh non-compaction lifecycle state, explicit error/shutdown, missing tmux, target change, expiry, row removal, and controller teardown. It must not promote a child or create attention.

## Implementation Phases

### Phase 1: Lock down independent metadata contracts

- [x] Add failing heartbeat parser tests for valid `activeMode` with no workflow, valid workflow with invalid mode, invalid workflow with valid mode, and mode bounds/blank-field rejection.
- [x] Add the smallest shared type shape for a runtime-only mode separate from the persisted base workflow, while preserving the existing producer `activeMode` field.
- [x] Refactor `src/core/heartbeat.ts` and the extension's workflow entry adapter so base workflow and mode are parsed independently from the same latest producer entry.
- [x] Add failing controller and CLI explanation tests proving fresh confirmed mode-only metadata appears in runtime snapshots and `pi-hub explain`, is absent from persisted registry rows, and clears on stale, shutdown, missing heartbeat, or missing tmux.
- [x] Make `src/app/controller.ts` and `src/app/explain-session.ts` project the independent mode without changing status reduction or workflow persistence; use one shared pure projection helper if needed to prevent drift.
- [x] Run the focused heartbeat/controller/explain test files and typecheck.

**Verification strategy:** Use realistic producer entries and complete heartbeat envelopes. Confirm malformed optional metadata never invalidates liveness, and inspect persisted JSON to prove no mode-only field leaks into the registry. Confirm all stale/shutdown/missing paths clear the transient mode.

### Phase 2: Render mode-only Focus without classification coupling

- [x] Add failing render-model/layout tests for a waiting, running, idle, error, and stopped session with mode-only `FOC` metadata.
- [x] Extend `RenderSession` and `toRenderSession()` with the independent runtime `activeMode`, or use the smallest equivalent render field; do not manufacture workflow steps.
- [x] Update row adornment fitting and workspace mode helpers in `src/tui/layout.ts` to render `FOC` when valid on Active/Quiet project rows and selected-session workspace content, while retaining current workflow rail behavior when a base workflow exists. Preserve existing Backlog/Archived ladder suppression and stopped-session suppression unless a test demonstrates a required exception.
- [x] Verify a running mode-only parent appears once in the stage board's `OTHER ACTIVE` lane, while mode-only rows remain in their status-derived project tier and do not enter a producer workflow lane.
- [x] Verify mode-only rows do not affect status counts, ordering, or attention.
- [x] Verify width fitting keeps the existing hidden-request/descendant priority and drops Focus before higher-priority operational context when space is constrained.
- [x] Run focused render, cockpit, and status tests plus typecheck.

**Verification strategy:** Assert rendered text and tier/lane projections together. Test narrow and wide layouts, selected workspace rendering, explicit attention, child activity, backlog, archived, and stopped cases. Confirm Focus is an indicator only and cannot create `ACTIVE`, `QUIET`, `NEEDS YOU`, or a workflow lane.

### Phase 3: Make compaction gaps operationally visible

- [x] Define the normal-compaction wire contract before coding: add `HeartbeatOperation` kind `compact` with a bounded generated id and phases `running` and `complete`; `running` is emitted by `session_before_compact`, and completion is represented by the restored heartbeat with the operation omitted (or the one-shot `complete` phase if the existing writer needs it). Preserve the separate `fork-compact` kind and its `running`/`complete`/`error` phases.
- [x] Add failing extension and heartbeat-parser tests for the normal-compaction operation/signal, including parser acceptance and bounded phase/id validation; preserve existing `fork-compact` semantics.
- [x] Define exact normal-compaction clear paths from observable events: completion restores the prior state, `willRetry` clears the signal while leaving continuation running, `agent_start`/`agent_end` supersede it, the watchdog expires it, and shutdown clears it. Do not invent a normal-compaction error phase that Pi cannot report; retain fork-compaction error handling separately.
- [x] Update `src/extension/index.ts` to publish and clear the signal through the existing serialized heartbeat chain and lifecycle handlers.
- [x] Add failing status/controller tests for a fresh compaction signal, a temporarily missing/incomplete heartbeat, a fresh restored heartbeat, timeout/expiry, explicit heartbeat error, and shutdown.
- [x] Add the controller-side `{ tmuxSession, seenAt, expiresAt }` cache with a bounded TTL, pass its active state into `computeStatus`, add a dedicated `RuntimeStatusReason`/evidence path, and preserve `running` only for the known bounded compaction signal. Retain only when the heartbeat is absent/invalid but the same tmux target is still present; clear on missing tmux, target changes, expiry, explicit errors/shutdown, row removal, and teardown. Keep ordinary missing-heartbeat fallback unchanged.
- [x] Update `src/tui/status-evidence.ts` so the retained-compaction reason has clear workspace wording, include that reason in the useful-result allowlist, and add assertions that it appears in the selected workspace. Do not promise retained-compaction evidence in `pi-hub explain` unless an explicit equivalent cache is added; the CLI explanation continues to cover fresh status evidence and mode-only Focus.
- [x] Confirm compaction state does not advance `lastActivityAt` or alter acknowledgement, workflow, attention, lifecycle bucket, or ordering.
- [x] Run extension, status, controller, cockpit, workspace, and explanation tests; then run the full test suite and typecheck.

**Verification strategy:** Exercise lifecycle events through the extension test harness, then feed the resulting snapshots into the status/controller reducer. Check both heartbeat-present and heartbeat-gap paths. Verify the selected session remains visibly operational and never becomes `QUIET` solely due to the transient gap, while ordinary heartbeat loss retains existing behavior.

### Phase 4: Documentation and final regression pass

- [x] Update `docs/CONFIG.md` to document `activeMode` as an independently validated, fresh runtime decoration that may exist without a workflow rail, with one normalized runtime representation, and document the bounded compaction signal and its observable clear paths.
- [x] Update `docs/FEATURES.md` with the user-visible `FOC` indicator and explicit statement that Focus does not change lane, tier, ordering, or lifecycle.
- [x] Update `docs/STRUCTURE.md` to describe independent mode projection and bounded compaction-gap handling without coupling either to persistence or placement.
- [x] Update generated system documentation only if the repository's normal documentation workflow requires it; do not hand-edit generated atlas output unless its source data is changed.
- [x] Review the diff for unnecessary abstractions, duplicated parsing, persistence leaks, and stale terminology.
- [x] Run `npm run typecheck` and `npm test` serially; do not run package checks concurrently with tests.

**Verification strategy:** Read the resulting docs against the implemented data flow. The final regression suite must cover parser isolation, runtime overlay lifecycle, width-safe presentation, tier/lane independence, and compaction fallback behavior.

## Material plan adjustments

- The normalized runtime projection now uses `Heartbeat.activeMode` and `RuntimeSession.activeMode`. The low-level `parseWorkflowEntry`/`parseWorkflowSnapshot` adapters retain the legacy nested `activeMode` shape for direct parser compatibility, while `parseWorkflowRuntime` strips it before extension/controller projection. Persisted workflow state remains mode-free.
- Retained compaction evidence is available through the dashboard controller cache. `pi-hub explain` does not claim gap-retained evidence because it has no long-lived controller cache; it still reports fresh mode-only Focus and fresh runtime evidence.

## Reflection Candidates

- Clarify the producer contract wording around `activeMode` versus the user-facing Focus label.
- Document the bounded lifetime and precedence of transient compaction evidence if it becomes a reusable runtime operation pattern.
- Consider whether the generated system atlas should gain a separate Focus/operation data-flow node after implementation, but avoid expanding architecture artifacts unless the source model changes.

## Discovered Work

- None at planning time.
