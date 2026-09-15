# cockpit-013 validation

## Automated checks

- Hub baseline: 967 tests passed. Final reviewed source: **1,025 tests passed**, followed by `npm run package:check`. These also passed in clean baseline-plus-feature installation staging.
- Question package baseline: 666 tests in 35 files. Patched package: **689 tests in 37 files passed**, with scoped non-writing formatting/type checks, repository TypeScript, and `npm ci --ignore-scripts --dry-run`.
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

- Portable questionnaire artifact: `juicesharp-rpiv-ask-user-question-2.10.0-hub.1.tgz`.
- SHA-256: `1c6b48f11cef450dfdda37b6a21cd1ee20333ab924c06e413be2bc882884b905`.
- Package: `@juicesharp/rpiv-ask-user-question@2.10.0-hub.1`; all 59 installed files matched the artifact. Its manifest includes the external protocol and shared answer builder.
- Instructions: question package `docs/hosts.md`, “Distributing the fork.” Prepare a versioned npm prefix and register its package directory in Pi; do not register the `.tgz` as an extension file or load original and fork together.
- The user approved this Mac's daily installation. Exactly one questionnaire source was changed to `~/.pi/agent/local-packages/rpiv-ask-user-question/2.10.0-hub.1/node_modules/@juicesharp/rpiv-ask-user-question`; other settings and running sessions were preserved. The work machine was not changed.
- The reviewed Hub runtime was installed from tested staging; all 90 installed modules matched. Its archive SHA-256 is `8453399706203c2dace1dbfeee4ec482d46a17739148127b7fff0d0b7ec3996c`. The focused FEATURES documentation update followed that install; runtime code did not change afterward.
- Private local rollback copies remain in `~/.pi/agent/pi-agent-hub/backups/cockpit-013-20260913-223411/`, including `reviewed-install.tgz` and earlier packages. Restore only the relevant package/settings entry, not an old whole settings file over later edits.

The redundant Hub build archive and installation patch were removed from repository artifacts at commit closeout. The source commit reproduces the implementation; the portable question archive and two PR images remain useful after commit. No npm publication occurred. Fork hosting and branch/PR pushes were separately approved.

## Existing advisories

Baseline npm installs reported 7 Hub advisories and 34 in the question monorepo. No unrelated dependency update was included to address them.
