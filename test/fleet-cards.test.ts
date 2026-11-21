import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildRenderModel, type BuildRenderModelInput } from "../src/tui/render-model.js";
import { renderSessions, type SessionListTarget } from "../src/tui/layout.js";
import { buildDashboardCommands, selectWorkspaceCommands } from "../src/tui/dashboard-commands.js";
import { darkTheme, stripAnsi, styleToken } from "../src/tui/theme.js";
import type { RuntimeSession } from "../src/core/types.js";

const NOW = 1_800_000_000_000;
const workflow = {
  version: 1 as const, source: "test", activeIndex: 1, updatedAt: NOW,
  steps: [{ id: "plan", short: "PL", label: "Plan" }, { id: "execute", short: "EX", label: "Execute" }, { id: "review", short: "RV", label: "Review" }],
};

function session(id: string, overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    id, title: `Session ${id}`, cwd: "/tmp/hub-repo", group: "cards", tmuxSession: `pi-agent-hub-${id}`,
    status: "running", createdAt: NOW, updatedAt: NOW, lastActivityAt: NOW, ...overrides,
  };
}

const rich = session("rich", {
  title: "Dashboard UI polish",
  worktreeBranch: "feat/taller-cards",
  context: { version: 1, updatedAt: NOW, ticket: { id: "cards-001", subtitle: "Taller fleet cards" } },
  workflow: {
    ...workflow,
    activity: { id: "writing-plan", label: "writing plan", pass: 2 },
    plan: { phase: { title: "Tests", index: 2, count: 4 }, tasks: { completed: 3, total: 8 } },
    lens: {
      doing: "writing plan", stages: [{ label: "1", state: "done" }, { label: "2", state: "active" }, { label: "3", state: "pending" }, { label: "4", state: "pending" }],
      progress: { completed: 3, total: 8 }, pass: 2,
      list: { label: "PLAN", head: "Tests", items: [{ state: "active", text: "Write the card tests" }], before: 0, after: 0 },
    },
  },
});

function render(sessions: RuntimeSession[], input: Partial<BuildRenderModelInput> = {}) {
  const selectedId = input.selectedId ?? sessions[0]!.id;
  const layout = renderSessions(buildRenderModel({
    sessions, selectedId, width: 160, height: 60, now: NOW, guidanceHidden: true, ...input,
  }));
  const lines = layout.lines.map(stripAnsi);
  const side = isSidePane(layout, lines);
  // The roster's own text: at 100+ the selected card's pane shares these rows to the right of `│`.
  const roster = side ? lines.map((line) => columns(line, 0, layout.listWidth)) : lines;
  const pane = side ? lines.flatMap((line) => columns(line, layout.listWidth, layout.listWidth + 1) === "│" ? [columns(line, layout.listWidth + 1).trimEnd()] : []) : undefined;
  return { layout, lines, roster, pane, selectedId };
}

function columns(line: string, from: number, to?: number): string {
  return Array.from(line).slice(from, to).join("");
}

function isSidePane(layout: ReturnType<typeof renderSessions>, lines: string[]): boolean {
  return lines.some((line, index) => index > 0 && columns(line, layout.listWidth, layout.listWidth + 1) === "│")
    && !lines.some((line, index) => index > 0 && /^─{20,}$/u.test(line.trim()));
}

function targetId(target: SessionListTarget | undefined): string | undefined {
  return target && "id" in target ? target.id : undefined;
}

function titleLine(rendered: ReturnType<typeof render>, id: string): string {
  return rendered.roster[rendered.layout.rowTargets.findIndex((target) => target?.kind === "session" && target.id === id)] ?? "";
}

/** The first row of the docked card below the dock rule, or -1 when nothing is docked. */
function dockStart(rendered: ReturnType<typeof render>): number {
  const rule = rendered.lines.findIndex((line, index) => index > 0 && /^─{20,}$/u.test(line.trim()));
  return rule < 0 ? -1 : rule + 1;
}

const isKeyLine = (line: string) => /Enter Open in Pi|: All actions/u.test(line);

/**
 * The detail lines for one session: the selected card beside the roster at 100+ or docked below it,
 * without its identity and key rows; otherwise the module's status lines under its roster title.
 */
