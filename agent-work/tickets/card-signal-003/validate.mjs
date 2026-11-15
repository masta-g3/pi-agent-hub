// From Hub after npm run build: node --experimental-strip-types agent-work/tickets/card-signal-003/validate.mjs
// No model calls. Uses 001's replay and current producer projection for the older Execute/Review recordings.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { replay, replayFile, jsonLines } from "../../../../rules/tools/card-signal/replay.ts";
import { OpenSessionTrack } from "../../../../rules/extensions/workflow-runtime/open-session.ts";
import { withWorkflowDefinition } from "../../../../rules/extensions/workflow-runtime/core.ts";
import { parseWorkflowEntry } from "../../../dist/src/core/heartbeat.js";
import { buildRenderModel } from "../../../dist/src/tui/render-model.js";
import { renderSessions } from "../../../dist/src/tui/layout.js";
import { stripAnsi } from "../../../dist/src/tui/theme.js";

const here = new URL("./", import.meta.url);
const checkCard = (data) => {
  const parsed = parseWorkflowEntry(data);
  assert.ok(parsed?.lens);
  for (const width of [160, 100, 80]) {
    const row = { id: "fixture", title: "Parity mock", cwd: "/tmp/fixture", group: "mock", tmuxSession: "fixture", status: "running", createdAt: 1, updatedAt: 1, workflow: parsed };
    const lines = renderSessions(buildRenderModel({ sessions: [row], selectedId: row.id, width, height: 60, now: 1, guidanceHidden: true })).lines.map(stripAnsi);
    assert.ok(lines.some(line => line.includes("WHERE")));
    if (data.lens.progress) assert.ok(lines.some(line => line.includes(`${data.lens.progress.completed}/${data.lens.progress.total}`)));
  }
};

for (const step of ["plan", "reflect", "commit"]) {
  const run = replayFile(new URL(`mock/${step}/session.jsonl`, here).pathname);
  const snapshots = run.branch.filter(e => e.customType === "workflow-runtime" && e.data.activeStep).map(e => e.data);
  const visible = snapshots.filter(data => data.lens);
  for (const data of visible) {
    const lens = data.lens;
    assert.ok(lens.stages.every(stage => !/^\d+$/.test(stage.label)));
    const active = data.currentStepComplete ? undefined : lens.list?.items.find(item => item.state === "active");
    assert.equal(lens.doing, active?.text ?? data.activity.label);
    if (step === "commit") assert.equal(lens.progress, undefined);
    if (step === "reflect" && data.stepItems?.length) {
      assert.deepEqual(lens.progress, { completed: data.stepItems.filter(item => ["done", "deferred"].includes(item.state)).length, total: data.stepItems.length, unit: "settled" });
    }
    checkCard(data);
  }
  const last = visible.at(-1);
  if (step === "plan") {
    assert.deepEqual(last.lens.progress, { completed: 1, total: 2, unit: "criteria" });
    assert.equal(last.lens.pass, 2);
    assert.deepEqual(last.lens.list.items.slice(0, 2), [{ state: "done", text: "plan written" }, { state: "pending", text: "criteria 1/2" }]);
    assert.equal(snapshots.at(-1).lens, undefined, "Plan's terminal lens lifecycle is unchanged");
  } else if (step === "reflect") {
    assert.equal(last.lens.doing, "Reflection complete");
    assert.deepEqual(last.lens.progress, { completed: 2, total: 3, unit: "settled" });
  } else {
    assert.equal(last.lens.doing, "Commit complete");
    assert.equal(last.lens.list.head, "1 commit");
    assert.equal(last.stepFacts.commits.length, 1);
  }
  assert.ok(run.timeline.some(moment => moment.shown.doing === last.lens.doing));
  console.log(`${step}: ${visible.length} recorded lenses; ${run.calls.length} tools; ${run.timeline.length} replay intervals; last ${last.lens.progress ? `${last.lens.progress.completed}/${last.lens.progress.total}` : "no meter"}`);
}

