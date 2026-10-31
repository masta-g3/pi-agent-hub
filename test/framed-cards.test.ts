import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildRenderModel } from "../src/tui/render-model.js";
import { renderSessions } from "../src/tui/layout.js";
import { buildDashboardCommands, selectWorkspaceCommands } from "../src/tui/dashboard-commands.js";
import { darkTheme, stripAnsi } from "../src/tui/theme.js";
import type { RuntimeSession } from "../src/core/types.js";
import { SessionsController } from "../src/app/controller.js";
import { interactionTarget } from "../src/app/session-interaction.js";
import { SessionsView } from "../src/tui/sessions-view.js";
const session: RuntimeSession = { id: "s", title: "Selected request", cwd: "/tmp/repo", group: "cards", tmuxSession: "s", status: "waiting", piSessionId: "pi", interaction: { version: 1, instanceId: "instance" }, createdAt: 1, updatedAt: 1,
  context: { version: 1, updatedAt: 1, ticket: { id: "t", subtitle: "Keep the task" }, attention: { kind: "ready", text: "Review these results", requestId: "ready" } },
  workflow: { updatedAt: 1, activeIndex: 1, steps: [{ id: "p", short: "PL", label: "Plan" }, { id: "e", short: "EX", label: "Execute" }] } };
function render(width: number, extra: Partial<Parameters<typeof buildRenderModel>[0]> = {}) {
  const commands = buildDashboardCommands({ sessions: [session], selectedId: "s", capabilities: { openSession: true, sendMessage: true } });
  return renderSessions(buildRenderModel({ sessions: [session], selectedId: "s", width, height: 30, guidanceHidden: true, workspaceCommands: selectWorkspaceCommands(session, commands, 3), ...extra }), darkTheme);
}
test("only the selected request/panel/receipt gets a fleet frame in Status and Repo", () => {
  for (const fleetGrouping of ["status", "repo"] as const) for (const width of [160, 120, 80, 60]) {
    const layout = render(width, { fleetGrouping });
    const rows = layout.lines.map(stripAnsi);
    const top = rows.findIndex(row => row.includes("╭─ ✓ Selected request"));
    assert.ok(top >= 0, rows.join("\n"));
    assert.ok(rows.slice(top + 1).some(row => row.includes("╰─")));
    assert.equal(rows.filter(row => row.includes("[cards]")).length, 1);
    if (width >= 80) assert.match(rows[top]!, /PL EX/);
    else assert.ok(rows[top + 1]!.includes("Execute"));
    for (let index = top; index <= rows.findIndex((row, i) => i > top && row.includes("╰─")); index++) { const target = layout.rowTargets[index]; assert.ok(target && "id" in target && target.id === "s"); }
    assert.ok(layout.lines.every(row => visibleWidth(row) <= width));
  }
  for (const extra of [{ grouping: "stage" as const }, { pinSlots: ["s"] }, { selectedId: "other", sessions: [session, { ...session, id: "other", context: undefined }] }, { sessions: [{ ...session, context: undefined }] }]) assert.doesNotMatch(render(120, extra).lines.map(stripAnsi).join("\n"), /╭─ ✓ Selected request/);
  assert.match(render(120, { sessions: [{ ...session, context: undefined }], deliveryResults: new Map([["s", "✓ Sent · Accepted"]]) }).lines.map(stripAnsi).join("\n"), /╭─ .*Selected request/);
  assert.match(render(120, { sessions: [{ ...session, context: undefined }], cardPanel: { body: ["Editor"], keyLine: "Enter Send", offset: 0 } }).lines.map(stripAnsi).join("\n"), /╭─ .*Selected request/);
});
test("a crowded header moves the group once and aligns its own producer labels and markers", () => {
  const selected = { ...session, title: "A complete readable title before its group", group: "A complete long group", worktreePath: "/tmp/tree", worktreeBranch: "feature" };
  const rows = render(80, { sessions: [selected] }).lines.map(stripAnsi);
  const top = rows.findIndex(row => row.includes("╭─"));
  assert.doesNotMatch(rows[top]!, /\[A complete long group\]/);
  assert.match(rows[top]!, /A complete readable title before its group ⎇/);
  assert.match(rows[top + 1]!, /\[A complete long group\]/);
  assert.equal(rows[top]!.indexOf("PL"), rows[top + 1]!.indexOf("✓"));
  assert.equal(rows[top]!.indexOf("EX"), rows[top + 1]!.indexOf("◉"));
  assert.equal(rows.filter(row => row.includes("[A complete long group]")).length, 1);
});

