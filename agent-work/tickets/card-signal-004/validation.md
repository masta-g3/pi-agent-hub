# card-signal-004 install

- Scope: committed HEAD `5517bfd` (model badge `1296e38` + Claude family fix). README and docs working-tree edits from another session excluded.
- Staging from `git archive HEAD`, own `npm ci --ignore-scripts`: `npm test` 1793 pass, `node scripts/web-check.mjs` all pass, `npm pack`.
- Installed `pi-agent-hub-1.2.0.tgz` with `npm install -g --ignore-scripts`; installed `dist/src/tui/model-badge.js` matches staging.
- Restarted only the `pi-hub-web` tmux session with its original command. Terminal dashboards were left running; quit with `q` and run `pi-hub` to load the new code.
- pi-tmux-subagents loads from its checkout `dist`, already rebuilt at `4943828`; no reinstall needed.
