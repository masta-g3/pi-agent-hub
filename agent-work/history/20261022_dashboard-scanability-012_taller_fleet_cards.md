**Feature:** dashboard-scanability-012 → Taller fleet cards
**Session:** 01a15c2f-88e7-7157-a3d7-dd39057dd039
**Worktree:** none
**Start branch:** main
**PR target:** main

## Outcome

At 100+ columns, Active fleet parent cards in the IDE-style cockpit show more per-session context without selection. All of it comes from data Hub already held, with no new state or setting.

```
│ ▾   ◐ Dashboard UI polish
│ [Pi Agent Hub] ⚙︎1 3/8 tasks · 8m                ✓   ◉   ·
│ writing plan (pass 2) · Phase 2/4 · Tests         ← activity line
│ ◈ pi-agent-hub ⎇ feat/taller-cards                ← repo line
│ ├─   ⠋ code-critic Review cockpit hierarchy geometry
                                                    ← spacer (only when the whole fleet fits)
```

- **Activity line:** the workflow activity label and pass, plus the execute-step plan phase. It is omitted for stopped rows and once `currentStepComplete` is true, because the grid checkmark already says the step is done (for example "Commit complete").
- **Repo line:** a dim `◈` plus the repo label in the accent color, then `⎇ branch`. The branch comes from the Hub-owned worktree, else the primary producer `worktreeLifecycle` repository that is not `cleaned`. In Repo grouping only the branch shows. The line is omitted when empty.
- **Spacer:** one untracked blank line between parent cards inside a group. `renderSessions()` rebuilds the list without spacers when the spaced list exceeds the body. Spacers therefore never enter windowing, gutters, selection painting, or hit maps.
- **Height:** windowing is unchanged and selection-first, so the selected card stays whole. Neighbor cards drop activity, then repo, then request or ticket text. Title and metadata stay together.
- **Tier labels:** Status grouping no longer prints `quiet` on metadata lines or `backlog · quiet` row tails, because the tier heading carries it. Repo grouping keeps its tier labels.
- **Unchanged:** below 100 columns, pin mode, Conversation compaction, the board, Backlog, Archived, and subagent rows. The `■□` progress bar stays board-only.

## Decisions

- All three additions in one ticket. Repo and activity are separate lines.
- The user accepted the selection-first trade-off: on crowded panes, up to two fewer neighbor titles fit.
- Live review (user-approved) hid completed-step activity, added producer worktree branches, and removed per-row `quiet` in Status grouping.
- In the "Session List Organization" session, the user later replaced repo-equals-group hiding with an always-shown accent `◈` repo slot, because groups mark multi-repo projects. Activity now drops before repo. That change is included in this commit.

## Verification

- New `test/fleet-cards.test.ts` covers line order, variants, spacer rules, drop order, crowded panes, and width at 100–220 columns. Existing tests were adjusted only where they encoded the old card height or loose line finders. Frame fixtures were regenerated.
- Commit tree (HEAD plus this feature only, built in clean staging): `npm test` 1112/1112 and typecheck clean. Full checkout with other sessions' pending work: 1131/1131.
- A feature-only global install differed from the prior install only in `layout.js`.

## Reflection outcomes

- Loose test line finders matched the navigator or footer after the height change. Three tests were fixed in place; no rule was added.
- No guidance edits were needed. `README.md` already defines the tiers, and `docs/STRUCTURE.md` / `docs/FEATURES.md` were updated as deliverables.

## Discovered work (not ticketed)

- Selected-card line dropping on crowded panes would free neighbor rows.
- A per-card last-message snippet needs a producer heartbeat contract.
- Per-session diff stats would conflict with the "not a Git manager" boundary.
