import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildRenderModel } from "../src/tui/render-model.js";
import { buildDashboardCommands, selectWorkspaceCommands } from "../src/tui/dashboard-commands.js";
import { renderSessions } from "../src/tui/layout.js";
import type { RuntimeSession } from "../src/core/types.js";
import { stripAnsi } from "../src/tui/theme.js";

const now = 1_800_000_000_000;
const asking: RuntimeSession = {
  id: "asking", title: "Dashboard UI polish", cwd: "/tmp/hub-repo", group: "cards", tmuxSession: "asking",
  status: "waiting", createdAt: now, updatedAt: now, lastActivityAt: now, worktreeBranch: "feat/taller-cards",
  context: { version: 1, updatedAt: now, ticket: { id: "cards-001", subtitle: "Taller fleet cards" },
    attention: { kind: "question", text: "Choose the boundary", requestId: "request" } },
  workflow: { updatedAt: now, activeIndex: 1,
    steps: [{ id: "plan", short: "PL", label: "Plan" }, { id: "execute", short: "EX", label: "Execute" }, { id: "review", short: "RV", label: "Review" }],
    plan: { tasks: { completed: 3, total: 8 } } },
};
function render(width: number, height = 30, details = false, grouping: "project" | "stage" = "project") {
  const commands = buildDashboardCommands({ sessions: [asking], selectedId: asking.id, capabilities: { openSession: true, sendMessage: true } });
  return renderSessions(buildRenderModel({ sessions: [asking], selectedId: asking.id, width, height, now, guidanceHidden: true, grouping,
    workspaceCommands: selectWorkspaceCommands(asking, commands, 3), workspaceEvidenceVisible: details }));
}

/** Rows of the docked card, below the dock rule. */
function dockRowsOf(lines: string[]): string[] {
  const plain = lines.map(stripAnsi);
  const rule = plain.findIndex((line, index) => index > 0 && /^─{20,}$/u.test(line.trim()));
  return rule < 0 ? [] : plain.slice(rule + 1);
}

test("inbox cards retain separate task and request at every approved width", () => {
  for (const width of [160, 120, 80, 60, 30]) {
    const layout = render(width);
    const lines = dockRowsOf(layout.lines);
    const task = lines.findIndex(line => line.includes("Taller fleet cards"));
    const request = lines.findIndex(line => /^▌ +ASK {3}Choose the boundary/.test(line));
    assert.ok(task >= 0 && request > task, `${width}:\n${layout.lines.map(stripAnsi).join("\n")}`);
    const metadata = lines[1]!;
    if (width >= 60) assert.match(metadata, /^▌ +hub-repo ⎇ feat\/taller-cards/);
    else assert.doesNotMatch(metadata, /hub-repo|feat\/taller-cards/);
    assert.doesNotMatch(metadata, /tasks|now|Execute/);
    // Workflow position and tasks live in the module's readout.
    const text = lines.join("\n");
    assert.match(text, width >= 100 ? /PL✓ EX◉ RV· +▰{3}▱{5} 3\/8/ : width >= 80 ? /STEP {2}PL✓ EX◉ RV·/ : /STEP {2}Execute/);
    assert.equal(layout.workspaceStartX, undefined);
    assert.ok(lines.every(line => visibleWidth(line) <= width));
  }
});

test("both fleet groupings reclaim the full width and synthetic headers carry no selected workspace", () => {
  const commands = buildDashboardCommands({ sessions: [asking], selectedId: asking.id, capabilities: { openSession: true } });
  for (const fleetGrouping of ["status", "repo"] as const) for (const width of [120, 160]) {
    const input = { sessions: [asking], selectedId: asking.id, width, height: 30, now, fleetGrouping, guidanceHidden: true,
      workspaceCommands: selectWorkspaceCommands(asking, commands, 3) };
    const layout = renderSessions(buildRenderModel(input));
    assert.equal(layout.listWidth, width);
    assert.equal(layout.workspaceStartX, undefined);
    assert.ok(layout.cardCommandHits.some(hit => hit.commandId === `action:${asking.id}:open`));
    const synthetic = buildRenderModel({ ...input, ...(fleetGrouping === "status" ? { selectedSection: "health" as const } : { selectedRepo: "/tmp/hub-repo" }) });
    assert.equal(synthetic.workspace, undefined);
    assert.equal(renderSessions(synthetic).cardCommandHits.length, 0);
  }
});