function cardLines(rendered: ReturnType<typeof render>, id: string): string[] {
  if (rendered.pane && rendered.selectedId === id) {
    return rendered.pane.filter((line) => line.trim() && !isKeyLine(line)).slice(1);
  }
  const targets = rendered.layout.rowTargets;
  const dock = dockStart(rendered);
  const docked = dock >= 0 && targetId(targets[dock]) === id;
  const title = docked ? dock : targets.findIndex((target) => target?.kind === "session" && target.id === id);
  if (title < 0) return [];
  const lines: string[] = [];
  for (let index = title + 1; targets[index]?.kind === "session-continuation" && targetId(targets[index]) === id; index += 1) {
    const line = rendered.roster[index]!;
    if (!isKeyLine(line) && line.replace(/[▌\s]/gu, "")) lines.push(line);
  }
  return lines;
}

/** The selected card's identity row: the side pane's first row at 100+, else the docked card's first row. */
function cardTitle(rendered: ReturnType<typeof render>): string {
  if (rendered.pane) return rendered.pane.find((line) => line.trim()) ?? "";
  const dock = dockStart(rendered);
  return dock < 0 ? "" : rendered.lines[dock] ?? "";
}

const open = session("open", {
  context: { version: 1, updatedAt: NOW, progress: { goal: "Debug provider limits", done: "Read the timer", next: "Fix the timer", updatedAt: NOW } },
  lens: { doing: "Editing src/limits.ts", stages: [{ label: "explore", state: "done" }, { label: "change", state: "active" }, { label: "verify", state: "pending" }] },
});

test("open cards render GOAL before DOING and lens-only WHERE without old notes", () => {
  const card = cardLines(render([open]), "open").join("\n");
  assert.match(card, /GOAL {3}Debug provider limits[\s\S]*DOING {2}Editing src\/limits.ts[\s\S]*WHERE {2}explore✓ change◉ verify·/);
  assert.doesNotMatch(card, /DONE|NEXT|PL✓|EX◉/);
  const roster = cardLines(render([session("selected"), open]), "open");
  assert.equal(roster.length, 1);
  assert.match(roster[0]!, /DOING {2}Editing src\/limits.ts/);
});

test("ticket copy hides GOAL and workflow cards retain their existing fields", () => {
  for (const copy of [{ subtitle: "Fix provider limits" }, { description: "Fix provider limits" }]) {
    const linked = { ...open, context: { ...open.context!, ticket: { id: "limit-001", ...copy } } };
    assert.doesNotMatch(cardLines(render([linked]), "open").join("\n"), /GOAL/);
  }
  const workflowGoal = { ...rich, context: { ...rich.context!, progress: open.context!.progress } };
  assert.deepEqual(cardLines(render([workflowGoal]), "rich"), cardLines(render([rich]), "rich"));
});

test("open Answer and Reply panels drop GOAL with suppressed progress fields", () => {
  for (const width of [60, 160]) for (const kind of ["answer", "reply"] as const) {
    const commands = buildDashboardCommands({ sessions: [open], selectedId: open.id, capabilities: { openSession: true, sendMessage: true } });
    const rendered = render([open], { width, height: 60, workspaceCommands: selectWorkspaceCommands(open, commands, 3), cardPanel: { kind, body: ["Panel input"], keyLine: "Enter Send   Esc Close", offset: 0 } });
    const card = cardLines(rendered, "open").join("\n");
    assert.match(card, /Panel input/, card);
    assert.doesNotMatch(card, /GOAL|DONE|NEXT|WHERE/, card);
    assert.match(card, /DOING {2}Editing src\/limits.ts/, card);
  }
});

test("quiet open roster uses GOAL as its final TASK fallback, with notes taking precedence", () => {
  const quiet = { ...open, status: "idle" as const, lens: undefined, context: { version: 1 as const, updatedAt: NOW, progress: { goal: "Debug provider limits", updatedAt: NOW } } };
  for (const width of [60, 100, 160]) {
    const rendered = render([session("selected", { status: "idle" }), quiet], { width });
    assert.match(cardLines(rendered, "open").join("\n"), /TASK {3}Debug provider limits/);
  }
  const withDone = { ...quiet, context: { ...quiet.context, progress: { ...quiet.context.progress, done: "Read limits" } } };
  assert.match(cardLines(render([session("selected"), withDone]), "open").join("\n"), /DONE {3}Read limits/);
});

