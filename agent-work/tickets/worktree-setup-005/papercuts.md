# Planning harness failures

- The optional `frontend-designer` could not run: provider reported `Not logged in`. No UI review was returned. Kept the user-approved symbols and inspected the existing layout directly.
- Two `plan-critic` launches using configured `openai-codex/gpt-5.6-sol` aborted without results. Retried the same critic with `openai-codex/gpt-5.6-luna`, which had successfully run both code scouts.
- The Luna critic `847afe12-798e-4240-a930-8c3c81b77642` stopped updating its heartbeat after roughly 20 seconds and returned no review. Its tmux pane still existed at 18:10 UTC. This blocked the first planning handoff.
- Stopping failed child `1e86e62b-0656-4fd4-af4e-79f3dde437eb` and stalled critic `847afe12-798e-4240-a930-8c3c81b77642` hit the shared `/Users/manager/.pi/agent/pi-tmux-subagents/jobs.lock` timeout. Their cancellation could not be confirmed. No application or user session was stopped.

The user subsequently repaired the subagent service. Both failed/stalled jobs were confirmed stopped. Three successful critic passes then completed; final reviewer `44c564a4-aec3-4e99-91d2-0420dc96385a` returned LGTM. The lock/provider failures no longer block the plan.

During `/review`, a fresh `code-critic` launch remained queued in `starting` for more than 20 minutes because the shared runner had no free slot. It was cancelled without starting. The non-tmux Claude fallback was also unavailable because that provider was not logged in. Review therefore used the immediately preceding final cross-repository critic PASS, a direct diff/scope audit, and fresh focused/full test runs.

Keep this note for reproducing planning/reviewer availability problems; it is not an implementation requirement.
