# web-007 install

- Scope: committed HEAD `a609b10` plus the web-007 changes (the FEATURES.md integrations line excluded). README, docs/CONFIG.md and the FEATURES.md integrations line from another session are excluded.
- Staging from `git archive HEAD` with its own `npm ci --ignore-scripts`: `npm test` 1807 pass, `node scripts/web-check.mjs` all pass, `npm pack`.
- Installed `pi-agent-hub-1.2.0.tgz` with `npm install -g --ignore-scripts`; installed `dist/src/web/server.js` and `web/app.js` match staging.
- Restarted only the `pi-hub-web` tmux session with its original command (Ctrl-C closed the old session; recreated with `tmux new-session -d -s pi-hub-web …`). Tailscale Serve still proxies to :4747. Terminal dashboards were left running: quit with `q` and run `pi-hub` to load the pin cleanup.
- Live check: the real fleet's card sheet opens at its top, no page errors.
- One follow-up fix after install (card sheet keeps scroll on live rebuilds, opens at top) was re-tested in staging and reinstalled; static files reload per request.
- Review pass (code-critic, 3 rounds): 6 fixes (receipt-only skill replies for Steer/Queue, keyed suggestions, card body/actions as separate parts, shared `sync()` removes before inserting, pin cleanup behind the dashboard ownership guard). Restaged from `a609b10` + patch: 1807 pass, all web checks pass; reinstalled. Static files reload per request, so `pi-hub web` was not restarted.
