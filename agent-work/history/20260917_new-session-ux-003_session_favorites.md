# new-session-ux-003 — Session favorites

**Feature:** Session favorites
**Session:** 01a0ace0-001a-7482-83eb-9c15aaab2503
**Worktree:** none; implemented on `main`

## Outcome

Hub's New session form now supports named, ordered directory favorites and presents a compact, stable keyboard form whose control types are visible before focus.

- A favorite stores a stable ID, a group-compatible name, and normalized absolute directories with Primary first.
- Favorites live in `<global-state>/session-favorites.json`, separate from bounded recent-directory history.
- Load, save, explicit update, rename, and confirmed removal use atomic locked mutations.
- Loading replaces draft directories and seeds the editable Group from the favorite name. It preserves worktree and branch settings and never launches a session.
- Editing a loaded set marks it as edited without automatic write-back.
- Missing paths remain visible; Hub does not scan the filesystem or require Git for ordinary directories.

## Form behavior

- Bracketed directory and option values identify text inputs; `▾` identifies the favorite picker; actions are separated below fields.
- Options remain collapsed by default but always summarize Group and worktree/branch state.
- `Enter` advances from editable fields and activates focused controls. Worktree toggles on Enter/Space.
- The explicit Create action or `Ctrl+Y` submits. Existing direct keys remain available: `Ctrl+F` favorites, `Ctrl+S` save, `Ctrl+R` add directory, `Ctrl+X` remove additional directory, `Ctrl+O` recent-directory picker, `Ctrl+N/P` suggestions, `Ctrl+G` Group, `Ctrl+T` worktree, and `Ctrl+L` Branch.
- Compact forms reserve one fixed help/error line. Focus changes do not shift control rows.
- Focused controls, errors, picker selection, footers, and Unicode path tails remain visible within narrow and short terminals.

## Implementation

- Added `src/core/session-favorites.ts` and the `sessionFavoritesPath()` state path.
- Added the favorites dialog family and narrowly typed TUI actions.
- Extended the existing new-session form, `renderForm()`, and recent-directory picker instead of adding a wizard or parallel form framework.
- Reused `atomic-json`, `normalizeAdditionalCwds`, `normalizeGroup`, cursor-aware input primitives, theme tokens, and existing session submission/lifecycle behavior.
- Kept registry, session launch, worktree lifecycle, Skills/MCP targeting, and dashboard refresh behavior unchanged.

## Verification

- Baseline typecheck and 240 focused existing tests passed.
- Temporary test-first checks covered store validation/concurrency, draft copy semantics, async stale completions, full keyboard workflows, Unicode paths, responsive layouts, and fixed focus coordinates.
- Final combined feature-only staging preserved the installed Conversation workspace: **985 tests passed**, package check passed.
- Code and docs critics ended with LGTM after fixing display-column-safe Unicode tail truncation and three documentation clarifications.
- Real installed TUI checks passed at 80×24 and 40×12. Eight form controls kept identical screen coordinates before and after arrow navigation.
- Installed tarball SHA-256: `64d684719da42ead48cf0f3798df4e2515e2a0ae4e1405a3528070a2dbbb9af3`.

Detailed installation and validation evidence remains in `agent-work/tickets/new-session-ux-003/validation.md`.
