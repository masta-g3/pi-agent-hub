# web-005 · Phone controls

## Outcome

`pi-hub web` stays a lean companion, with six additions:

- **Next step:** the chat dock offers `Next: /<skill>` when the workflow step is complete, Pi is idle and no question is pending, the same as `>` in the dashboard.
- **Shortcuts:** each configured `dashboard.shortcuts` entry is a chip, enabled on the same terms as the dashboard.
- **Resume:** stopped or failed sessions show Resume, which runs `restartManagedSession()`.
- **New session:** `+` opens a sheet with known repos (registry plus repo history, without Hub-owned worktrees or the server's launch directory, at most 20) and a group. It runs `addManagedSession({ cwd, group })`, then opens the chat.
- **Limits:** a band chip shows the tightest quota window. Tapping it opens a sheet with every account window and its reset time.
- **Search and Archived:** `⌕` filters by title, group, ticket, subtitle, step or request text. A folded ARCHIVED section lists the 20 newest archived parents.

Still not on the page: stop, delete, archive, rename, worktrees, multi-repo or arbitrary-path creation.

## Decisions

- **Exact targets for every write.** `next` recomputes `nextSkill()` from fresh state and must equal the displayed skill. `shortcut` must match the configured `send` at its index. `resume` needs the displayed `piSessionId` and a stopped/error row, re-checked inside the registry mutator. `POST /api/sessions` accepts only an offered cwd.
- **Resume lockout:** each session can be resumed from the phone once per 60 seconds. Until the new Pi reports, the old Pi's shutdown heartbeat makes the row read stopped, and a second restart would kill the new Pi. Follow-up `lifecycle-001` fixes this in the shared restart code.
- **Lifecycle success stands:** a refresh failure after create or resume does not turn it into a rejection.
- **Sheets:** one shared `<dialog>` with a liveness token, so a late result never reopens or hijacks a closed or replaced sheet. A 200 without an id reads as Delivery unknown.

## Code

- `src/web/inbox.ts`: `archived` list.
- `src/web/server.ts`: the `next`, `shortcut` and `resume` routes, `GET /api/new` and `POST /api/sessions`, `limits` in the snapshot, and `nextSkill` and `shortcuts` in the detail.
- `src/web/run-web.ts`: wiring and the lockout.
- `web/app.js` and `web/app.css`: band controls, search, archived section, sheets, and dock chips.
- Docs: `FEATURES.md` (Phone inbox), `STRUCTURE.md` (web contract), the `CONFIG.md` security note, and `CHANGELOG.md`.

## Verification

- `npm test`: 1793 pass. New tests in `web-server` and `web-inbox`.
- `npm run test:web`: 35 pass, 5 of them new (Next and shortcut, Resume, New session, Limits, Search and Archived).
- code-critic: 3 passes, the last with no issues.
- Installed globally as a feature-only package (committed `HEAD` `42f391c` plus the web-005 patch), and `pi-hub-web` restarted. Evidence is in `agent-work/tickets/web-005/`.
- Not verified: a real create or resume from the phone, and an iPhone over Tailscale.
