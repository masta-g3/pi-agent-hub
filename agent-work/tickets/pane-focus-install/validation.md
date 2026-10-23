# Pinned-pane focus validation

- Final behavior: heavy tmux border lines, theme-accent focused outline, and a `⌨` marker in the focused title. Closing the final pin unsets the heavy lines.
- Rejected approach: background tinting clashes with Pi's explicitly colored message/tool panels. All tint code and temporary theme tokens were removed.
- Typecheck passed. Isolated staging with its own `npm ci --ignore-scripts` passed the full suite: 1138/1138 tests.
- Installed the tested tarball globally with `npm install -g --ignore-scripts`. Installed runtime modules exactly matched staging.
- User confirmed the live appearance looks good. No feature ticket, implementation plan, or worktree closeout applies.
