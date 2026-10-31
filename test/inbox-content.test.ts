import test from "node:test";
import assert from "node:assert/strict";
import { buildRenderModel, visibleAttention } from "../src/tui/render-model.js";
import { renderSessions } from "../src/tui/layout.js";
import { buildDashboardCommands, selectWorkspaceCommands } from "../src/tui/dashboard-commands.js";
import { darkTheme, stripAnsi, styleToken } from "../src/tui/theme.js";
import { markAcknowledged } from "../src/core/status.js";
import type { RuntimeSession } from "../src/core/types.js";
import type { SessionInteractionState } from "../src/core/session-interaction.js";

const now = 1_800_000_000_000;
const asking: RuntimeSession = {
  id: "s", title: "Workflow Rewrite Plan", cwd: "/tmp/wf", group: "wf", tmuxSession: "s", status: "idle",
  piSessionId: "pi", interaction: { version: 1, instanceId: "instance" }, createdAt: now, updatedAt: now, lastActivityAt: now,
  worktreeBranch: "arch-003",
  worktreeLifecycle: { version: 1, recordId: "r", producer: "rules", revision: 1, updatedAt: now,
    repositories: [{ sourcePath: "/Users/me/Code/wf", worktreePath: "/Users/me/.local/share/agent-worktrees/arch-003/wf", branch: "arch-003", role: "primary", state: "active" }] },
  context: { version: 1, updatedAt: now, ticket: { id: "arch-003", subtitle: "Replace shell runner with Python core" },
    attention: { kind: "question", text: "Do you approve the approach?", requestId: "req-1" } },
  workflow: { updatedAt: now, activeIndex: 0, activity: { id: "clarifying-requirements", label: "Clarifying scope" },
    steps: [{ id: "plan", short: "PL", label: "Plan" }, { id: "execute", short: "EX", label: "Execute" }, { id: "review", short: "RV", label: "Review" }] },
};
const question = { header: "Approve plan", question: "Do you approve the approach and these checks for arch-003? The approach: one Python package.", options: [{ label: "Approve", description: "Go" }, { label: "Change", description: "Edit" }] };
const pending = { toolCallId: "call", params: { questions: [question] } };

function render(width: number, extra: Partial<Parameters<typeof buildRenderModel>[0]> = {}, interactionState?: SessionInteractionState, session = asking) {
  const commands = buildDashboardCommands({ sessions: [session], selectedId: session.id, interactionState,
    capabilities: { openSession: true, sendMessage: true, answerQuestion: true } });
  return renderSessions(buildRenderModel({ sessions: [session], selectedId: session.id, width, height: 30, now, guidanceHidden: true,
    workspaceCommands: selectWorkspaceCommands(session, commands, 3), ...extra }), darkTheme);
}
const text = (layout: ReturnType<typeof render>) => layout.lines.map(stripAnsi).join("\n");

test("an open question or blocker stays in NEEDS YOU after being read; only mark-read or a new request clears it", () => {
  const read = { ...asking, acknowledgedAt: now + 5 };
  assert.equal(visibleAttention(read)?.kind, "question");
  assert.equal(buildRenderModel({ sessions: [read], width: 120, now }).sections[0]?.cockpitTier, "needs-you");
  const blocked: RuntimeSession = { ...read, context: { ...read.context!, attention: { kind: "blocked", text: "Need credentials", requestId: "req-b" } } };
  assert.equal(visibleAttention(blocked)?.kind, "blocked");
  assert.equal(visibleAttention({ ...read, dismissedRequestId: "req-1" }), undefined);
  assert.equal(visibleAttention({ ...blocked, dismissedRequestId: "req-1" })?.kind, "blocked", "dismissal is bound to its exact request");
  const ready: RuntimeSession = { ...read, context: { ...read.context!, attention: { kind: "ready", text: "Done", requestId: "req-r" } } };
  assert.equal(visibleAttention(ready), undefined, "a read handoff still leaves NEEDS YOU");
});

test("mark-read records the exact dismissed request; plain reading does not", () => {
  const waiting = { ...asking, status: "waiting" as const };
  assert.equal(markAcknowledged(waiting, now).dismissedRequestId, undefined);
  const dismissed = markAcknowledged(waiting, now, true, "req-1");
  assert.equal(dismissed.dismissedRequestId, "req-1");
  assert.equal(dismissed.acknowledgedAt, now);
});

test("the selected card shows the task in primary text and hides activity while a request shows", () => {
  const layout = render(120);
  const rows = layout.lines.map(stripAnsi);
  const task = layout.lines.find(line => stripAnsi(line).includes("Replace shell runner"))!;
  assert.ok(!task.includes(styleToken(darkTheme, "muted", "Replace")), "task is not muted on the selected card");
  assert.doesNotMatch(rows.join("\n"), /Clarifying scope/);
  const working = { ...asking, status: "running" as const, context: { ...asking.context!, attention: undefined } };
  assert.match(text(render(120, {}, undefined, working)), /Clarifying scope/);
});

test("worktree lifecycle paths appear only in Details", () => {
  assert.doesNotMatch(text(render(120)), /agent-worktrees|primary: active/);
  assert.match(text(render(120, { workspaceEvidenceVisible: true })), /primary: active/);
});

test("guidance shows only a specific reason, never a restated request", () => {
  const old: SessionInteractionState = { questionProtocol: true, pending: [pending], messageDelivery: "busy" };
  const oldText = text(render(120, { selectedQuestion: question }, old));
  assert.match(oldText, /Reload Pi in this session to answer from Hub/);
  assert.doesNotMatch(oldText, /Answer in the Pi session/);
  assert.doesNotMatch(text(render(120)), /Answer in the Pi session/);
  for (const attention of [{ kind: "ready" as const, text: "Done", requestId: "r" }, { kind: "blocked" as const, text: "Stuck", requestId: "b" }]) {
    const rendered = text(render(120, {}, undefined, { ...asking, context: { ...asking.context!, attention } }));
    assert.doesNotMatch(rendered, /Review the completed result|Resolve the reported blocker/);
  }
});

test("a framed card right under its section header does not repeat the step labels", () => {
  const rows = render(120).lines.map(stripAnsi);
  const top = rows.findIndex(row => row.includes("╭─"));
  assert.match(rows[top - 1]!, /PL\s+EX\s+RV/);
  assert.doesNotMatch(rows[top]!, /PL EX RV/);
  const other: RuntimeSession = { ...asking, id: "first", title: "First card", status: "running", context: undefined, lastActivityAt: now + 10 };
  const lower = renderSessions(buildRenderModel({ sessions: [other, { ...asking, status: "running", context: undefined }], selectedId: "s", width: 120, height: 30, now, guidanceHidden: true }), darkTheme).lines.map(stripAnsi);
  assert.match(lower.find(row => row.includes("╭─"))!, /PL EX RV/, "a card further down keeps its own labels");
});

test("the collapsed request line leads with the asking sentence", async () => {
  const { collapsedQuestion } = await import("../src/tui/question-dialog.js");
  assert.deepEqual(collapsedQuestion({ header: "Approve plan", question: "Plan: costs-004.md. One change touches the logger. Is the plan done when: (1) rows match (2) tests pass?" }),
    { header: "Approve plan", question: "Is the plan done when: · 2 conditions" });
  assert.deepEqual(collapsedQuestion({ header: "Scope", question: "Keep it? It is small." }), { header: "Scope", question: "Keep it?" });
  assert.deepEqual(collapsedQuestion({ header: "Raw", question: "No question mark here" }), { header: "Raw", question: "No question mark here" });
});
