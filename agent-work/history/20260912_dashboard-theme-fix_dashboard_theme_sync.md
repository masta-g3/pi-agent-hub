# Dashboard theme fixes

## Result

- Automatic mode reads macOS system appearance at startup and through Hub's existing theme refresh loop. Other platforms retain process `COLORFGBG` detection.
- The theme picker retains custom Automatic light/dark choices while browsing fixed themes.
- Existing Pi sync and persistence paths remain unchanged. Appearance refresh does not send another theme command to managed sessions.
- Updated `docs/CONFIG.md` and `docs/STRUCTURE.md`.

## Verification

Typecheck and 290 relevant tests passed in the working checkout. The isolated commit snapshot also compiled and passed 295 relevant tests using its own lockfile dependencies. Disposable tmux testing confirmed fixed-theme and custom-pair save/relaunch, detached overrides, and Escape rollback. The real macOS appearance read returned light; simulated preference changes covered light/dark transitions. Manual OS appearance switching and live-session chrome were not tested.

Code and documentation review found no actionable issues. Installed Hub and user settings were left unchanged. No tracked feature was associated with this task.