test("open card labels and stages fit narrow terminals", () => {
  for (const width of [30, 40, 60, 99]) {
    const rendered = render([open], { width, height: 60 });
    assert.ok(rendered.layout.lines.every(line => visibleWidth(line) <= width), String(width));
    const text = cardLines(rendered, "open").join("\n");
    assert.match(text, /GOAL {3}/, text);
    assert.match(text, /DOING {2}/, text);
    assert.match(text, /WHERE {2}/, text);
  }
});

const paritySteps = [
  { id: "plan-md", short: "PL", labels: ["inspect", "scope", "write", "critic", "ready"], active: 3, doing: "critic pass 2", label: "PLAN", head: "3 phases · 10 tasks · 5 criteria", progress: { completed: 2, total: 5 }, pass: 2 },
  { id: "execute", short: "EX", labels: ["implement", "verify", "done"], active: 1, doing: "Checking npm test", label: "PLAN", head: "5 done · 5 open", progress: { completed: 5, total: 10 }, summary: "phase 2/3 · Hub card" },
  { id: "review", short: "RV", labels: ["review", "fix", "done"], active: 1, doing: "Fix the stale cursor", label: "FOUND", head: "2 fixed · 5 open · 1 deferred", progress: { completed: 3, total: 8 }, pass: 2 },
  { id: "reflect", short: "RF", labels: ["review", "update", "done"], active: 1, doing: "Document runtime facts", label: "CANDS", head: "1 applied · 1 now · 1 needs you · 1 no action", progress: { completed: 2, total: 4 }, pass: 2 },
  { id: "commit", short: "CM", labels: ["archive", "commit"], active: 1, doing: "Committing changes", label: "CLOSE", head: "2 commits" },
];

for (const [activeIndex, step] of paritySteps.entries()) {
  const lens = {
    doing: step.doing,
    stages: step.labels.map((label, index) => ({ label, state: index < step.active ? "done" as const : index === step.active ? "active" as const : "pending" as const })),
    ...(step.progress ? { progress: step.progress } : {}),
    ...(step.pass ? { pass: step.pass } : {}),
    ...(step.summary ? { summary: step.summary } : {}),
    list: { label: step.label, head: step.head, items: [{ state: "done" as const, text: "Completed fact" }, { state: "active" as const, text: "Current context" }, { state: "pending" as const, text: "Pending context" }, { state: "attention" as const, text: "Needs a decision" }, { state: "skipped" as const, text: "No action" }], before: 0, after: 0 },
  };
  const subject = session(`parity-${step.short}`, { workflow: { ...workflow, activeIndex, steps: paritySteps.map(({ id, short }) => ({ id, short })), lens } });
  for (const width of [160, 100, 80]) test(`${step.id} parity renders count heads and width-safe WHERE at ${width} columns`, () => {
    const rendered = render([subject], { width, height: 60 });
    assert.ok(rendered.layout.lines.every(line => visibleWidth(line) <= width), rendered.lines.join("\n"));
    const lines = cardLines(rendered, subject.id);
    const where = lines.find(line => line.includes("WHERE"))!;
    assert.ok(where, lines.join("\n"));
    assert.match(lines.join("\n"), new RegExp(`DOING +${step.doing}`));
    if (step.progress) assert.ok(where.includes(`${step.progress.completed}/${step.progress.total}`), where);
    else assert.doesNotMatch(where, /▰|▱|\d+\/\d+/);
    if (width !== 100) assert.ok(where.includes(step.labels[step.active]! + "◉"), where);
    if (width === 160) {
      assert.ok(lines.some(line => line.includes(step.head)), lines.join("\n"));
      for (const mark of ["✓", "◉", "·", "!", "–"]) assert.ok(lines.some(line => line.includes(mark)), mark + lines.join("\n"));
      if (step.progress) assert.match(where, /▰+▱+/);
    }
    if (["review", "reflect"].includes(step.id)) {
      const roster = cardLines(render([session("selected"), subject], { width }), subject.id);
      assert.match(roster.join("\n"), new RegExp(`${step.progress!.completed}/${step.progress!.total}`));
      if (width !== 100) assert.match(roster.join("\n"), /▰+▱+/);
    }
  });
  test(`${step.id} drops a long summary before its stages and exact count`, () => {
    const expanded = { ...subject, workflow: { ...subject.workflow!, lens: { ...lens, summary: "Long phase context ".repeat(6) } } };
    const where = cardLines(render([expanded], { width: 160 }), subject.id).find(line => line.includes("WHERE"))!;
    assert.doesNotMatch(where, /Long phase context/);
    assert.ok(where.includes(step.labels[step.active]! + "◉"), where);
    if (step.progress) assert.ok(where.includes(`${step.progress.completed}/${step.progress.total}`), where);
  });
}

