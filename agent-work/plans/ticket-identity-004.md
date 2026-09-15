**Feature:** ticket-identity-004 → Ticket identity, title, and unlinking
**Session:** pi-agent-hub
**Worktree:** `agent-work/worktrees/ticket-identity-004/pi-agent-hub` on branch `ticket-identity-004`
**Start branch:** `main`
**PR target:** `main`

## Goal

Make ticket/session identity understandable and reversible.

Product decisions confirmed during planning:

- Hub session title and producer ticket identity stay independent.
- Pi owns the session title. The producer owns ticket identity.
- Unlink is an explicit Hub action.
- Hub sends the producer command `/wf-clear` to the exact managed Pi session.
- The producer clear removes both workflow ticket metadata and generic ticket context.
- Hub does not edit Pi conversation history or remove custom entries itself.
- The existing workflow-ticket precedence rule stays authoritative when sources disagree.

Example:

```text
Hub title:   API cleanup
Ticket:      ENG-42
After unlink:
Hub title:   API cleanup
Ticket:      none
```

## Current state and problem

- `ManagedSession.title` is a cached Pi native session name. New sessions use the primary repository basename. `/name`, `R`, and `N` manage this title.
- Generic producer context stores `ticket.id`, `subtitle`, and `description` in a heartbeat-only runtime projection.
- Workflow runtime stores `workflow.ticketId`; its base workflow can be retained in the registry.
- `src/tui/render-model.ts` already gives `workflow.ticketId` precedence and suppresses generic subtitle/description on an ID conflict.
- `src/app/side-pane-lifecycle.ts` currently selects generic context ticket before workflow ticket, so pane chrome can show the wrong ticket.
- Search and filtering read both raw metadata sources rather than one shared canonical ticket projection.
- Fork-and-compact already ignores inherited context and workflow entries using `metadataResetAt`, resets the Pi name to the primary repository basename, and compacts without custom instructions. This behavior must remain and be tested as the same clear result: no inherited ticket identity.
- There is no general unlink command or action.
- The current metadata contract has no producer ticket-name field. Do not add title coupling or infer a title from ticket subtitle/description.

## Scope

### In scope

- One documented precedence rule for title, generic ticket identity, and workflow ticket identity.
- One shared canonical ticket projection used by workspace, rows, search, filter matching, and pane chrome.
- Explicit `Unlink ticket` action in the selected-session workspace and action palette.
- Exact-session `/wf-clear` dispatch through existing tmux/send-message boundaries.
- Availability and disabled behavior for sessions that have no ticket, are not live, or lack send transport.
- Producer-driven clearing of both ticket sources.
- Fork-and-compact tests and any small refactor needed to keep its clearing semantics aligned.
- Tests and durable documentation.

### Out of scope

- Automatic title changes from ticket names.
- A new ticket-name field in producer metadata.
- Hub edits to Pi branch history or conversation files.
- Hub-side suppression markers or ticket metadata persistence in `registry.json`.
- Generic producer support beyond the agreed `/wf-clear` command.
- Changes to workflow lane vocabulary, status, attention, or lifecycle behavior.

## Identity contract

Document and implement this rule:

1. **Session title:** `heartbeat.piSessionName`, cached as `ManagedSession.title`; provisional fallback is the primary repository basename. It is independent from ticket identity.
2. **Ticket ID:** use `workflow.ticketId` when present. Otherwise use `context.ticket.id`.
3. **Ticket details:** use context subtitle/description only when its ticket ID matches the selected canonical ticket ID. If workflow and context IDs conflict, show only the workflow ID.
4. **Unlinked state:** after a fresh producer heartbeat with `/wf-clear`, both ticket sources are absent. The title remains unchanged.
5. **Fork-and-compact:** the new Pi session keeps its repo-based title reset and ignores inherited workflow/context metadata until newer producer metadata is published. It has no inherited ticket.

The identity contract must be phrased in user terms in `docs/CONFIG.md` and `docs/FEATURES.md`, with implementation ownership noted in `docs/STRUCTURE.md`.

## Reuse

