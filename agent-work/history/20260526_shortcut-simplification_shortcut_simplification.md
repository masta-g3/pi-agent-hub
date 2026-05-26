**Feature:** shortcut-simplification → Simplify command-center shortcuts, dialogs, and help/docs.

## Summary

Updated `pi-hub` shortcut behavior and presentation so common dashboard actions are easier to discover and consistently documented.

Implemented behavior:

- `n` creates a new session.
- `r` opens restart choices; inside the dialog, `r` restarts the selected session, `n` starts a new Pi conversation in the same hub session, `a` restarts all non-subagent sessions, and `Esc` cancels.
- `R` renames the selected session; hidden `e` remains a rename alias.
- `N` syncs the selected hub title from Pi's `/name`; `Alt+N` remains a compatibility alias.
- Delete/worktree dialogs now show only available actions, use consistent option styling, and allow `w` to finish/merge eligible hub-owned worktree sessions from the delete dialog.
- Dashboard footer and help were aligned around common actions; `w Finish WT` appears only for hub-owned worktree sessions.
- New-session form hints and footer copy are context-aware for repo, extra repo, title/group, and worktree fields.
- Skills/MCP pickers support `←`/`→` for Enabled/Available column switching while keeping `Tab` as an alias.

Durable docs/guidance updated:

- `README.md` quick shortcut table.
- `docs/FEATURES.md` shortcut and picker reference.
- `docs/STRUCTURE.md` contributor notes for session shortcut behavior.
- `AGENTS.md` project-local guidance for future agents.

Validation:

- `npx tsc -p tsconfig.json --noEmit`
- `npm test` — 335 passing
