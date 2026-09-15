# cockpit-013 validation

## Automated checks

- Hub baseline: 967 tests passed. Final reviewed source: **1,025 tests passed**, followed by `npm run package:check`. These also passed in clean baseline-plus-feature installation staging.
- Question package baseline: 666 tests in 35 files. Patched package: **689 tests in 37 files passed**, with scoped non-writing formatting/type checks, repository TypeScript, and `npm ci --ignore-scripts --dry-run`.
- Push closeout: Hub **1,025 tests** and the question monorepo's **6,665 tests in 272 files** passed outside Git's hook environment. Monorepo coverage: 94.79% statements, 89.47% branches, 94.75% functions, 96.35% lines.
- Unsafe hook attempts were blocked before either push. See `papercuts.md` for Git-environment leakage and user-approved recovery. Private `push-recovery/` backups retain the affected refs, indexes, config and bundles. Physical source files were unchanged.
- Final code-critic recheck: **LGTM**. Focused docs-critic feedback was resolved. Both repository diff checks passed.
- Regressions cover exact session identity before repaint, refresh during submission, mouse Send committing the selected answer, literal custom-input keys, narrow visible controls, fleet tier clicks, expired confirmation/new-message cues, clipped speaker identity, and complete viewport paging.

## Real Pi smoke

Used Pi 0.85.1, isolated tmux servers and short temporary state paths, and a deterministic test provider with no network requests or credentials. Verified source and the packed questionnaire:

1. Two live managed sessions retain separate history, pending questions, and command targets.
2. Dashboard custom/multiselect answers close the native overlay, create one canonical tool result, and let Pi continue. Native cancellation rejects late answers.
3. Two real dashboards submitting the same request produce one answer and close both forms. Producer tests cover native/external ordering and abort/replacement races.
4. Commands are blocked by questions and editor drafts. A configured `/skill:` command expands and runs once after readiness checks.
5. `/reload` changes the bridge nonce; old reads/writes fail and current history remains readable.
6. Successive questions appear automatically in the bottom panel. Number/Enter, custom `c2`, multiselect, mouse option/Send, Escape, hide/show, and 40-column controls work.

`before.png` and `after.png` are synthetic render fixtures for the PR, rasterized from actual renderer output with the same sample sessions/theme. Before uses Hub baseline `91e9ffc`; after uses the reviewed feature. They are not captures of user sessions.

All disposable sessions, servers, browser fixtures, scripts, logs, and compiler output were removed.

## Retained package and installation

- Portable questionnaire artifact: `juicesharp-rpiv-ask-user-question-2.10.1-hub.1.tgz`.
- SHA-256: `e91e010cf2f12c609c1ea1689a89616fbc126006f2ec50a5d129b4546ec6744c`.
- User-approved resolution integrated the fork's 2.10.1 release. `npm ci --ignore-scripts`, all 6,665 monorepo tests, coverage and pre-commit checks passed again. Coverage: 94.81% statements, 89.48% branches, 94.78% functions, 96.36% lines. Extracted archive comparison found only the manifest and install examples changed; all runtime files are identical.
- Installed package remains `@juicesharp/rpiv-ask-user-question@2.10.0-hub.1`; all 59 installed files matched that original artifact (`1c6b48f11cef450dfdda37b6a21cd1ee20333ab924c06e413be2bc882884b905`). Its archive remains in the private rollback directory and Git history. No installation followed conflict resolution.
- Instructions: question package `docs/hosts.md`, “Distributing the fork.” Prepare a versioned npm prefix and register its package directory in Pi; do not register the `.tgz` as an extension file or load original and fork together.
- The user approved this Mac's daily installation. Exactly one questionnaire source was changed to `~/.pi/agent/local-packages/rpiv-ask-user-question/2.10.0-hub.1/node_modules/@juicesharp/rpiv-ask-user-question`; other settings and running sessions were preserved. The work machine was not changed.
- The reviewed Hub runtime was installed from tested staging; all 90 installed modules matched. Its archive SHA-256 is `8453399706203c2dace1dbfeee4ec482d46a17739148127b7fff0d0b7ec3996c`. The focused FEATURES documentation update followed that install; runtime code did not change afterward.
- Private local rollback copies remain in `~/.pi/agent/pi-agent-hub/backups/cockpit-013-20260913-223411/`, including `reviewed-install.tgz` and earlier packages. Restore only the relevant package/settings entry, not an old whole settings file over later edits.

The redundant Hub build archive and installation patch were removed from repository artifacts at commit closeout. The source commit reproduces the implementation; the portable question archive and two PR images remain useful after commit. No npm publication occurred. Fork hosting and branch/PR pushes were separately approved.

## Working indicator follow-up

The user approved an animated `PI is working…` line below Conversation messages, then requested installation, commit and push. It uses the existing 250 ms dashboard loop, reserves one history row without changing action hit targets, and disappears when the panel closes, the session stops working, a question appears, or observation fails. This small follow-up has no separate feature or plan.

- Targeted ephemeral checks covered changing frames, below-message placement, inactive/question/error states and width safety. All 68 relevant existing tests and TypeScript passed; temporary checks were removed. The feature branch's full 1,025 tests then passed outside the unsafe Git hook environment.
- Preserve the newer combined installation, not the feature worktree alone: archive local commit `c2f8df9`, apply `agent-work/install/conversation-integration.patch` from local commit `c86c99f`, then apply this follow-up's three-file `src/` diff over `11dbfff`. Those root commits were maintained by the other session and were not pushed by this follow-up.
- That combined staging passed 984 tests and package checks with its own clean dependencies. Installed from its tested tarball, SHA-256 `5a10cb6c12a56150953d76b9296c90c91799e58d10a1ddbad9c9e84760d96734`. All installed `dist/src` files and `dist/cli.js` matched. Before installation, only the three intended modules and their maps/declarations differed from the previous installation.
- Private rollback and installed archives remain under `~/.pi/agent/pi-agent-hub/backups/working-indicator-20260914/`. No Pi settings or questionnaire package changed. Quit and reopen Hub to load the indicator; no Pi session reload is required.
- `working-before.png` / `working-after.png` show synthetic actual-renderer fixtures against the previous installed and updated combined versions, not user conversations. Browser, server and staging artifacts were removed afterward.

## Existing advisories

Baseline npm installs reported 7 Hub advisories and 34 in the question monorepo. No unrelated dependency update was included to address them.
