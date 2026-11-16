# web-005 install

- Scope: committed HEAD `42f391c` plus the web-005 code, tests and page (committed as `6a7c44c`; doc edits and unrelated working-tree changes excluded).
- Staging from `git archive HEAD`, own `npm ci --ignore-scripts`: `npm test` 1793 pass, `node scripts/web-check.mjs` 35 pass, `npm pack`.
- Runtime difference from the previous global install beyond web-005: committed `42f391c` (orchestrator markers), already on `main`.
- Installed `pi-agent-hub-1.2.0.tgz` with `npm install -g --ignore-scripts`; web files and `dist/src/web/*.js` match staging.
- Fix found during install: the repo list offered the server's launch directory. `run-web.ts` now passes no launch cwd.
- Restarted only the `pi-hub-web` tmux session with its original command (cwd `$HOME`). `/api/new` lists 20 real repos; the Tailscale URL returns 200. The terminal dashboard was not restarted.
- Review fixes (code-critic, 3 passes, final "no issues"): Resume has a 60 s per-session lockout after a successful restart, because the old Pi's shutdown heartbeat can read as stopped and a second restart would kill the new Pi; the New session sheet ignores late results after close or replacement, re-checks readiness when the connection drops, and reports a cut-off 200 as Delivery unknown. Reinstalled from staging (1793 pass) and restarted `pi-hub-web`.
