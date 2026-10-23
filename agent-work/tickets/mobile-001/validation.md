# mobile-001 validation

- Feature-only install, 2026-10-18: staging = `git archive 316e33e` + `feature.patch` (21 files; excludes the
  unrelated pending edits in `src/tui/new-session-dialog.ts`, `src/tui/repo-picker.ts`, `test/repo-picker.test.ts`).
- Staging `npm ci --ignore-scripts` + `npm test`: 1113/1113 pass. Packed `pi-agent-hub-1.2.0.tgz`, installed with
  `npm install -g` to `/opt/homebrew/lib/node_modules/pi-agent-hub`.
- Full checkout `npm test`: 1116/1116 pass.
- Isolated tmux 3.5a socket + pty client: 2 pins at 165x48 → 46x30 phone hides pins; `Alt+1` opens slot 1 at 46x29;
  tap on `⌂ hub` returns; `MouseDown1Status` restored; 165x48 client restores 42 | 61 | 60.

- Commit closeout: exact staged snapshot tested in temporary source with its own `npm ci --ignore-scripts`; 1135/1135 tests passed. Installed copy remains the pre-review build.
