# Operations friction

- The default `plan-critic` model (`openai-codex/gpt-5.6-sol`) terminated with a provider usage-limit error without findings. The Anthropic subagent retry also failed because its OAuth refresh token expired. The separate read-only Claude Code connection completed the substantive review and final LGTM. No implementation decision relies on either failed run.
- The top-level Hub checkout has Pi 0.83.0 in node_modules, while its package metadata and the installed CLI target 0.85.1. API inspection must use the declared version; install the worktree's own dependencies rather than symlinking the stale top-level node_modules.
- `loadStore()` eagerly evaluates `store.empty()` even when the file exists. An installation script incorrectly used a throwing `empty()` callback to reject a missing settings file; it failed before changing settings. Validate the loaded shape in the mutation instead.
- `pi-hub --version` is not supported. Inspect the installed package manifest for its version; use `pi-hub doctor` for paths and health.
- The Playwright wrapper expected a nested CLI binary, but Pi's npm installation had hoisted it. The existing `~/.pi/agent/npm/node_modules/.bin/playwright-cli` worked without changing the installation. Its browser blocks `file:` URLs; serve disposable render fixtures on loopback instead.
