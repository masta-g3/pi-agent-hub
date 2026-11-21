# Nerd Font icons install (2026-11-20)

- Feature-only installs: staging from `git archive HEAD` (`14959a4`) plus the Nerd Font patch (`src/tui/{glyphs,layout,usage-view,render-model,sessions-view}.ts`, tests). The checkout's unrelated doc edits were not installed.
- Own `npm ci --ignore-scripts`; `npm test`: 1796 pass. `npm pack`, then `npm install -g --ignore-scripts`; installed `dist/src/tui/*.js` matched staging byte for byte.
- Last install: idle ring, Symbols Nerd Font 3.4 model icons, no field icon on ASK/RDY/BLK/ERR. The review fix (unpainted mode label keeps its cap cells) is committed but not installed.
- `PI_AGENT_HUB_GLYPHS=nerd` is exported in the user's `~/.zshrc`. A running dashboard needs `q`, then `pi-hub`.
