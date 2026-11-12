const R = process.env.ROOT + "/dist/";
const { buildRenderModel } = await import(R + "src/tui/render-model.js");
const { renderSessions } = await import(R + "src/tui/layout.js");
const { buildDashboardCommands, selectWorkspaceCommands } = await import(R + "src/tui/dashboard-commands.js");
const { stripAnsi, darkTheme } = await import(R + "src/tui/theme.js");
const NOW = 1_800_000_000_000;
const steps = [["plan-md","PL","Plan"],["execute","EX","Execute"],["review","RV","Review"],["reflect","RF","Reflect"],["commit","CM","Commit"]].map(([id, short, label]) => ({ id, short, label }));
const wf = (i, extra = {}) => ({ steps, activeIndex: i, updatedAt: NOW, ...extra });
const s = (id, title, group, status, extra = {}) => ({ id, title, cwd: `/repos/${group}`, group, tmuxSession: id, status, createdAt: 1, updatedAt: 1, acknowledgedAt: NOW, lastActivityAt: NOW - 4 * 60000, ...extra });
const act = (tool, detail, ago) => ({ tool, detail, at: NOW - ago * 1000 });
export const sessions = [
  s("docs", "Docs refresh", "data", "waiting", { workflow: wf(2), context: { version: 1, updatedAt: NOW, attention: { requestId: "r1", kind: "question", text: "Which changelog section wins when two releases touch the same feature?" }, ticket: { id: "docs-014", subtitle: "Refresh the public changelog" }, progress: { done: "Rewrote the changelog for 1.2 and merged duplicate entries.", next: "Waiting for your choice on overlapping sections.", updatedAt: NOW } } }),
  s("sched", "Nightly jobs", "data", "idle", { acknowledgedAt: 1, context: { version: 1, updatedAt: NOW, attention: { requestId: "r2", kind: "ready", text: "Fixed the recurring scheduler error causes since last week.", recommendation: "Review the three commits, then restart the runner.", artifact: "/repos/data/agent-work/tickets/sched/validation.md" }, progress: { done: "Found and fixed three scheduler faults; all jobs ran clean twice.", next: "Awaiting review.", updatedAt: NOW } } }),
  s("qa", "Flaky test hunt", "core", "error", { error: "provider returned 529 three times" }),
  s("panel", "Checkout flow", "storefront", "running", { lastActivityAt: NOW, workflow: wf(1, { activeMode: { id: "focus", short: "FOC", label: "Focus" }, plan: { phase: { index: 2, count: 4, title: "Payment and address forms" }, tasks: { completed: 6, total: 15 }, phases: [{ completed: 4, total: 4 }, { completed: 2, total: 5 }, { completed: 0, total: 4 }, { completed: 0, total: 2 }], nextStep: "Wire the payment form", current: { before: 0, after: 0, tasks: [{ done: true, text: "Add the guest checkout route" }, { done: true, text: "Validate addresses before payment" }, { done: false, text: "Wire the payment form to the tokenizer" }, { done: false, text: "Save the cart when the session expires" }, { done: false, text: "Add end-to-end tests for mobile Safari" }] } } }), context: { version: 1, updatedAt: NOW, ticket: { id: "shop-042", subtitle: "Guest checkout for mobile shoppers" }, progress: { done: "Guest route and address validation pass their tests.", next: "Connect the payment form to the tokenizer.", updatedAt: NOW } }, activity: { current: act("bash", "npm run test -- payment", 3), recent: [act("edit", "src/checkout/PaymentForm.tsx", 21), act("read", "src/checkout/address.ts", 48), act("bash", "npm test -- checkout", 95), act("edit", "src/routes/guest.ts", 160)] } }),
  s("critic", "code-critic", "core", "running", { kind: "subagent", parentId: "panel", agentName: "code-critic", taskPreview: "Review the address validation diff" }),
  s("map", "Map tiles review", "maps", "running", { lastActivityAt: NOW, workflow: wf(2, { activity: { id: "reviewing-implementation", label: "Reviewing changes" } }), activity: { current: act("tmux_subagent", "code-critic critic-map", 40), recent: [act("bash", "git diff --stat", 70)] }, context: { version: 1, updatedAt: NOW, ticket: { id: "maps-011", subtitle: "Landmarks read clearly at every zoom" } } }),
  s("job", "Export pipeline", "data", "running", { lastActivityAt: NOW, activity: { current: act("bash", "uv run python scripts/export_reports.py --dry-run", 12) } }),
  s("ipad", "Tablet navigation", "mobile", "idle", { context: { version: 1, updatedAt: 5, progress: { done: "Menu rows now open with one tap on tablets.", updatedAt: 5 } } }),
  s("undo", "Search ranking", "search", "idle", { workflow: wf(1, { currentStepComplete: true }) }),
  s("old", "Landing page", "web", "stopped", { bucket: "archived", bucketChangedAt: NOW - 3600_000 }),
];
export function frame(width, height, sel, extra = {}, ansi = false, theme = darkTheme) {
  const selected = sessions.find(x => x.id === sel);
  const commands = buildDashboardCommands({ sessions, selectedId: sel, capabilities: { openSession: true, restart: true, sendMessage: true, pinSidePane: true, assignSidePaneSlot: true, focusSidePaneSlot: true, acknowledge: true }, pinState: { slots: [], count: 0, capacity: 2, constrained: false } });
  const model = buildRenderModel({ sessions, selectedId: sel, width, height, now: NOW, guidanceHidden: true, workspaceCommands: selectWorkspaceCommands(selected, commands, 3),
    selectedMessage: sel === "panel" ? "Guest checkout now **skips account creation** and validates the address before payment.\n\nNext I connect the payment form:\n- tokenize the card on submit\n- show inline card errors\n- keep the cart if payment fails" : sel === "docs" ? "I rewrote the 1.2 changelog. Two releases touch *inline answers*; I need to know which section should own it." : undefined, ...extra });
  return renderSessions(model, theme).lines.map(ansi ? x => x : stripAnsi).join("\n");
}
if (process.argv[1]?.endsWith("demo.mjs") && process.argv[2]) console.log(frame(Number(process.argv[2]), Number(process.argv[3] ?? 34), process.argv[4] ?? "panel", {}, Boolean(process.argv[5])));
export const replyPanel = { kind: "reply", body: ["Reply to Mission control", { value: "Looks good, keep the checklist to 7 rows", cursor: 40 }], keyLine: "Enter Send · Tab Steer · Esc Close", offset: 0 };
