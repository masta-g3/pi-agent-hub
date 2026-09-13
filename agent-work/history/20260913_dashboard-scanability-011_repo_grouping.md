# Repo grouping

- **Feature:** dashboard-scanability-011
- **Completed:** 2026-09-13
- **Worktree:** none

## Outcome

- Parent titles show the chosen `[group]` once. The final user-approved badge uses the session group, not the repo basename; lower group metadata is removed. Worktree and multi-repo markers remain, and the action workspace shows the actual repository.
- `v` toggles persisted Status/Repo fleet grouping. `S` visits the workflow board and returns to that choice. Repo folds remain process-local.
- Repo sections are alphabetical and contain complete owner trees in existing cockpit-tier order. Identity uses the normalized primary source path; Hub worktrees share their source repo, additional repos do not duplicate sessions, and colliding names receive distinguishing labels.
- Backlog retains its lifecycle label; Archived stays separate and chronological. Owner requests and hidden-child requests remain separate counts.
- Shared projection and exact-target selection keep filtering, reveals, keyboard navigation and mouse hits consistent. Repo headers cannot act on stale sessions or expose their workspace. Status-only navigation, coaching and manual ordering stay scoped.
- Updated the six approved documentation files. No new dependency, repository record, filesystem discovery or lifecycle behavior.

## Verification and installation

- Final correction followed a failing regression, then passed the main-checkout targeted suite: **359 tests**. The independent code critic returned **LGTM**.
- Feature-only staging passed typecheck, **967 full tests**, packaging checks and installed CLI/render smoke. Installed CLI and all `dist/src` files match the tested staging build byte-for-byte.
- Installed `pi-agent-hub@1.2.0` from baseline `1f11bac64c272408cfa152a2e48103adcb6a7ae4` plus this feature and its approved documentation. Unrelated dirty-checkout fork/workflow reversions were excluded from installation and commit.
- Tested tarball SHA-256: `33949105f211f68b899fb3c306575ed41c438b3cfb98063081cb2a6ec499eb58`.
- No live sessions were restarted. Quit the dashboard with `q`, then run `pi-hub` to load the installation.

The committed source is the reproduction boundary. Temporary staging, patch copies and superseded ticket evidence were removed at closeout.
