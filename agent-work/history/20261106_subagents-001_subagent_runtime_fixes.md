**Feature:** subagents-001 → Subagent runtime fixes
**Worktree:** none — direct commits on `main` in pi-agent-hub, pi-tmux-subagents, rules

## Outcome

Subagent sessions now behave like normal sessions in four places:

1. **Theme (pi-agent-hub):** a confirmed synced `t` theme change applies once to live subagent Pi processes, and `liveChromeTargets` restyles their tmux status bars. The Hub extension still never writes subagent heartbeats.
2. **Status (pi-tmux-subagents):** the child's periodic heartbeat used to call `clearInterval` on its first write error, such as a 5 s state-lock timeout. After that the row went stale and the Hub's fallback showed yellow `waiting` while the child was still running. Ticks now run one at a time and retry on every tick, and the notice appears once per failure streak (`Subagent heartbeat failed; retrying`).
3. **Workflow rail (rules):** `ticket-runner` lists `set_workflow_step`, `set_workflow_ticket`, `set_workflow_activity`, and `complete_workflow`, so its own footer shows the rail. `bin/stage-prompts.py` drops these Pi-only tools from the Claude and Cursor copies.
4. **Esc interrupt:**
   - pi-tmux-subagents: an aborted run stays `error` in the producer heartbeat, so the parent's wait returns. The Hub mirror reports `waiting`, computed when each heartbeat is created. A real failure stays `error` in both.
   - pi-agent-hub: Hub never restarts subagent rows. Open attaches to a live subagent, or to an `error` subagent whose tmux session is present. Otherwise Open is disabled ("subagent session ended"). Subagent workspaces show `open` and `info` with no restart guidance.

## Decisions

- Workflow rail in the subagent footer only; no dashboard workflow, context, or theme fields in subagent heartbeats.
- The Hub stale-heartbeat fallback (`fallback-waiting`) is unchanged.
- No worktree; Hub installed through feature-only staging (HEAD 43abfa1 + patch, `npm ci --ignore-scripts`, tarball).

## Verification

| Repo | Result |
|---|---|
| pi-agent-hub | 1548/1548 in the checkout and in staging (baseline 1545) |
| pi-tmux-subagents | 170/170 in a temp copy (baseline 169), then `npm run build` |
| rules | pytest 91/91, then `sync-prompts.sh` |

- Live check: a reusable smoke subagent's Hub mirror and producer heartbeats both advanced every ~2 s.
- Not yet checked live: the theme change, the Esc behavior, and the footer rail. The user will check these in the next orchestrated run.
- plan-critic: four findings, all applied (single-flight ticks, snapshot-time mirror state, subagent workspace guidance, smaller sessions-view change).
- code-critic: LGTM. docs-critic: two wording fixes, both applied.

## Discovered Work (no tickets requested)

- pi-tmux-subagents `jobs.json` holds ~16k jobs (15,984 stopped). Every child heartbeat locks and parses it, which raises lock contention.
- Pins and follow view still treat `error` subagent rows as not live (`side-pane-lifecycle.ts`).
- Subagent tmux chrome shows `alt+r rename`, which subagent rows do not support.
- Heartbeat retry has no backoff for permanent errors (`Stale subagent execution`, `Unknown job`).

## Docs

- pi-agent-hub: `docs/CONFIG.md`, `docs/FEATURES.md`, `docs/STRUCTURE.md`
- pi-tmux-subagents: `README.md`, `docs/STRUCTURE.md`
- rules: `README.md`
