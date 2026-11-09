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
/** Card rows: every visible row whose target is the selected session and starts with the stripe. */
function cardRows(layout: ReturnType<typeof render>, id = "s"): number[] {
  return layout.lines.flatMap((line, index) => {
    const target = layout.rowTargets[index];
    return target && "id" in target && target.id === id && stripAnsi(line).startsWith(STRIPE) ? [index] : [];
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
    assert.equal(rows.filter(row => row.includes("cards")).length, 1);
    assert.doesNotMatch(rows.join("\n"), /\[cards\]|◈/);
    if (width >= 80) assert.match(rows[top - (width > 60 ? 2 : 1)]!, /PL\s+EX/, "a card right under its header leaves step labels to the header");
    else assert.ok(rows[top + 1]!.includes("Execute"));
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

test("the card stripe carries question, ready, blocker, error, and neutral tones", () => {
  const stripe = (layout: ReturnType<typeof render>, tone: "warning" | "success" | "error" | "accent") =>
    assert.ok(layout.lines.some(row => stripAnsi(row).startsWith(STRIPE) && row.includes(styleToken(darkTheme, tone, STRIPE))), tone);
  stripe(render(120, { selectedQuestion: { header: "Scope", question: "Choose one" } }), "warning");
  stripe(render(120), "success");
  stripe(render(120, { sessions: [{ ...session, context: { ...session.context!, attention: { kind: "blocked", text: "Cannot continue", requestId: "blocked" } } }] }), "error");
  stripe(render(120, { sessions: [{ ...session, status: "error", error: "Pi stopped", context: undefined }] }), "error");
  stripe(render(120, { sessions: [{ ...session, status: "running", context: undefined }] }), "accent");
});

test("selected requests show a filled kind pill above their text", () => {
  const ready = render(120).lines.map(stripAnsi);
  const pill = ready.findIndex(row => /^▌ {3} READY\b/.test(row));
  assert.ok(pill >= 0, ready.join("\n"));
  assert.match(ready[pill + 1]!, /^▌ {3}Review these results/);
  const question = render(120, { selectedQuestion: { header: "Scope", question: "Choose one" } }).lines.map(stripAnsi);
  const questionPill = question.findIndex(row => /^▌ {3} QUESTION\b/.test(row));
  assert.ok(questionPill >= 0, question.join("\n"));
  assert.match(question[questionPill + 1]!, /Scope · Choose one/);
  const mocha = { ...darkTheme, text: "#cdd6f4", selectedBg: "#313244", statusLineBg: "" };
  // Painted pills fill with the request tone (#9ece6a for ready in the default palette).
  assert.ok(render(120, {}).lines.length && renderSessions(buildRenderModel({ sessions: [session], selectedId: "s", width: 120, height: 30, guidanceHidden: true }), mocha)
    .lines.some(row => row.includes("\u001b[48;2;158;206;106m") && stripAnsi(row).includes(" READY ")));
});

test("the selected task line is muted and never dim on the selected surface", () => {
  const layout = render(120);
  const task = layout.lines.find(row => stripAnsi(row).includes("Keep the task"))!;
  assert.ok(task.includes(styleToken(darkTheme, "muted", "Keep the task")), JSON.stringify(task));
  assert.ok(!task.includes(styleToken(darkTheme, "dim", "Keep the task")));
});

test("desktop cards pad above the title and below the keys only when rows spare", () => {
  const roomy = render(120);
  const rows = roomy.lines.map(stripAnsi);
  const card = cardRows(roomy);
  const title = rows.findIndex(row => row.includes("Selected request"));
  assert.equal(rows[card[0]!]!.trim(), STRIPE, "a padding row opens the card");
  assert.equal(card[0], title - 1);
  assert.equal(rows[card.at(-1)!]!.trim(), STRIPE, "a padding row closes the card");
  assert.match(rows[card.at(-1)! - 1]!, /Open in Pi/);
  const phone = render(60);
  const phoneRows = phone.lines.map(stripAnsi);
  assert.ok(cardRows(phone).every(index => phoneRows[index]!.trim() !== STRIPE || phoneRows[index - 1]?.includes("Keep the task")), phoneRows.join("\n"));
  assert.match(phoneRows[cardRows(phone)[0]!]!, /Selected request/);
  const tight = render(120, { height: 9 });
  const tightRows = tight.lines.map(stripAnsi);
  assert.match(tightRows[cardRows(tight)[0]!]!, /Selected request/, tightRows.join("\n"));
  assert.match(tightRows.join("\n"), /Open in Pi/);
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
  assert.ok(cardRows(childLayout, "child").length <= 1);
  assert.equal(cardRows(childLayout, "s").length, 0);
  const synthetic = render(120, { selectedSection: "active" });
  assert.equal(cardRows(synthetic).length, 0);
});

test("a crowded title moves the group once and aligns its own producer labels and markers", () => {
  const selected = { ...session, title: "A complete readable title before its long group", group: "A complete long group", worktreePath: "/tmp/tree", worktreeBranch: "feature" };
  // A card below another one in its section names its own steps.
  const above = { ...session, id: "above", title: "Above", context: { ...session.context!, updatedAt: 5, attention: { kind: "ready" as const, text: "Newer", requestId: "newer" } }, lastActivityAt: 5 };
  const rows = render(80, { sessions: [above, selected] }).lines.map(stripAnsi);
  const top = rows.findIndex(row => row.startsWith(STRIPE) && row.includes("A complete readable title"));
  assert.doesNotMatch(rows[top]!, /A complete long group/);
  assert.match(rows[top]!, /A complete readable title before its long group ⎇/);
  assert.match(rows[top + 1]!, /A complete long group/);
  assert.equal(rows[top]!.indexOf("PL"), rows[top + 1]!.indexOf("✓"));
  assert.equal(rows[top]!.indexOf("EX"), rows[top + 1]!.indexOf("◉"));
  assert.equal(rows.filter(row => row.includes("A complete long group")).length, 1);
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
test("a request gains a blank above it only when the whole card fits", () => {
  const roomy = render(80).lines.map(stripAnsi);
  const task = roomy.findIndex(row => row.includes("Keep the task"));
  assert.equal(roomy[task + 1]!.trim(), STRIPE);
  const tight = render(80, { height: 8 }).lines.map(stripAnsi);
  const tightTask = tight.findIndex(row => row.includes("Keep the task"));
  if (tightTask >= 0) assert.notEqual(tight[tightTask + 1]!.trim(), STRIPE);
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