test("wide selected cards show repo beside group, then task, DOING, WHERE and the lens list", () => {
  const rendered = render([rich]);
  const card = cardLines(rendered, "rich");
  assert.equal(card.length, 7, card.join("\n"));
  assert.match(cardTitle(rendered), /Dashboard UI polish ⎇ {2}cards/);
  assert.match(card[0]!, /hub-repo ⎇ feat\/taller-cards/);
  assert.match(card[1]!, /Taller fleet cards/);
  assert.match(card[2]!, /DOING {2}writing plan$/);
  assert.match(card[3]!, /WHERE {2}PL✓ EX◉ RV· │ 1✓ 2◉ 3· 4· {2}▰{3}▱{5} 3\/8 {2}pass 2$/);
  assert.match(card[4]!, /PLAN {3}Tests/);
  assert.match(card[5]!, /◉ Write the card tests/);
  assert.match(card[6]!, /NOW {4}Thinking…/);
  // The roster keeps only the title row and one status line; the readout lives in the card.
  // The task stays in the card; the title row names the group, the step and nothing else.
  assert.match(titleLine(rendered, "rich"), /Dashboard UI polish ⎇ {3}cards +EX$/);
  assert.ok(!rendered.roster.some((line) => line.includes("STEP")), rendered.roster.join("\n"));
});

test("stopped cards keep their lens but no live activity", () => {
  const card = cardLines(render([{ ...rich, status: "stopped" }]), "rich");
  assert.ok(card.some((line) => /DOING {2}writing plan/.test(line)), card.join("\n"));
  assert.ok(!card.some((line) => /NOW/.test(line)), card.join("\n"));
  assert.ok(card.some((line) => line.includes("hub-repo ⎇ feat/taller-cards")));
});

test("repo grouping shows only the branch and omits the line without one", () => {
  // With no repo name beside it, the branch follows the group on the card's title line.
  const groupedRender = render([rich], { fleetGrouping: "repo" });
  assert.match(cardTitle(groupedRender), /cards · feat\/taller-cards/);
  assert.ok(!cardLines(groupedRender, "rich").some((line) => line.includes("feat/taller-cards") || line.includes("hub-repo")));
  const branchless = cardLines(render([{ ...rich, worktreeBranch: undefined }], { fleetGrouping: "repo" }), "rich");
  assert.ok(!branchless.some((line) => line.includes("⎇") || line.includes("◈ hub-repo")), branchless.join("\n"));
});

test("status grouping without a branch shows the repo label alone", () => {
  const card = cardLines(render([{ ...rich, worktreeBranch: undefined }]), "rich");
  // The side pane reads off the base background, so its lines carry no stripe.
  assert.match(card[0]!, /^ +hub-repo$/, card.join("\n"));
  assert.ok(!card.some((line) => line.includes("⎇")));
});

test("explicit requests stay the first continuation after metadata", () => {
  const asking = {
    ...rich, status: "waiting" as const,
    context: { version: 1 as const, updatedAt: NOW, attention: { kind: "question" as const, text: "Choose the boundary", requestId: "r1" } },
  };
  const card = cardLines(render([asking]), "rich");
  assert.match(card[1]!, /ASK {4}Choose the boundary/);
  assert.ok(card.some((line) => line.includes("hub-repo ⎇ feat/taller-cards")));
});

test("below 100 columns the docked card keeps DOING, WHERE and the open list item", () => {
  const rendered = render([rich], { width: 99 });
  assert.equal(rendered.pane, undefined);
  assert.ok(dockStart(rendered) > 0, "the card docks below the roster");
  const card = cardLines(rendered, "rich").map((line) => line.trimEnd());
  assert.equal(card.length, 7, card.join("\n"));
  assert.match(card[0]!, /hub-repo ⎇ feat\/taller-cards/);
  assert.match(card[2]!, /DOING {2}writing plan$/);
  assert.match(card[3]!, /WHERE {2}PL✓ EX◉ RV· │ 1✓ 2◉ 3· 4· {2}▰{3}▱{5} 3\/8 {2}pass 2/);
  // The compact dock keeps no blank group rows.
  assert.match(card[4]!, /PLAN {3}Tests/);
  assert.match(card[5]!, /◉ Write the card tests/);
  assert.match(card[6]!, /NOW {4}Thinking…/);
});

