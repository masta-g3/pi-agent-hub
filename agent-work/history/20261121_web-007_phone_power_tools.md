# web-007 · Phone power tools

## Outcome

The phone page (`pi-hub web`) gains four things and stays lean:

- **Session card:** tapping the chat header opens a bottom sheet with the dashboard card's fields: GOAL (without ticket copy), DOING, DONE/NEXT, workflow steps, lens stages, progress with pass/summary/mode, a 12-item checklist window, NOW, three LOG calls, three running subagents, repository, branch and model. Empty fields are not shown; it updates while open.
- **Skill composer:** `/` in the reply box completes the session's loaded skills; an empty focused box shows workflow step chips with the next step filled. A chip fills the box and never sends. `/review x` sends `/skill:review x`.
- **Quiet list rows:** only a 2 px progress hairline and the step short were added (user asked to keep rows minimal). The chat header adds `N/M done`.
- **Archive, Backlog, Restore:** from the card. Archive asks Done / Abandoned / Archive only. Backlogged parents leave the tiers for a folded BACKLOG section (not counted or announced). None stop tmux or Pi. A phone archive of a pinned session closes that pin at the terminal dashboard's next refresh.

Still terminal-only: stop, delete, rename, fork, worktree finish/discard.

## Decisions

- Out of scope by user choice: the next-request swipe loop.
- **Exact targets inside the registry lock.** Phone lifecycle writes pass `strict: true` (`ParentTarget` in `src/app/controller.ts`): the Pi id compares exactly, including an absent one. Archive and Backlog also carry the displayed `section`; Restore carries the displayed bucket and closure, so it cannot erase a newer Done/Abandoned. TUI callers keep their behavior.
- **Card from the registry:** `inboxDetail()` builds row and card from the matched parent outside the interaction call and without list caps, so stopped sessions and failed bridges still show the card and Restore.
- **Shared skill matcher:** the server serves compiled `src/core/skill-reply.js` at `/skill-reply.js`, like `/transcript.js`; `workflowSkillSteps()` runs on the server because the page lacks step ids.
- **Pin cleanup (user choice):** the TUI's `afterRefresh`, only in the Hub-owned dashboard, compares archived ids with the previous refresh (seeded at startup) and queues the existing `detach(tmuxSession, paneId)` for panes that already existed at that refresh. A pin opened in the same interval survives (safe direction).
- **Page binding:** card, composer and lifecycle actions bind the detail's own target and disable while the live list reports another conversation or lifecycle; the Archive choice freezes Pi id, section and closure. Skill sends (shorthand or `/skill:`) show only a receipt, since Pi records them expanded.
- The shared page `sync()` now removes stale parts before inserting, so unchanged controls keep focus during live updates.

## Code

- `src/web/inbox.ts` (backlog list, `stepShort`, `progress`, `closure`, `inboxDetail`, card), `src/web/server.ts` (card, skills, steps, `/skill-reply.js`, archive/backlog/restore routes), `src/web/run-web.ts`.
- `src/app/controller.ts` (strict/section target, guarded Restore), `src/app/run-tui.ts` (`archivedSessionIds`, `newlyArchivedPins`), `src/app/side-pane.ts` / `side-pane-lifecycle.ts` (`detach` by pane id).
- `web/app.js`, `web/app.css`.
- Docs: `STRUCTURE.md` web contract, `FEATURES.md` Phone inbox and Session closure, `CONFIG.md` security note, `DEVELOPMENT.md` web restart note, `CHANGELOG.md`.

## Verification

- `npm test`: 1807 pass (new tests in web-inbox, web-server, controller, run-tui, side-pane).
- `node scripts/web-check.mjs`: all pass, 8 new checks (card, Archive outcome and Restore, frozen Archive choice, Backlog/Restore without a live bridge, skills and chips, Steer skill receipt, replaced conversation and gone session, list hairline, text safety).
- plan-critic: 2 passes. code-critic: 2 execute passes and 3 review passes, the last with no blocking issues.
- Installed globally as a feature-only package (`a609b10` plus the web-007 patch) and restarted `pi-hub web`; evidence in `agent-work/tickets/web-007/`. Not verified: real iPhone use over Tailscale, and pin cleanup in a running dashboard (needs a dashboard restart).
