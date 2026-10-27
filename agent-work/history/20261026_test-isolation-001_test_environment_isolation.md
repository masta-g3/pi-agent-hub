# Test environment isolation

**Feature:** test-isolation-001 → Test environment isolation

## Outcome

- `npm test` loads `dist/test/setup-env.js` through `node --import` in every test process. It removes inherited `PI_AGENT_HUB_*`, `PI_TMUX_SUBAGENTS_*`, and `PI_SUBAGENT_*` variables and points `PI_CODING_AGENT_DIR` at a temporary directory that is removed on exit.
- `test/test-env.test.ts` guards that no routing variable survives and Pi state stays under the temporary directory.
- Related flake: `fork-compact-startup.test.ts` treated a not-yet-written heartbeat as a failure. Its `until()` now treats `ENOENT` as not yet observable.
- Related polish: the selected running row stops requesting animation frames while the `:` palette covers it.

## Evidence

- Before: with `PI_TMUX_SUBAGENTS_JOB_ID` inherited, extension tests failed and the suite hung until a 180 s timeout.
- After: with fake Hub and subagent variables injected, the full suite passed 1,276/1,276 in 13 s and left no temporary directories.
- The fork-compact flake reproduced 1/6 full-suite runs before the fix and 0/12 after.