function linesBetween(rendered: ReturnType<typeof render>, firstId: string, secondId: string): string[] {
  const targets = rendered.layout.rowTargets;
  const second = targets.findIndex((target) => target?.kind === "session" && target.id === secondId);
  let last = second - 1;
  while (last >= 0 && !targetId(targets[last])) last -= 1;
  assert.equal(targetId(targets[last]), firstId);
  return rendered.roster.slice(last + 1, second);
}

test("moving the selection never moves list rows: the selected card sits in the side pane", () => {
  const sessions = [session("first"), rich, session("next")];
  const rows = (selectedId: string) => {
    const layout = render(sessions, { selectedId });
    return sessions.map((item) => layout.layout.rowTargets.findIndex((target) => target?.kind === "session" && target.id === item.id));
  };
  assert.deepEqual(rows("rich"), rows("first"));
  assert.deepEqual(rows("next"), rows("first"));
  const docked = render(sessions, { selectedId: "rich" });
  assert.ok(docked.pane, "160 columns put the card beside the roster");
  assert.equal(dockStart(docked), -1, "no dock rule beside a side pane");
  assert.match(cardTitle(docked), /Dashboard UI polish/);
  assert.ok(cardLines(docked, "rich").some((line) => line.includes("Taller fleet cards")));
});

test("beside the card and in pins one blank row separates modules while rows allow; children, archive, board and dock stay packed", () => {
  const parent = session("parent");
  const child = session("child", { kind: "subagent", parentId: "parent", agentName: "scout", taskPreview: "look around" });
  const blank = (lines: string[]) => lines.map((line) => line.trim());
  assert.deepEqual(blank(linesBetween(render([session("selected"), rich, session("next")]), "rich", "next")), [""]);
  assert.deepEqual(blank(linesBetween(render([session("selected"), rich, session("next")], { pinSlots: ["selected"], width: 50 }), "rich", "next")), [""]);
  // A subagent stays under its parent; the gap comes before the next parent.
  const tree = render([parent, child, session("next")], { expandedProjectParentIds: new Set(["parent"]) });
  assert.equal(linesBetween(tree, "parent", "child").length, 0);
  assert.deepEqual(blank(linesBetween(tree, "child", "next")), [""]);
  const archived = (id: string) => session(id, { bucket: "archived", bucketChangedAt: NOW });
  assert.equal(linesBetween(render([session("selected"), archived("old"), archived("older")]), "old", "older").length, 0);
  for (const input of [{ width: 99 }, { compactRows: true }, { grouping: "stage" as const }]) {
    const next = session("next", { workflow: rich.workflow });
    assert.equal(linesBetween(render([rich, next], input), "rich", "next").length, 0, JSON.stringify(input));
  }
  // The gaps go first when rows run short: a window that fits every packed row drops them before any status line.
  const fleet = [session("a"), rich, session("b"), session("c")];
  const packed = render(fleet, { height: 60 }).roster.filter((line) => line.trim()).length;
  const tight = render(fleet, { height: packed + 2 });
  assert.equal(linesBetween(tight, "rich", "b").length, 0, tight.roster.join("\n"));
  assert.ok(tight.roster.some((line) => line.includes("DOING")), tight.roster.join("\n"));
});

test("neighbor modules keep the group beside the title and their status under it", () => {
  const seen = new Set<number>();
  for (let height = 8; height <= 30; height += 1) {
    const rendered = render([session("selected"), { ...rich, group: "cards" }], { height });
    const title = titleLine(rendered, "rich");
    if (!title) continue;
    // The task stays in the selected session's card; a title row never names it.
    assert.match(title, /Dashboard UI polish ⎇ {3}cards +EX$/, `height ${height}`);
    assert.doesNotMatch(title, /Taller fleet cards/, `height ${height}`);
    const card = cardLines(rendered, "rich");
    assert.ok(card.length <= 2, `height ${height}:\n${card.join("\n")}`);
    if (card.length) assert.match(card[0]!, /DOING {2}writing plan +▰{3}▱{5} 3\/8$/);
    seen.add(card.length);
  }
  // Two rows always fit beside the card, so the status line stays at every height.
  assert.deepEqual([...seen], [1])
});

