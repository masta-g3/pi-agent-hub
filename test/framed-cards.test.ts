import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildRenderModel } from "../src/tui/render-model.js";
import { renderSessions } from "../src/tui/layout.js";
import { buildDashboardCommands, selectWorkspaceCommands } from "../src/tui/dashboard-commands.js";
import { darkTheme, stripAnsi, styleToken } from "../src/tui/theme.js";
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
const STRIPE = "▌";
/** The first row below the dock rule, or the line count when nothing is docked. */
function dockStart(layout: ReturnType<typeof render>): number {
  const rule = layout.lines.findIndex((line, index) => index > 0 && /^─{20,}$/u.test(stripAnsi(line).trim()));
  return rule < 0 ? layout.lines.length : rule + 1;
}
/** Docked card rows: rows below the dock rule whose target is the session and that start with the stripe. */
function cardRows(layout: ReturnType<typeof render>, id = "s"): number[] {
  const start = dockStart(layout);
  return layout.lines.flatMap((line, index) => {
    const target = layout.rowTargets[index];
    return index >= start && target && "id" in target && target.id === id && stripAnsi(line).startsWith(STRIPE) ? [index] : [];
  });
}

test("every selected parent is a striped card in Status and Repo", () => {
  for (const fleetGrouping of ["status", "repo"] as const) for (const width of [160, 120, 80, 60]) {
    const layout = render(width, { fleetGrouping });
    const rows = layout.lines.map(stripAnsi);
    assert.doesNotMatch(rows.join("\n"), /[╭╮╰╯]/);
    const top = rows.findIndex(row => row.startsWith(`${STRIPE} ✓ Selected request`));
    assert.ok(top >= 0, rows.join("\n"));
    const card = cardRows(layout);
    assert.ok(card.includes(top));
    // Every row from the title through the keys carries the stripe and the exact session target.
    const keys = rows.findIndex((row, index) => index > top && row.includes("Open in Pi"));
    for (let index = top; index <= keys; index++) assert.ok(card.includes(index), `${width}: ${rows[index]}`);
    // The docked card names the group once.
    assert.equal(rows.slice(dockStart(layout)).filter(row => row.includes("cards")).length, 1);
    assert.doesNotMatch(rows.join("\n"), /\[cards\]|◈/);
    // Workflow position lives in the module's STEP field, never on its title row.
    assert.doesNotMatch(rows[top]!, /PL|EX|◉/);
    const step = rows.find((row, index) => index > top && /STEP/.test(row))!;
    if (width >= 100) assert.match(rows[rows.indexOf(step) + 1]!, /PL✓ EX◉/);
    else assert.match(step, width >= 80 ? /STEP {2}PL✓ EX◉/ : /STEP {2}Execute/);
    assert.ok(layout.lines.every(row => visibleWidth(row) <= width));
  }
  const plain = { ...session, title: "Plain working card", status: "running" as const, context: undefined };
  const plainLayout = render(120, { sessions: [plain] });
  assert.match(plainLayout.lines.map(stripAnsi).join("\n"), new RegExp(`${STRIPE} ● Plain working card`));
  for (const extra of [{ grouping: "stage" as const }, { pinSlots: ["s"] }]) assert.equal(cardRows(render(120, extra)).length <= 1, true);
  const moved = render(120, { selectedId: "other", sessions: [session, { ...session, id: "other", title: "Other", context: undefined }] });
  assert.ok(cardRows(moved, "other").length > 1);
  assert.equal(cardRows(moved, "s").length, 0);
});

test("the card stripe carries the request signal, error, and neutral tones", () => {
  const stripe = (layout: ReturnType<typeof render>, tone: "warning" | "success" | "error" | "accent") =>
    assert.ok(layout.lines.some(row => stripAnsi(row).startsWith(STRIPE) && row.includes(styleToken(darkTheme, tone, STRIPE))), tone);
  stripe(render(120, { selectedQuestion: { header: "Scope", question: "Choose one" } }), "warning");
  // Every request kind is the user's move, so ready and blocked share the one signal tone.
  stripe(render(120), "warning");
  stripe(render(120, { sessions: [{ ...session, context: { ...session.context!, attention: { kind: "blocked", text: "Cannot continue", requestId: "blocked" } } }] }), "warning");
  stripe(render(120, { sessions: [{ ...session, status: "error", error: "Pi stopped", context: undefined }] }), "error");
  stripe(render(120, { sessions: [{ ...session, status: "running", context: undefined }] }), "accent");
});

test("selected requests show their kind label beside the text in the signal tone", () => {
  const ready = render(120).lines.map(stripAnsi);
  assert.ok(ready.some(row => /^▌ {3}RDY {3}Review these results/.test(row)), ready.join("\n"));
  const question = render(120, { selectedQuestion: { header: "Scope", question: "Choose one" } }).lines.map(stripAnsi);
  assert.ok(question.some(row => /^▌ {3}ASK {3}Scope · Choose one/.test(row)), question.join("\n"));
  assert.ok(render(120).lines.some(row => row.includes(styleToken(darkTheme, "warning", "RDY"))));
});

