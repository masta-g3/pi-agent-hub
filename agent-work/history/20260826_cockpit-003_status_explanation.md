# Status explanation

**Feature:** cockpit-003 → Status explanation
**Session:** 01a035c3-86d4-7e3b-af2c-8533e911aec8
**Worktree:** none
**Completed:** 2026-08-26

## Outcome

Every displayed runtime status and cockpit placement now has a readable causal explanation. Pressing `i` shows the explanation in expanded details at 80+ columns or in a gated full-width Info screen at 40–79 columns. `pi-hub explain <exact-id-or-unique-prefix>` prints the same vocabulary after one live, read-only fleet observation.

Evidence remains transient. It does not persist to `registry.json`, infer attention, create status history, or couple workflow position to liveness or cockpit placement.

## Implemented Contract

### Runtime evidence

`computeStatus()` remains the single liveness reducer and now emits structured `RuntimeStatusEvidence` from the branch that makes each decision. Evidence records:

- tmux presence, absence, or unknown observation;
- heartbeat presence, freshness, Pi state, timestamps, and error message;
- acknowledgement relation;
- the reducer reason, including missing/stale heartbeat fallback branches;
- independent fresh, retained, or absent workflow provenance.

`SessionsController` overlays evidence only on `RuntimeSession`. A causal fingerprint covers tmux identity, status, error, acknowledgement, and retained workflow. Title, group, and order changes retain valid evidence; acknowledgement and other causal mutations invalidate it. Evidence is never serialized.

### Cockpit placement evidence

The existing full-fleet cockpit classifier now emits the decisive placement reason from the same branch that assigns the tier:

- lifecycle-owned Archived;
- explicit owner attention;
- owner error;
- starting/running owner;
- starting/running descendant;
- quiet fallback.

Placement remains presentation-only. Descendants inherit the owner's placement without changing their status, attention, workflow, or lifecycle. Child attention and errors do not promote the owner. When several descendants are active, cached descendant order chooses the first driver deterministically for both TUI and CLI explanations.

### Shared observation and formatting

`src/app/session-observation.ts` owns the shared read-only fleet observation used by controller refresh and CLI inspection. It performs one bulk tmux presence snapshot and validated heartbeat reads without registry mutation, pruning, or title ownership.

`src/tui/status-evidence.ts` is the semantic wording source for themed TUI output and plain CLI output. It explains runtime cause and cockpit placement while keeping workflow provenance separate. Styled output reuses existing status and cockpit tones and remains ANSI width-safe.

### Responsive Info interaction

- At 80+ columns, `i` toggles the evidence block in existing expanded details.
- At 40–79 columns, `i` opens a full-width Info screen bound to the selected session ID.
- While narrow Info is open, only `i` and `Escape` act.
- Selection repair closes stale Info instead of explaining another row.
- Missing evidence requests the existing serialized refresh and opens only after matching evidence arrives; refresh failures remain visible.
- Synthetic Archived/disclosure targets cannot open stale session information.
- Compact rows, cockpit frames, stage lanes, card density, navigation targets, and preview behavior remain unchanged.

### CLI

`pi-hub explain <session-id-or-prefix>`:

- prefers an exact ID, then accepts one unique prefix;
- returns bounded candidates for ambiguous prefixes;
- observes the complete fleet once so owner/descendant placement matches the dashboard;
- reports unknown tmux observation distinctly from a missing session;
- prints session identity, tmux, heartbeat, read state, runtime result, cockpit reason, and workflow provenance;
- never calls `updateRegistry()` or changes registry bytes/timestamps.

## Review Fixes

Three code-review passes resolved:

- missing semantic use of reducer reasons in fallback explanations;
- Info opening after a refresh that failed or returned no matching evidence;
- narrow Info following a repaired selection because it was stored as a boolean;
- explicit refresh failures being swallowed by the periodic refresh loop;
- wide/narrow resize and Escape regressions;
- missing semantic status and cockpit-tier tones in themed result lines.

The final code critic returned `LGTM`. Documentation review removed duplicate architecture guidance and clarified that runtime evidence belongs to runtime projections while placement evidence belongs to render projections.

## Verification

- `npm run typecheck`
- `git diff --check`
- temporary TypeScript compilation outside repository `dist`
- full compiled suite: **758 passed, 0 failed**
- functional subagent validation of wide/narrow explanations, action gating, theme/width safety, deterministic descendant choice, exact/prefix/ambiguous CLI resolution, and registry read-only behavior
- manual 60/100/160-column inspection
- live `pi-hub explain` smoke test

The linked dashboard was rebuilt only after explicit approval; review verification continued through temporary compiler output.

## Durable Documentation

Updated:

- `README.md`
- `docs/FEATURES.md`
- `docs/STRUCTURE.md`
- `AGENTS.md`

These documents now cover responsive `i` behavior, read-only CLI diagnostics, transient evidence, shared observation, causal invalidation, and decision-source ownership.

## Discovered Work

- `TmuxState.recentActivityMs` and `TMUX_ACTIVE_MS` still support a reducer fallback, but production dashboard observation supplies presence only. A separate product/API decision is required before wiring or removing activity observation.
- Status transition history and notification delivery remain separate cockpit work. This feature explains one current observation only.