test("crowded panes keep the selected card whole with neighbors on both sides", () => {
  const sessions = Array.from({ length: 7 }, (_, index) => index === 3 ? { ...rich, id: "s3" } : session(`s${index}`));
  const rendered = render(sessions, { selectedId: "s3", height: 20 });
  // The side pane shows the card beside the roster; the roster keeps neighbors around the selection.
  assert.ok(cardLines(rendered, "s3").length >= 1);
  assert.match(cardTitle(rendered), /Dashboard UI polish/);
  const titles = rendered.layout.rowTargets.flatMap((target) => target?.kind === "session" ? [target.id] : []);
  const selected = titles.indexOf("s3");
  assert.ok(selected > 0 && selected < titles.length - 1, titles.join(","));
});

test("taller cards fit every wide terminal width", () => {
  const child = session("child", { kind: "subagent", parentId: "rich", agentName: "code-critic", taskPreview: "review" });
  for (const width of [100, 120, 160, 220]) {
    const rendered = render([rich, child, session("next", { worktreeBranch: "x".repeat(300) })], { width, expandedProjectParentIds: new Set(["rich"]) });
    assert.ok(rendered.layout.lines.every((line) => visibleWidth(line) <= width), `width ${width}`);
  }
});

test("a completed current step shows no activity line beside its checkmark", () => {
  const complete = { ...rich, workflow: { ...rich.workflow!, activeIndex: 2, currentStepComplete: true, activity: { id: "commit-complete", label: "Commit complete" } } };
  const card = cardLines(render([complete]), "rich");
  assert.ok(!card.some((line) => line.includes("Commit complete")), card.join("\n"));
});

function producerWorktree(state: "active" | "cleaned"): RuntimeSession["worktreeLifecycle"] {
  return {
    version: 1, recordId: "costs-002", producer: "rules", revision: 1, updatedAt: NOW,
    repositories: [{ sourcePath: "/tmp/hub-repo", worktreePath: "/tmp/wt/hub-repo", branch: "costs-002", role: "primary", state }],
  };
}

test("producer-owned worktrees show their branch until cleaned", () => {
  const active = cardLines(render([session("wt", { worktreeLifecycle: producerWorktree("active") })]), "wt");
  assert.ok(active.some((line) => line.includes("hub-repo ⎇ costs-002")), active.join("\n"));
  const cleaned = cardLines(render([session("wt", { worktreeLifecycle: producerWorktree("cleaned") })]), "wt");
  assert.ok(!cleaned.some((line) => line.includes("costs-002")), cleaned.join("\n"));
});