test("the selected task line is muted and never dim on the selected surface", () => {
  const layout = render(120);
  const task = layout.lines.slice(dockStart(layout)).find(row => stripAnsi(row).includes("Keep the task"))!;
  assert.ok(task.includes(styleToken(darkTheme, "muted", "Keep the task")), JSON.stringify(task));
  assert.ok(!task.includes(styleToken(darkTheme, "dim", "Keep the task")));
});

test("the docked card starts at its identity row and ends with its keys at every height", () => {
  for (const [width, height] of [[120, 30], [60, 30], [120, 12]] as const) {
    const layout = render(width, { height });
    const rows = layout.lines.map(stripAnsi);
    const card = cardRows(layout);
    assert.equal(card[0], dockStart(layout), `${width}x${height}:\n${rows.join("\n")}`);
    assert.match(rows[card[0]!]!, /Selected request/);
    assert.match(rows[card.at(-1)!]!, /Open in Pi/, `${width}x${height}:\n${rows.join("\n")}`);
  }
});
test("card key hits land on each rendered key", () => {
  for (const width of [160, 120, 60]) {
    const layout = render(width);
    assert.ok(layout.cardCommandHits.length > 0);
    for (const hit of layout.cardCommandHits) {
      const text = stripAnsi(layout.lines[hit.row]!).slice(hit.x - 1, hit.x - 1 + hit.width);
      // A hit covers the whole keycap, including its padding, then the label.
      assert.match(text, /^ ?\S/, `${width}: ${hit.commandId} → "${text}"`);
      assert.equal(text, text.trimEnd(), `${width}: ${hit.commandId} → "${text}"`);
    }
  }
});

test("plain and request selections share one card content width", () => {
  const plain = { ...session, id: "plain", title: "Plain", status: "running" as const, context: undefined };
  const request = { ...session, id: "request", title: "Request" };
  const sessions = [plain, request];
  // The workflow markers on the title row end at the same column whatever the card holds.
  const titleEnd = (layout: ReturnType<typeof render>, id: string) => stripAnsi(layout.lines[cardRows(layout, id).find(index => /◉/.test(stripAnsi(layout.lines[index]!)))!]!).trimEnd().length;
  assert.equal(titleEnd(render(120, { sessions, selectedId: plain.id }), plain.id), titleEnd(render(120, { sessions, selectedId: request.id }), request.id));
});

test("selected subagent micro rows and synthetic headers stay unstriped cards", () => {
  const child: RuntimeSession = { ...session, id: "child", title: "Child", kind: "subagent", parentId: session.id, agentName: "worker", taskPreview: "Inspect tests" };
  const childLayout = render(120, { sessions: [session, child], selectedId: child.id, expandedProjectParentIds: new Set([session.id]) });
  // A selected child docks its micro row and actions, not a parent card.
  assert.match(stripAnsi(childLayout.lines[dockStart(childLayout)]!), /worker/);
  assert.equal(cardRows(childLayout, "s").length, 0);
  const synthetic = render(120, { selectedSection: "active" });
  assert.equal(cardRows(synthetic).length, 0);
});

test("a crowded title moves the group once and its module still names its steps", () => {
  const selected = { ...session, title: "A complete readable title before its long group", group: "A complete long group", worktreePath: "/tmp/tree", worktreeBranch: "feature" };
  // A card below another one in its section names its own steps.
  const above = { ...session, id: "above", title: "Above", context: { ...session.context!, updatedAt: 5, attention: { kind: "ready" as const, text: "Newer", requestId: "newer" } }, lastActivityAt: 5 };
  const crowded = render(70, { sessions: [above, selected] });
  const rows = crowded.lines.map(stripAnsi);
  const top = rows.findIndex((row, index) => index >= dockStart(crowded) && row.includes("A complete readable title"));
  assert.doesNotMatch(rows[top]!, /A complete long group/);
  assert.match(rows[top]!, /A complete readable title before its long group ⎇/);
  assert.match(rows[top + 1]!, /A complete long group/);
  assert.ok(rows.some((row, index) => index > top && /STEP {2}Execute/.test(row)), rows.join("\n"));
  assert.equal(rows.slice(top).filter(row => row.includes("A complete long group")).length, 1);
});

test("card keys stay complete and fixed as the body scrolls at every width", () => {
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
    assert.doesNotMatch(rows.join("\n"), /[╭╮╰╯]/);
    assert.ok(cardRows(first).length > 3);
  }
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
  assert.match(stripAnsi(view.render(120).join("\n")), /▌ .*Selected request[\s\S]*✓ Sent · Accepted/);
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