- `src/core/types.ts` — existing `ManagedSession`, `RuntimeSession`, heartbeat, workflow, and context types.
- `src/core/session-context.ts` — bounded generic context parsing.
- `src/core/heartbeat.ts` — heartbeat validation and workflow parsing.
- `src/app/controller.ts` — runtime-only context overlay and fresh heartbeat clearing.
- `src/tui/render-model.ts` — existing ticket display precedence and pure projection.
- `src/core/session-tree.ts` — existing bounded search/filter field composition.
- `src/tui/dashboard-commands.ts` — shared action catalog, palette, exact target IDs, and availability guards.
- Existing send-message action and `src/core/tmux.ts` — exact managed-session message transport; do not add another shelling path.
- `src/tui/form-dialogs.ts`, `src/tui/layout.ts`, and workspace rendering — existing workspace/action presentation.
- `src/app/session-lifecycle.ts` and `src/extension/index.ts` — existing fork-and-compact metadata reset behavior.
- Existing `updateRegistry()` and controller runtime maps — no new metadata store.

New abstraction justification: add a small `src/core/ticket-identity.ts` only if the current shared modules cannot safely host the rule. It should contain pure types/functions for canonical ticket selection and matching. This is justified because row rendering, search, workspace, and pane chrome currently duplicate source selection and already disagree. Do not add a service, class, or persistence layer.

## Data flow

```text
Producer `/wf-clear`
        │ exact send-message transport
        ▼
Pi producer writes a new empty context/workflow snapshot
        │
Hub extension reads latest valid branch entries
        ▼
heartbeat: context absent + workflow ticket absent
        ▼
controller runtime overlay clears context
        ▼
canonical ticket projection returns no ticket
        ▼
rows · workspace · search · pane chrome show no ticket
```

For a conflicting heartbeat:

```text
workflow.ticketId = ENG-42
context.ticket.id = OLD-7
             │
             └── canonical ticket = ENG-42
                 no context subtitle/description
```

## Implementation Phases

### Phase 1: Lock the identity contract with pure tests

- [ ] Add failing unit tests for canonical ticket selection:
  - workflow ID wins over a different context ID;
  - matching context supplies subtitle/description;
  - context supplies the ID when workflow has none;
  - no sources returns an unlinked result;
  - title is never derived from ticket data.
- [ ] Add failing tests for the shared searchable ticket fields. A conflicting, non-authoritative context ticket must not become the displayed/searchable ticket identity.
- [ ] Implement the smallest pure canonical projection in `src/core/ticket-identity.ts`, or move the existing pure logic there if a suitable existing location is found.
- [ ] Replace `render-model.ts` ticket selection with the shared function.
- [ ] Verify pure logic with realistic runtime sessions and edge cases.

**Verification:** Run the focused ticket/render/search tests. Confirm the same canonical ID and details are returned for every input shape. Confirm no title mutation occurs.

### Phase 2: Add explicit unlink dispatch

- [ ] Add failing command-catalog tests for `Unlink ticket`:
  - available only for a live, ticketed, main session with send transport;
  - disabled with a clear reason when no ticket exists, the session is stopped/error, or transport is unavailable;
  - command carries the exact selected session ID;
  - palette and workspace use the same descriptor.
- [ ] Add the action descriptor in `src/tui/dashboard-commands.ts` using the existing command catalog and availability guard.
- [ ] Route execution through the existing exact-target send-message action with literal `/wf-clear`.
- [ ] Keep the action out of subagent lifecycle behavior unless the existing send boundary explicitly supports it; subagent rows must not gain normal session-management actions by accident.
- [ ] Add a focused controller/view test that dispatches unlink for session A while session B is selected afterward; the command must still target A.
- [ ] Add a concise success message that says the clear request was sent, not that metadata has already disappeared.

**Verification:** Exercise direct action, workspace action, and palette action. Confirm all paths send exactly `/wf-clear` to the bound session and do not delete, restart, rename, or acknowledge the session.

### Phase 3: Make every display surface use the canonical identity

- [ ] Add failing render tests for rows, action workspace, full-width workspace, and pinned decision content after unlink.
- [ ] Replace the ticket lookup in `src/app/side-pane-lifecycle.ts` with the shared canonical projection so workflow ID wins over generic context.
- [ ] Update sidebar pane title/context formatting to omit ticket text when the canonical projection is empty.
- [ ] Update `src/core/session-tree.ts` filter matching to use canonical ticket ID/details rather than independently exposing a stale conflicting source.
- [ ] Update `src/tui/dashboard-commands.ts` session search hints/text to use the same projection.
- [ ] Preserve title display after unlink. A title such as `API cleanup` must remain `API cleanup`, with no blank placeholder or ticket-derived replacement.
- [ ] Add tests for stale-to-cleared runtime overlays: after a fresh heartbeat without context/workflow ticket, workspace, search, and pane identity contain no old ticket.