test("muted group and repo names avoid repeating the same identity", () => {
  const same = cardLines(render([session("same", { group: "Hub Repo" })]), "same");
  assert.ok(!same.some((line) => /hub-repo/i.test(line)), same.join("\n"));
  const branchedRender = render([session("same", { group: "hub-repo", worktreeBranch: "feat/x" })]);
  assert.match(cardTitle(branchedRender), /hub-repo · feat\/x/);
  assert.ok(!cardLines(branchedRender, "same").some((line) => /hub-repo|feat\/x/.test(line)));
  const raw = renderSessions(buildRenderModel({ sessions: [session("same")], selectedId: "same", width: 160, height: 60, now: NOW, guidanceHidden: true }), darkTheme).lines;
  const groupLine = raw.find((line) => / {2}cards/.test(stripAnsi(line)))!;
  assert.ok(groupLine.includes(styleToken(darkTheme, "muted", "cards")), "muted group");
  assert.ok(!groupLine.includes(`\u001b[1m${styleToken(darkTheme, "muted", "cards")}`));
  // The side pane's metadata line sits right of the roster's `│`.
  const differing = raw.find((line) => /│ +hub-repo$/.test(stripAnsi(line).trimEnd()))!.split(styleToken(darkTheme, "dim", "│"))[1]!;
  assert.ok(differing.includes(styleToken(darkTheme, "muted", "hub-repo")), differing);
  assert.doesNotMatch(differing, /\u001b\[1m|◈/);
});

test("narrow and pinned views carry a differing repo name on the metadata line", () => {
  const differing = session("diff", { group: "mobile" });
  const same = session("same", { group: "hub-repo" });
  for (const input of [{ width: 60 }, { width: 99 }, { width: 120, pinSlots: ["diff", undefined], activePinnedSessionId: "diff" }] as Partial<BuildRenderModelInput>[]) {
    const rendered = render([differing, same], { height: 40, ...input });
    const diffCard = cardLines(rendered, "diff");
    // Pin rows name the group beside the title; the pin strip names the repo of the selected session.
    if (input.pinSlots) assert.match(titleLine(rendered, "diff"), /Session diff +mobile/, JSON.stringify(input));
    else {
      // The metadata line, then, with nothing else to show, the fleet card's one-line quiet note.
      assert.deepEqual(diffCard.slice(1).map(line => line.replace(/^▌\s*/u, "").trim()), ["NOW    Thinking…"], JSON.stringify(input) + "\n" + diffCard.join("\n"));
      const title = rendered.roster[rendered.layout.rowTargets.findIndex(target => target?.kind === "session" && target.id === "diff")]!;
      assert.match(title, /mobile/);
      assert.doesNotMatch(title, /\[mobile\]/);
      assert.match(diffCard[0]!, /hub-repo/);
    }
    // A repo matching its group is never repeated (pin rows name the group in brackets).
    assert.ok(!cardLines(rendered, "same").some((line) => line.replace("[hub-repo]", "").includes("hub-repo")), JSON.stringify(input));
  }
  const wide = cardLines(render([differing]), "diff");
  assert.match(wide[0]!, /hub-repo/, "wide cards keep repo on the metadata line\n" + wide.join("\n"));
  const tight = render([differing], { width: 30, height: 40 });
  assert.match(titleLine(tight, "diff") + cardLines(tight, "diff").join("\n"), /mobile/);
});

const longRequest = "Review complete with three findings fixed in the renderer, two tests added for the phone layout, and one open question about keycap spacing";

test("unselected requests read whole beside the card while rows allow, and in one line below 100 columns", () => {
  const asking = session("asking", { status: "waiting", context: { version: 1, updatedAt: NOW,
    attention: { kind: "ready", requestId: "r", text: longRequest, recommendation: "Run reflect next" } } });
  for (const width of [100, 160]) {
    const card = cardLines(render([session("selected"), asking], { width, height: 40 }), "asking");
    const text = card.join(" ").replace(/\s+/g, " ");
    assert.match(card[0]!, /RDY {4}Review complete/);
    assert.ok(text.includes("keycap spacing") && text.includes("→ Run reflect next"), `${width}:\n${card.join("\n")}`);
    // Continuation lines hang under the request text, not under the label.
    assert.equal(card[1]!.search(/\S/), card[0]!.indexOf("Review"), `${width}:\n${card.join("\n")}`);
  }
  // Below 100 columns the docked list keeps one status line; the card below it has the rest.
  const narrow = cardLines(render([session("selected"), asking], { width: 60, height: 40 }), "asking");
  assert.equal(narrow.length, 1, narrow.join("\n"));
  assert.match(narrow[0]!, /RDY {4}Review complete.*…$/);
  // Selected, the card carries the whole request and its recommendation.
  const selected = cardLines(render([asking, session("other")], { width: 160, height: 40 }), "asking");
  const text = selected.join(" ").replace(/\s+/g, " ");
  assert.ok(text.includes("keycap spacing"), text);
  assert.ok(selected.some((line) => /→ Run reflect next/.test(line)), selected.join("\n"))
});

test("unselected active modules say what they are doing, with the step on the title row", () => {
  for (const width of [60, 100, 160]) {
    const rendered = render([session("selected"), { ...rich, id: "busy" }], { width, height: 40 });
    const card = cardLines(rendered, "busy");
    assert.equal(card.length, 1, `${width}:\n${card.join("\n")}`);
    assert.match(card[0]!, /DOING {2}writing plan/);
    assert.match(card[0]!, /3\/8$/);
    assert.match(titleLine(rendered, "busy"), / EX$/);
  }
  const idle = render([session("selected"), session("plain", { workflow })]);
  assert.deepEqual(cardLines(idle, "plain"), [], "a step without a lens has no status line");
  assert.match(titleLine(idle, "plain"), /Session plain +cards +EX$/);
});

test("unselected health modules show their error reason", () => {
  const broken = session("broken", { status: "error", error: "MCP pool failed to start" });
  const rendered = renderSessions(buildRenderModel({ sessions: [session("selected"), broken], selectedId: "selected", width: 120, height: 40, now: NOW, guidanceHidden: true }), darkTheme);
  const index = rendered.rowTargets.findIndex((target) => target?.kind === "session" && target.id === "broken");
  const detail = rendered.lines[index + 1]!;
  assert.match(stripAnsi(detail), /ERR {4}MCP pool failed to start/);
  assert.ok(detail.includes(styleToken(darkTheme, "error", "ERR")));
});

test("quiet modules show where a paused agent stopped", () => {
  const quiet = session("quiet", { status: "idle", workflow: rich.workflow });
  const rendered = render([session("selected", { status: "idle" }), quiet], { width: 160 });
  const card = cardLines(rendered, "quiet");
  // A paused agent keeps its lens DOING and progress meter; the step stays on the title row.
  assert.deepEqual(card.length, 1, card.join("\n"));
  assert.match(card[0]!, /DOING {2}writing plan +▰{3}▱{5} 3\/8$/);
  assert.match(titleLine(rendered, "quiet"), / EX +now$/);
  // Selected, the card carries the full WHERE line.
  const selected = cardLines(render([quiet, session("other", { status: "idle" })], { width: 160 }), "quiet");
  assert.ok(selected.some((line) => /WHERE {2}PL✓ EX◉ RV· │ 1✓ 2◉ 3· 4· {2}▰{3}▱{5} 3\/8/.test(line)), selected.join("\n"));
});

test("an idle parent with running subagents names what they are doing", () => {
  const parent = session("parent", { status: "idle", title: "Tile review" });
  const child = (id: string, agentName: string, taskPreview: string, status: RuntimeSession["status"] = "running") =>
    session(id, { kind: "subagent", parentId: "parent", agentName, taskPreview, status });
  const rendered = render([session("selected"), parent, child("c1", "code-critic", "Review the pixel map diff"), child("c2", "scout", "Find tile loaders"), child("c3", "worker", "Done earlier", "stopped")]);
  assert.match(titleLine(rendered, "parent"), /Tile review ↳2/);
  assert.deepEqual(cardLines(rendered, "parent").map((line) => line.trim()), ["SUB    code-critic Review the pixel map diff"]);
  // The card names the count of other running subagents too.
  const selected = cardLines(render([parent, child("c1", "code-critic", "Review the pixel map diff"), child("c2", "scout", "Find tile loaders")]), "parent");
  assert.ok(selected.some((line) => line.trim() === "SUB    code-critic · Review the pixel map diff · +1 more"), selected.join("\n"));
  // An expanded tree shows the subagent rows themselves instead.
  const expanded = render([session("selected"), parent, child("c1", "code-critic", "Review the pixel map diff")], { expandedProjectParentIds: new Set(["parent"]) });
  assert.ok(!cardLines(expanded, "parent").some((line) => line.trim().startsWith("SUB")), cardLines(expanded, "parent").join("\n"));
  // A parent with its own lens shows DOING on its one status line; its card still names its subagents.
  const busy = cardLines(render([session("selected"), { ...rich, id: "parent" }, child("c1", "code-critic", "Review the pixel map diff")]), "parent");
  assert.equal(busy.length, 1, busy.join("\n"));
  assert.match(busy[0]!, /DOING {2}writing plan/);
  const busyCard = cardLines(render([{ ...rich, id: "parent" }, child("c1", "code-critic", "Review the pixel map diff")]), "parent");
  assert.match(busyCard.find((line) => line.includes("DOING")) ?? "", /DOING {2}writing plan/);
  assert.match(busyCard.at(-1)!, /SUB {4}code-critic/);
});

test("unselected modules keep dim for decoration off the plate", () => {
  const theme = { ...darkTheme, dim: "#010203", muted: "#040506" };
  const sessions = [session("selected"), { ...rich, id: "busy" }];
  const layout = renderSessions(buildRenderModel({ sessions, selectedId: "selected", width: 160, height: 40, now: NOW, guidanceHidden: true }), theme);
  // Only the roster's part of each row: the side pane right of `│` belongs to the selected card.
  const rows = layout.lines.filter((_line, index) => targetId(layout.rowTargets[index]) === "busy")
    .map((row) => row.split(styleToken(theme, "dim", "│"))[0]!);
  // Group names and empty meter cells read in muted; unselected modules sit on no surface.
  assert.ok(rows.some((row) => row.includes(styleToken(theme, "muted", "cards"))), rows.join("\n"));
  assert.ok(rows.some((row) => row.includes(styleToken(theme, "muted", "▱▱▱▱▱"))), rows.join("\n"));
  assert.ok(rows.every((row) => !row.includes("\u001b[48;")));
});