for (const [step, scenario] of [["execute", 4], ["review", 5]]) {
  const source = new URL(`../card-signal-001/mock/inputs/${scenario}-openai-gpt-6.1-sol/`, here);
  const original = replayFile(new URL("session.jsonl", source).pathname);
  const events = jsonLines(readFileSync(new URL("events.jsonl", source), "utf8"));
  const track = new OpenSessionTrack();
  let state = {};
  const projected = [];
  let live = 0;
  let checked = 0;
  const append = (at, entry) => projected.push({ ...entry, timestamp: new Date(at).toISOString() });
  const publish = (at) => {
    const data = withWorkflowDefinition(state, track.lens());
    if (data.lens) {
      const lens = data.lens;
      if (step === "execute" && state.plan) {
        assert.deepEqual(lens.progress, { ...state.plan.tasks, unit: "tasks" });
        assert.equal(lens.doing, track.lens()?.doing ?? (state.plan.tasks.completed === state.plan.tasks.total ? "Implementation complete" : state.plan.nextStep));
        assert.equal(lens.list.head, `${state.plan.tasks.completed} done · ${state.plan.tasks.total - state.plan.tasks.completed} open`);
        if (track.lens()?.doing) live++;
      } else if (state.stepItems?.length) {
        assert.deepEqual(lens.progress, { completed: state.stepItems.filter(item => ["done", "deferred"].includes(item.state)).length, total: state.stepItems.length, unit: "settled" });
        assert.equal(lens.doing, state.currentStepComplete ? state.activity.label : state.stepItems.find(item => item.state === "active")?.text ?? state.activity.label);
      }
      checkCard(data);
      checked++;
    }
    append(at, { type: "custom", customType: "workflow-runtime", data });
  };
  const merged = [...original.branch.map(entry => ({ at: Date.parse(entry.timestamp), entry })), ...events.map(event => ({ at: event.at, event }))].sort((a, b) => a.at - b.at);
  for (const { at, entry, event } of merged) {
    if (entry?.customType === "workflow-runtime") {
      const next = { ...entry.data };
      delete next.lens;
      if (next.activeStep !== state.activeStep) track.reset();
      if (next.activeStep === "execute" && next.plan) {
        const list = entry.data.lens?.list;
        next.plan = { ...next.plan, ...(list ? { current: { tasks: list.items.map(item => ({ done: item.state === "done", text: item.text })), before: list.before, after: list.after } } : {}) };
        next.activity = state.activeStep === "execute" ? state.activity : undefined;
      }
      state = next;
      publish(at);
    } else if (entry) append(at, entry);
    if (event && state.activeStep === "execute") {
      if (event.type === "tool_execution_start") track.start(event.toolCallId, event.toolName, event.args);
      if (event.type === "tool_execution_end") {
        const stage = track.finish(event.toolCallId);
        if (stage) state.activity = stage === "verify" ? { id: "verify", label: "Verifying" } : { id: "implement", label: "Implementing" };
      }
      if (event.type === "agent_end") track.endTurn();
      if (state.plan) publish(at);
    }
  }
  // Rebuild the append chain for replay, retaining the original mock messages and exact RPC clocks.
  const rows = projected.map(({ id: _id, parentId: _parent, ...entry }, index) => ({ ...entry, id: `projection-${index}`, parentId: index ? `projection-${index - 1}` : null }));
  const run = replay(rows, events);
  assert.ok(checked > 0);
  if (step === "execute") {
    assert.ok(live > 0);
    assert.ok(run.timeline.some(moment => moment.shown.doing?.startsWith("Checking")));
    assert.ok(run.timeline.some(moment => moment.shown.doing === "Implementation complete"));
  } else assert.ok(run.timeline.some(moment => moment.shown.doing === "Review complete"));
  console.log(`${step}: ${checked} current projections; ${live} live-tool samples; ${original.calls.length} recorded tools; ${run.timeline.length} replay intervals`);
}