test("selected pending questionnaires keep the producer header and fit only the question", () => {
  for (const width of [30, 60, 80, 120, 160]) {
    const other = { ...asking, id: "other", title: "Other" };
    const model = buildRenderModel({ sessions: [asking, other], selectedId: asking.id, width, height: 40, now, guidanceHidden: true,
      selectedQuestion: { header: "Scope", question: "Should we keep the complete ticket subtitle above the request? ".repeat(4) } });
    const layout = renderSessions(model);
    // The selected module labels the questionnaire ASK and wraps its complete text.
    const request = layout.lines.findIndex(line => /^▌ +ASK +Scope · Should/.test(stripAnsi(line)));
    assert.ok(request > 0, layout.lines.map(stripAnsi).join("\n"));
    assert.ok(layout.lines.some(line => /ASK +Choose the/.test(stripAnsi(line))), "unselected module retains its producer attention text");
    assert.equal(model.sections[0]!.sessionsTotal, 2);
  }
  const model = buildRenderModel({ sessions: [{ ...asking, context: undefined }], selectedId: asking.id, width: 60, height: 30,
    selectedQuestion: { header: "Stock Pi", question: "Choose a branch" } });
  assert.ok(renderSessions(model).lines.some(line => stripAnsi(line).includes("Stock Pi · Choose a branch")));
  assert.equal(model.sections[0]?.cockpitTier, "quiet", "a questionnaire does not promote generic attention or placement");
});

test("selected fleet actions and details expand inline, board keeps its column", () => {
  for (const width of [60, 120, 160]) {
    const layout = render(width, 40, true);
    assert.ok(layout.lines.some(line => stripAnsi(line).includes("LIVE DETAILS")));
    assert.ok(layout.lines.some(line => stripAnsi(line).includes("Enter Open in Pi")));
    const detail = layout.lines.findIndex(line => stripAnsi(line).includes("LIVE DETAILS"));
    assert.deepEqual(layout.rowTargets[detail], { kind: "session-continuation", id: asking.id });
  }
  assert.notEqual(render(120, 40, false, "stage").workspaceStartX, undefined);
});

test("focused card panel reserves identity and local keys, windows the body, and can take the viewport", () => {
  for (const width of [30, 60]) {
    const commands = buildDashboardCommands({ sessions: [asking], selectedId: asking.id, capabilities: { openSession: true } });
    const input = { sessions: [asking, { ...asking, id: "neighbor", title: "Neighbor" }], selectedId: asking.id, width, height: 12, now,
      workspaceCommands: selectWorkspaceCommands(asking, commands, 3), guidanceHidden: true,
      cardPanel: { body: Array.from({ length: 30 }, (_, index) => `body ${index}`), keyLine: "Enter Send   Esc Keep draft", offset: 0 } };
    const first = renderSessions(buildRenderModel(input));
    assert.ok(first.lines.some(line => stripAnsi(line).includes("Dashboard UI polish")));
    assert.ok(first.lines.some(line => stripAnsi(line).includes("Enter Send")));
    assert.ok(first.lines.some(line => stripAnsi(line).includes("body 0")));
    assert.ok(!first.lines.some(line => stripAnsi(line).includes("Neighbor")));
    const scrolled = renderSessions(buildRenderModel({ ...input, cardPanel: { ...input.cardPanel, offset: 20 } }));
    assert.ok(scrolled.lines.some(line => stripAnsi(line).includes("body 20")));
    assert.ok(!scrolled.lines.some(line => stripAnsi(line).includes("body 0")));
    const tiny = renderSessions(buildRenderModel({ ...input, height: 2 }));
    assert.ok(tiny.lines.some(line => stripAnsi(line).includes("Enter Open in Pi")), tiny.lines.join("\n"));
  }
});

test("a focused panel keeps neighbors when it fits and preserves long body text by scrolling", () => {
  const commands = buildDashboardCommands({ sessions: [asking], selectedId: asking.id, capabilities: { openSession: true } });
  const input = { sessions: [asking, { ...asking, id: "neighbor", title: "Neighbor" }], selectedId: asking.id, width: 160, height: 30, now, guidanceHidden: true,
    workspaceCommands: selectWorkspaceCommands(asking, commands, 3), cardPanel: { body: ["Short panel"], keyLine: "Enter Send", offset: 0 } };
  const roomy = renderSessions(buildRenderModel(input));
  assert.ok(roomy.lines.some(line => stripAnsi(line).includes("Neighbor")));
  assert.ok(roomy.lines.some(line => stripAnsi(line).includes("Short panel")));
  const body = "  " + "界".repeat(126) + "tail-of-body";
  const narrow = { ...input, width: 30, height: 8, cardPanel: { ...input.cardPanel, body: [body] } };
  const first = renderSessions(buildRenderModel(narrow));
  assert.ok(first.lines.every(line => visibleWidth(line) <= 30));
  assert.ok(first.panelViewport!.maxOffset > 0, "one logical line can have many scroll rows");
  const last = renderSessions(buildRenderModel({ ...narrow, cardPanel: { ...narrow.cardPanel, offset: first.panelViewport!.maxOffset } }));
  assert.ok(last.lines.some(line => stripAnsi(line).includes("tail-of-body")), last.lines.join("\n"));
});

