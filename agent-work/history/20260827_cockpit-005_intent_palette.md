# Intent palette

**Feature:** cockpit-005 → Intent palette
**Session:** 01a035c3-86d4-7e3b-af2c-8533e911aec8
**Worktree:** none
**Completed:** 2026-08-27

## Outcome

One shared command catalog now drives catalog-owned direct keys, the searchable `:` palette, dashboard Help, configured shortcuts, and stable footer controls. Maintainers can discover target-aware actions, search sessions through bounded Hub context, apply named filters, and select/reveal exact sessions without leaving Hub.

Direct bindings remain available, including `?` Help and `/` free-text filtering. Disabled actions stay visible with concise reasons and cannot execute from either direct keys or the palette.

## Implemented Contract

### Shared command model

`src/tui/dashboard-commands.ts` is a pure descriptor catalog with fixed order: selected-target actions, configured actions, sessions, named filters, then views/Help. Descriptors carry stable namespaced IDs, all retained binding aliases, display/search metadata, capability-dependent availability, disabled reasons, and exact target identity when contextual.

`SessionsView` resolves catalog-owned direct keys and palette activation through one execution path. Modal, text-editing, busy, narrow-Info, pending-choice, disclosure, and mouse precedence remain authoritative. Every invocation path honors the same availability check.

### Target safety

Selected-target and configured-action IDs include the exact session identity and are rebuilt and revalidated before execution. Fork, move-group, rename-session, rename-group, reorder, and acknowledgement operations retain explicit targets rather than rereading later selection.

Skills/MCP pickers capture the exact session/project before asynchronous loading, retain it through apply, revalidate the primary cwd, and use dashboard cwd only when no session was selected. Selection changes cannot redirect writes to another session or project.

### Palette and bounded search

`src/tui/command-palette-dialog.ts` implements a bottom-anchored terminal ledger with cursor-aware deterministic substring search, wrapped keyboard navigation, Ctrl+P/Ctrl+N, height-bounded windowing, mouse ownership, ANSI-safe rendering, and explicit short-terminal behavior. Below 40 columns, the existing narrow notice remains authoritative and `:` is inert.

Session search composes the existing bounded `matchesFilter()` fields for session/project identity, groups, subagent identity/task, lifecycle/status, ticket/attention metadata, and producer workflow context. It never searches raw pane output, previews, Pi conversations, or persistent history. Results follow the unfiltered cockpit projection before hidden rows are appended.

### Safe session activation and filters

Activating a session result stays in Hub. It re-resolves the exact current ID, clears a fleet filter only when that filter excludes the target, selects it, calls the existing selection callback, and never attaches, restarts, or acknowledges.

An ephemeral projection-only reveal identity can expose one collapsed tree or older Archived cascade. Stage results enter project grouping only in memory. Neither grouping nor Archived disclosure is persisted, unrelated archives remain hidden, and later navigation/view changes clear the reveal.

Named filters reuse `SessionsController.setFilter()` for lifecycle, runtime status, and current groups. Palette Escape preserves the existing fleet filter. Valid configured one-line dashboard sends appear only for live parent sessions and retain their existing transport safety.

### Discovery surface

Dashboard footers now show stable daily controls instead of the full key maze. Dashboard Help and footer presentation derive catalog-owned labels and bindings from the same descriptors while form/picker guidance remains family-owned. `:` is reserved and conflicting configured shortcuts are rejected.

## Review Fixes

Three code-review passes resolved:

- direct keys bypassing disabled catalog availability;
- palette sessions following registry or active-filter order instead of canonical unfiltered cockpit order;
- missing movement/filter controls in the 40–59-column footer;
- side-pane availability being modeled too broadly instead of per reset/assign/close/focus capability;
- ANSI-width padding and very-short-height palette rendering edge cases;
- no-selection Skills/MCP fallback using an empty path instead of dashboard cwd.

The final code critic returned `LGTM`. Two documentation reviews clarified the complete bounded-search categories and fixed command-category order.

## Verification

- `npm run typecheck`
- `git diff --check`
- temporary TypeScript compilation outside repository `dist`
- full compiled suite: **795 passed, 0 failed**
- independent functional checks at 40/60/100/160 columns
- independent short-height matrix across 28 width/height combinations
- final code critic: `LGTM`
- final docs critic: `LGTM`

The linked development package was rebuilt and reinstalled only after explicit approval.

## Durable Documentation

Updated:

- `README.md`
- `docs/FEATURES.md`
- `docs/CONFIG.md`
- `docs/STRUCTURE.md`
- `AGENTS.md`

These documents now cover `:` discovery, retained direct keys, disabled-action behavior, bounded search, select-not-open session results, exact target binding, reserved shortcut configuration, command-catalog ownership, and input precedence.

## Discovered Work

- `cockpit-006` should consume the exported action descriptors for its contextual action block rather than derive a second table.
- `cockpit-007` should replace numbered panel descriptors with named pin/focus/close commands without changing palette infrastructure.
- `cockpit-008` should remove density descriptors and update the stable footer after adaptive rendering lands.
- `cockpit-004` may add a transient locate-request command through the catalog capability seam.
- `cockpit-009` owns empty-fleet onboarding and doctor guidance; this feature supplies only the global New and Help commands.
