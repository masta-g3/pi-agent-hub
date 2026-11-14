// Run from Hub after npm run build: node --experimental-strip-types agent-work/tickets/card-signal-002/validate.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OpenSessionTrack } from "../../../../rules/extensions/workflow-runtime/open-session.ts";
import { withWorkflowDefinition } from "../../../../rules/extensions/workflow-runtime/core.ts";
import { replayFile } from "../../../../rules/tools/card-signal/replay.ts";
import { parseWorkflowEntry } from "../../../dist/src/core/heartbeat.js";
import { parseSessionContext } from "../../../dist/src/core/session-context.js";
import { buildRenderModel } from "../../../dist/src/tui/render-model.js";
import { renderSessions } from "../../../dist/src/tui/layout.js";
import { stripAnsi } from "../../../dist/src/tui/theme.js";

const expectedStage = (tool, args) => {
  assert.ok(["read", "edit", "bash", "hand_off"].includes(tool), tool);
  return tool === "hand_off" ? undefined : tool === "edit" ? "change" : tool === "bash" && args.command.includes("node --test") ? "verify" : "explore";
};

for (const name of ["debug", "topic-switch", "review-topic-switch", "confirmed-topic-switch"]) {
  const path = new URL(`mock/${name}/session.jsonl`, import.meta.url);
  const run = replayFile(path.pathname);
  const noteTimes = new Set();
  const notes = run.branch.filter(e => {
    if (e.customType !== "pi-agent-hub-context" || !e.data.progress || noteTimes.has(e.data.progress.updatedAt)) return false;
    noteTimes.add(e.data.progress.updatedAt);
    return true;
  });
  const goals = notes.map(e => e.data.progress.goal);
  assert.equal(goals.length, name === "topic-switch" ? 2 : 3);
  if (name === "debug") assert.equal(new Set(goals).size, 1);
  else if (name === "review-topic-switch" || name === "confirmed-topic-switch") { assert.equal(goals[0], goals[1]); assert.notEqual(goals[1], goals[2]); }
  else assert.notEqual(goals[0], goals[1]);
  if (name === "confirmed-topic-switch") for (const goal of goals) assert.doesNotMatch(goal, /without|do not|don't|yet|no fix/i);
  const rawLensesAtToolEnd = new Map();
  let rawLens;
  for (const entry of run.branch) {
    if (entry.customType === "workflow-runtime") rawLens = entry.data.lens;
    if (entry.message?.role === "toolResult") rawLensesAtToolEnd.set(entry.message.toolCallId, rawLens);
  }
  const events = readFileSync(new URL(`mock/${name}/events.jsonl`, import.meta.url), "utf8").trim().split("\n").map(JSON.parse);
  const track = new OpenSessionTrack();
  let context;
  let cardChecked = false;
  const seen = new Set();
  const states = active => ["explore", "change", "verify"].map(label => ({ label, state: label === active ? "active" : seen.has(label) ? "done" : "pending" }));
  let finished = 0;
  let active;
  // Recorded model notes and exact RPC clocks, replayed through today's tracker. No model calls.
  for (const event of [...events, ...notes.map(e => ({ ...e, at: Date.parse(e.timestamp) }))].sort((a, b) => a.at - b.at)) {
    if (event.type === "agent_start") track.beginTurn();
    if (event.customType === "pi-agent-hub-context") {
      const previous = context?.progress?.goal;
      context = parseSessionContext(event.data);
      track.goal(context.progress.goal, track.turn);
      if (previous && previous !== context.progress.goal) { seen.clear(); active = undefined; }
    }
    if (event.type === "tool_execution_start") {
      track.start(event.toolCallId, event.toolName, event.args);
      const lens = track.lens();
      if (expectedStage(event.toolName, event.args)) {
        assert.ok(lens.doing);
        const arg = event.args.path ?? event.args.command;
        assert.ok(lens.doing.endsWith(arg), lens.doing);
      } else assert.equal(lens?.doing, undefined);
      if (context && lens.stages && name === "debug") {
        const published = parseWorkflowEntry(withWorkflowDefinition({}, lens));
        assert.ok(published?.lens);
        const row = { id: "fixture", title: "Addition debug", cwd: "/tmp/fixture", group: "mock", tmuxSession: "fixture", status: "running", createdAt: event.at, updatedAt: event.at, context, lens: published.lens };
        const text = renderSessions(buildRenderModel({ sessions: [row], selectedId: row.id, width: 160, height: 60, now: event.at, guidanceHidden: true })).lines.map(stripAnsi).join("\n");
        assert.match(text, /GOAL[\s\S]*DOING[\s\S]*WHERE/);
        assert.doesNotMatch(text, /DONE|NEXT/);
        cardChecked = true;
      }
    }
    if (event.type === "tool_execution_end") {
      const call = run.calls.find(c => c.id === event.toolCallId);
      // Expectations come from the fixture's tool contract, not the producer classifier.
      const expected = expectedStage(call.name, call.args);
      if (expected) { seen.add(expected); active = expected; }
      track.finish(event.toolCallId);
      assert.deepEqual(track.lens()?.stages, active ? states(active) : undefined);
      assert.equal(track.lens()?.doing, undefined);
      if (name === "review-topic-switch" || name === "confirmed-topic-switch") {
        assert.deepEqual(rawLensesAtToolEnd.get(call.id)?.stages, active ? states(active) : undefined);
        assert.equal(rawLensesAtToolEnd.get(call.id)?.doing, undefined);
      }
      finished++;
    }
  }
  assert.equal(finished, run.calls.length);
  if (name === "debug") {
    assert.ok(cardChecked);
    assert.deepEqual(track.lens().stages.map(s => s.state), ["done", "done", "active"]);
  } else assert.equal(track.lens(), undefined, "tool-free topic switch clears the old topic's stages");
  console.log(`${name}: ${goals.length} goals checked; ${finished} exact tool lifecycles checked; ${run.timeline.length} replay intervals`);
}