test("the same focused panel renders in board and pinned/follow surfaces", () => {
  for (const host of ["board-wide", "board-phone", "pin", "follow"] as const) {
    const width = host === "board-phone" ? 60 : 160;
    const commands = buildDashboardCommands({ sessions: [asking], selectedId: asking.id, capabilities: { openSession: true } });
    const common = { sessions: [asking], selectedId: asking.id, width, height: 24, now,
      workspaceCommands: selectWorkspaceCommands(asking, commands, 3), guidanceHidden: true };
    const input = { ...common, ...(host.startsWith("board") ? { grouping: "stage" as const } : { pinSlots: [asking.id], following: host === "follow" }),
      cardPanel: { body: Array.from({ length: 30 }, (_, index) => `panel body ${index}`), keyLine: "Enter Send   Esc Keep draft", offset: 0 } };
    const first = renderSessions(buildRenderModel(input));
    assert.ok(first.lines.some(line => stripAnsi(line).includes("Dashboard UI polish")), host);
    assert.ok(first.lines.some(line => stripAnsi(line).includes("panel body 0")), host);
    assert.ok(first.lines.some(line => stripAnsi(line).includes("Enter Send")), host);
    if (host === "pin" || host === "follow") {
      assert.ok(first.rowTargets.some(target => target?.kind === "session" && target.id === asking.id), host);
      assert.ok(first.lines.filter(line => stripAnsi(line).includes("panel body")).length > 6, host);
    }
    const last = renderSessions(buildRenderModel({ ...input, cardPanel: { ...input.cardPanel, offset: 29 } }));
    assert.ok(last.lines.some(line => stripAnsi(line).includes("panel body 29")), host);
    const tiny = renderSessions(buildRenderModel({ ...input, height: host === "board-phone" ? 1 : host === "board-wide" ? 2 : 3 }));
    assert.ok(tiny.lines.some(line => stripAnsi(line).includes("Enter Open in Pi")), host + "\n" + tiny.lines.join("\n"));
  }
});

test("short fleet retains selected task and request rather than dense compaction", () => {
  // A short window keeps the docked card's task, then its request one page down.
  const pages = [0, 1, 2].map(cardScrollOffset => renderSessions(buildRenderModel({ sessions: [asking], selectedId: asking.id, width: 80, height: 11, now, guidanceHidden: true, cardScrollOffset })).lines.map(stripAnsi).join("\n")).join("\n");
  assert.match(pages, /Taller fleet cards/);
  assert.match(pages, /▌ +ASK {3}Choose the boundary/);
});

test("selected fleet cards wrap complete task and handoff text through card scrolling", () => {
  const taskTail = "TASK-END";
  const recommendationTail = "RECOMMENDATION-END";
  const evidenceTail = "EVIDENCE-END";
  const selected = { ...asking, context: { ...asking.context!, ticket: { id: "cards-001", subtitle: `${"Complete task context ".repeat(8)}${taskTail}` },
    attention: { kind: "ready" as const, text: `${"Review handoff context ".repeat(8)}REQUEST-END`, requestId: "request",
      recommendation: `${"Use the recommended path ".repeat(8)}${recommendationTail}`,
      artifact: `/tmp/${"evidence-path/".repeat(8)}${evidenceTail}` } } };
  const commands = buildDashboardCommands({ sessions: [selected], selectedId: selected.id, capabilities: { openSession: true } });
  const input = { sessions: [selected], selectedId: selected.id, width: 60, height: 10, now, guidanceHidden: true,
    workspaceCommands: selectWorkspaceCommands(selected, commands, 3) };
  const pages = Array.from({ length: 40 }, (_, cardScrollOffset) => cardScrollOffset).map(cardScrollOffset => renderSessions(buildRenderModel({ ...input, cardScrollOffset })).lines.join("\n")).join("\n");
  for (const tail of [taskTail, "REQUEST-END", recommendationTail, evidenceTail]) assert.match(pages, new RegExp(tail), pages);
});

test("narrow board cards retain receipts when the optional board detail rows are hidden", () => {
  const commands = buildDashboardCommands({ sessions: [asking], selectedId: asking.id, capabilities: { openSession: true } });
  const layout = renderSessions(buildRenderModel({ sessions: [asking], selectedId: asking.id, width: 80, height: 24, now,
    grouping: "stage", guidanceHidden: true, deliveryResults: new Map([[asking.id, "Delivery unknown · Check Pi before retrying"]]),
    workspaceCommands: selectWorkspaceCommands(asking, commands, 3) }));
  assert.ok(layout.lines.some(line => stripAnsi(line).includes("Delivery unknown · Check Pi before retrying")), layout.lines.join("\n"));
});
