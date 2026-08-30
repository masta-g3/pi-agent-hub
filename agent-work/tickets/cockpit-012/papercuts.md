# Papercuts

- Rules' standalone Node extension tests do not declare or install their runtime packages. A fresh worktree cannot resolve `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, or `typebox` without temporary links to Pi's global install.
- Hub-managed shells export `PI_AGENT_HUB_PRIMARY_CWD`. Rules' `effectiveProjectCwd` unit test assumes that variable is absent, so standalone validation must run with `env -u PI_AGENT_HUB_PRIMARY_CWD`.