test("frame keys stay complete and fixed as the body scrolls, with open edges at 30", () => {
  for (const width of [120, 80, 60, 30]) {
    const cardPanel = { body: Array.from({ length: 80 }, (_, i) => `Paragraph ${i}`), keyLine: "Enter Send · Esc Fleet · 1–4 Choose · t Type · n Note · C Context · O Original · PgUp/PgDn Read", offset: 0 };
    const first = render(width, { height: 24, cardPanel });
    const last = render(width, { height: 24, cardPanel: { ...cardPanel, offset: 100 } });
    const rows = first.lines.map(stripAnsi);
    for (const key of cardPanel.keyLine.split(" · ")) {
      const index = rows.findIndex(row => row.includes(key)); assert.ok(index >= 0, `${width}: ${key}\n${rows.join("\n")}`);
      assert.ok(stripAnsi(last.lines[index]!).includes(key));
    }
    assert.ok(last.lines.map(stripAnsi).some(row => row.includes("Paragraph 79")));
    assert.ok(first.lines.every(row => visibleWidth(row) <= width));
    if (width === 30) assert.doesNotMatch(rows.join("\n"), /[╭╰]/);
    else assert.ok(rows.some(row => row.includes("╭─")));
  }
});
test("ready handoff gains a blank only when the whole card fits", () => {
  const roomy = render(80).lines.map(stripAnsi);
  const task = roomy.findIndex(row => row.includes("Keep the task"));
  assert.match(roomy[task + 1]!, /^│+\s+│+$/);
  const tight = render(80, { height: 8 }).lines.map(stripAnsi);
  const tightTask = tight.findIndex(row => row.includes("Keep the task"));
  if (tightTask >= 0) assert.doesNotMatch(tight[tightTask + 1]!, /^│+\s+│+$/);
});
test("Accepted softens once after 600ms without moving or dismissing the receipt", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let renders = 0;
  const quiet = { ...session, context: undefined };
  const controller = new SessionsController({ version: 1, sessions: [quiet] });
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 30, interactionTarget, requestRender: () => { renders++; } }, darkTheme);
  await view.writeInteraction(interactionTarget(session)!, "Answer sent", () => {});
  const before = view.render(120);
  assert.match(stripAnsi(before.join("\n")), /✓ Sent · Accepted/);
  assert.ok(before.some(row => row.includes("\x1b[1m") && row.includes("✓ Sent")));
  const count = renders;
  t.mock.timers.tick(599); assert.equal(renders, count);
  t.mock.timers.tick(1); assert.equal(renders, count + 1);
  const after = view.render(120);
  assert.deepEqual(before.map(stripAnsi), after.map(stripAnsi));
  assert.ok(after.every(row => !row.includes("✓ Sent") || !row.includes("\x1b[1m")));
  t.mock.timers.tick(10000); assert.equal(renders, count + 1);
  assert.match(stripAnsi(view.render(120).join("\n")), /╭─ .*Selected request[\s\S]*✓ Sent · Accepted/);
  controller.snapshot().sessions[0]!.status = "running";
  assert.doesNotMatch(stripAnsi(view.render(120).join("\n")), /✓ Sent · Accepted/);
});

for (const variable of ["NO_COLOR", "PI_AGENT_HUB_REDUCED_MOTION"]) test(`${variable} uses the static final receipt`, async t => {
  const previous = process.env[variable]; process.env[variable] = "1";
  t.after(() => { if (previous === undefined) delete process.env[variable]; else process.env[variable] = previous; });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let renders = 0;
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session] }), () => {}, { terminalRows: () => 30, interactionTarget, requestRender: () => { renders++; } }, darkTheme);
  await view.writeInteraction(interactionTarget(session)!, "Answer sent", () => {});
  const before = view.render(120); const count = renders;
  t.mock.timers.tick(1000);
  assert.equal(renders, count); assert.deepEqual(view.render(120), before);
  assert.match(stripAnsi(before.join("\n")), /✓ Sent · Accepted/);
  assert.ok(before.every(row => !row.includes("✓ Sent") || !row.includes("\x1b[1m")));
});

test("Tab explains older and unsupported sessions without hiding Open in Pi", async () => {
  for (const [state, reason] of [
    [{ questionProtocol: true, pending: [{ toolCallId: "call", params: { questions: [{ header: "Scope", question: "Which?", options: [{ label: "A", description: "" }, { label: "B", description: "" }] }] } }] }, "Reload Pi in this session to answer from Hub"],
    [{ answerChannel: "rpiv-events" as const, questionProtocol: true, pending: [], questionUnavailableReason: "This prompt can only be answered in Pi" }, "This prompt can only be answered in Pi"],
  ] as const) {
    const view = new SessionsView(new SessionsController({ version: 1, sessions: [session] }), () => {}, { terminalRows: () => 30, interactionTarget, loadInteractionState: async () => structuredClone(state) as unknown as import("../src/core/session-interaction.js").SessionInteractionState, submitAnswer: async () => assert.fail("unanswerable"), attachOutsideTmux: () => {} });
    view.render(120); await view.refreshInteraction(); view.handleInput("\t");
    const rendered = stripAnsi(view.render(120).join("\n")); assert.match(rendered, new RegExp(reason)); assert.match(rendered, /Enter Open in Pi/);
  }
});