**Verification:** Render the same session before and after clear at wide, narrow, workspace, and pinned layouts. Search by the old ticket after clear and confirm no result is returned because of ticket metadata. Test conflicting source IDs and confirm every surface shows the workflow ID only.

### Phase 4: Align fork-and-compact clearing semantics

- [ ] Add or strengthen failing tests that compare fork-and-compact with unlink semantics:
  - inherited generic context is absent;
  - inherited workflow ticket is absent;
  - the new title is the primary repository basename, not the source title or ticket;
  - later producer metadata can appear after the reset watermark;
  - the source session remains unchanged.
- [ ] Extract only a small shared predicate/helper if needed to describe “no inherited ticket metadata”; do not merge fork lifecycle code with producer command dispatch.
- [ ] Keep fork-and-compact’s current one-shot marker, compaction, and no-custom-instructions behavior.
- [ ] Verify the producer clear path and fork reset path both produce the same visible unlinked state without deleting the managed session.

**Verification:** Run extension, heartbeat, lifecycle, and session-command tests. Confirm fork-and-compact does not send `/wf-clear` to the source and does not mutate source registry or conversation state.

### Phase 5: Document and run the full regression suite

- [ ] Update `docs/CONFIG.md` with the title/ticket precedence rule, `/wf-clear` producer boundary, and clear-both-sources behavior.
- [ ] Update `docs/FEATURES.md` with the user-visible `Unlink ticket` action and examples.
- [ ] Update `docs/STRUCTURE.md` to name the canonical ticket projection and explain that Hub does not edit Pi history.
- [ ] Add help/palette wording only through `src/tui/dashboard-commands.ts`; do not create a parallel command table.
- [ ] Run `npm run typecheck` and the focused tests.
- [ ] Run `npm test` from the worktree after focused tests pass.
- [ ] Review `git diff` and verify no unrelated files are changed.

**Verification:** Full tests pass. The docs and code describe one rule. A manual smoke check confirms: title remains stable, `/wf-clear` is sent once, fresh state has no ticket in rows/workspace/search/pane chrome, and the session still exists.

## Design direction

Keep the UI small and explicit.

- Action label: **Unlink ticket**.
- Hint: `send /wf-clear; keep this session`.
- Success message: `ticket clear sent → <session title>`.
- No new dialog unless the existing send-message path requires confirmation for slash commands.
- Use existing command/workspace styles and theme tokens. Do not add colors or hard-coded ANSI values.
- The title stays the primary identity. Ticket ID remains secondary metadata, shown as `#ENG-42` where width permits.
- After unlink, omit ticket rows entirely. Do not show `ticket: none` in normal rows or workspace.

## Risks and boundaries

- `/wf-clear` must be supported by the producer. If the producer does not recognize it, Hub can only report that the command was sent; it must not claim success from a local guess.
- A stale heartbeat can temporarily retain old metadata. The UI must follow the existing freshness/runtime overlay rules and clear only after a valid fresh heartbeat confirms absence.
- The producer may publish workflow and context at different times. The canonical rule must prevent a temporary conflicting context value from appearing as the displayed ticket.
- Do not solve stale metadata by deleting Pi conversation files or mutating the Pi branch.

## Reflection Candidates

- `docs/CONFIG.md`: identity ownership, precedence, and producer clear protocol.
- `docs/FEATURES.md`: user-facing unlink action and fork-and-compact behavior.
- `docs/STRUCTURE.md`: shared canonical ticket projection and exact-target action flow.
- `AGENTS.md`: only if implementation reveals a durable rule not already covered by current guidance.

## Discovered Work

- No producer ticket-name field exists. Automatic title coupling remains intentionally out of scope.
- No tracked `Ticket 4` entry exists in `agent-work/features.yaml`; this plan uses the local ID `ticket-identity-004` without changing the existing backlog during planning.
