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
  s("docs", "Docs refresh", "llmpedia", "waiting", { workflow: wf(2), context: { version: 1, updatedAt: NOW, attention: { requestId: "r1", kind: "question", text: "Which changelog section wins when two releases touch the same feature?" }, ticket: { id: "docs-014", subtitle: "Refresh the public changelog" }, progress: { done: "Rewrote the changelog for 1.2 and merged duplicate entries.", next: "Waiting for your choice on overlapping sections.", updatedAt: NOW } } }),
  s("sched", "Workflow Performance", "llmpedia", "idle", { acknowledgedAt: 1, context: { version: 1, updatedAt: NOW, attention: { requestId: "r2", kind: "ready", text: "Fixed the recurring scheduler error causes since Oct 28.", recommendation: "Review the three commits, then restart the runner.", artifact: "/repos/llmpedia/agent-work/tickets/sched/validation.md" }, progress: { done: "Found and fixed three scheduler faults; all jobs ran clean twice.", next: "Awaiting review.", updatedAt: NOW } } }),
  s("qa", "Flaky test hunt", "pi-agent-hub", "error", { error: "provider returned 529 three times" }),
  s("panel", "Mission control", "pi-agent-hub", "running", { lastActivityAt: NOW, workflow: wf(1, { activeMode: { id: "focus", short: "FOC", label: "Focus" }, plan: { phase: { index: 2, count: 4, title: "Roster and detail pane" }, tasks: { completed: 6, total: 15 }, phases: [{ completed: 4, total: 4 }, { completed: 2, total: 5 }, { completed: 0, total: 4 }, { completed: 0, total: 2 }], nextStep: "Render the detail pane beside the roster", current: { before: 0, after: 0, tasks: [{ done: true, text: "Roster rows show one status line" }, { done: true, text: "Publish live tool calls in the heartbeat" }, { done: false, text: "Render the detail pane beside the roster at 100+ columns" }, { done: false, text: "Show the plan checklist with the current task marked" }, { done: false, text: "Keep Answer and Reply inside the pane" }] } } }), context: { version: 1, updatedAt: NOW, ticket: { id: "fleet-design-004", subtitle: "Two-pane mission control for the fleet" }, progress: { done: "Roster rows and live tool activity work end to end.", next: "Building the detail pane with the plan checklist.", updatedAt: NOW } }, activity: { current: act("bash", "npm run typecheck", 3), recent: [act("edit", "src/tui/layout.ts", 21), act("read", "src/tui/render-model.ts", 48), act("bash", "node --test dist/test/fleet-cards.test.js", 95), act("edit", "src/core/heartbeat.ts", 160)] } }),
  s("critic", "code-critic", "pi-agent-hub", "running", { kind: "subagent", parentId: "panel", agentName: "code-critic", taskPreview: "Review layout changes against the plan" }),
  s("map", "Pixel Map Review", "sfcity", "running", { lastActivityAt: NOW, workflow: wf(2, { activity: { id: "reviewing-implementation", label: "Reviewing changes" } }), activity: { current: act("tmux_subagent", "code-critic critic-map", 40), recent: [act("bash", "git diff --stat", 70)] }, context: { version: 1, updatedAt: NOW, ticket: { id: "mapart-011", subtitle: "Landmarks read clearly at every zoom" } } }),
  s("job", "Job Status", "llmpedia", "running", { lastActivityAt: NOW, activity: { current: act("bash", "uv run python scripts/export_homepage.py --dry-run", 12) } }),
  s("ipad", "Ipad Tree Navigation", "atlas", "idle", { context: { version: 1, updatedAt: 5, progress: { done: "Tree rows now open with one tap on iPad Safari.", updatedAt: 5 } } }),
  s("undo", "Action undo", "pi-agent-hub", "idle", { workflow: wf(1, { currentStepComplete: true }) }),
  s("old", "Topic editor", "social", "stopped", { bucket: "archived", bucketChangedAt: NOW - 3600_000 }),
];
export function frame(width, height, sel, extra = {}, ansi = false, theme = darkTheme) {
  const selected = sessions.find(x => x.id === sel);
  const commands = buildDashboardCommands({ sessions, selectedId: sel, capabilities: { openSession: true, restart: true, sendMessage: true, pinSidePane: true, assignSidePaneSlot: true, focusSidePaneSlot: true, acknowledge: true }, pinState: { slots: [], count: 0, capacity: 2, constrained: false } });
  const model = buildRenderModel({ sessions, selectedId: sel, width, height, now: NOW, guidanceHidden: true, workspaceCommands: selectWorkspaceCommands(selected, commands, 3),
    selectedMessage: sel === "panel" ? "Roster rows are in. Each agent now shows **one status line**: its request, fault, or live tool call.\n\nNext I render the detail pane:\n- plan checklist\n- recent actions\n- your reply box" : sel === "docs" ? "I rewrote the 1.2 changelog. Two releases touch *inline answers*; I need to know which section should own it." : undefined, ...extra });
  return renderSessions(model, theme).lines.map(ansi ? x => x : stripAnsi).join("\n");
}
if (process.argv[1]?.endsWith("demo.mjs") && process.argv[2]) console.log(frame(Number(process.argv[2]), Number(process.argv[3] ?? 34), process.argv[4] ?? "panel", {}, Boolean(process.argv[5])));
export const replyPanel = { kind: "reply", body: ["Reply to Mission control", { value: "Looks good, keep the checklist to 7 rows", cursor: 40 }], keyLine: "Enter Send · Tab Steer · Esc Close", offset: 0 };
