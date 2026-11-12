import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildRenderModel, type BuildRenderModelInput } from "../src/tui/render-model.js";
import { renderSessions, type SessionListTarget } from "../src/tui/layout.js";
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
  assert.match(titleLine(rendered, "rich"), /Dashboard UI polish ⎇ {3}cards · Taller fleet cards +EX$/);
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

test("wide cards in one group are separated by one plain spacer", () => {
  const rendered = render([session("selected"), rich, session("next")]);
  const between = linesBetween(rendered, "rich", "next");
  assert.equal(between.length, 1, between.join("\n"));
  const spacer = between[0]!;
  assert.equal(spacer.trim(), "", "the spacer carries no gutter or frame");
  const spacerIndex = rendered.roster.indexOf(spacer, rendered.layout.rowTargets.findIndex((target) => target?.kind === "session" && target.id === "rich"));
  assert.equal(rendered.layout.rowTargets[spacerIndex], undefined);
});

test("spacers follow expanded child trees and stay off narrow, compact and board layouts", () => {
  const parent = session("parent");
  const child = session("child", { kind: "subagent", parentId: "parent", agentName: "scout", taskPreview: "look around" });
  const expanded = render([parent, child, session("next")], { expandedProjectParentIds: new Set(["parent"]) });
  assert.equal(linesBetween(expanded, "child", "next").length, 1);
  for (const input of [{ width: 99 }, { compactRows: true }, { grouping: "stage" as const }]) {
    const next = session("next", { workflow: rich.workflow });
    assert.equal(linesBetween(render([rich, next], input), "rich", "next").length, 0, JSON.stringify(input));
  }
});

test("fleets taller than the pane render without spacers", () => {
  const sessions = Array.from({ length: 12 }, (_, index) => session(`s${index}`));
  const rendered = render(sessions, { height: 20 });
  const targets = rendered.layout.rowTargets;
  const first = targets.findIndex((target) => target?.kind === "session");
  // Only the roster counts; the side pane beside it keeps blank rows above its keys.
  assert.ok(rendered.pane);
  let last = rendered.layout.footerRow! - 1;
  while (last >= 0 && !targetId(targets[last])) last -= 1;
  assert.ok(last > first, "the roster fills the pane height");
  const blank = rendered.roster.slice(first, last + 1).filter((line) => line.trim() === "");
  assert.deepEqual(blank, []);
});

test("neighbor modules keep group and task beside the title and one status line under it", () => {
  const seen = new Set<number>();
  for (let height = 8; height <= 30; height += 1) {
    const rendered = render([session("selected"), { ...rich, group: "cards" }], { height });
    const title = titleLine(rendered, "rich");
    if (!title) continue;
    assert.match(title, /Dashboard UI polish ⎇ {3}cards · Taller fleet cards/, `height ${height}`);
    const card = cardLines(rendered, "rich");
    // The step moves to the title row; the readout stays in the card.
    assert.match(title, / EX$/, `height ${height}`);
    assert.ok(card.length <= 1, `height ${height}:\n${card.join("\n")}`);
    if (card.length) assert.match(card[0]!, /DOING {2}writing plan +▰{3}▱{5} 3\/8$/);
    seen.add(card.length);
  }
  assert.ok(seen.has(1), [...seen].join(","));
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
    // The metadata line, then, with nothing else to show, the fleet card's one-line quiet note.
    assert.deepEqual(diffCard.slice(1).map(line => line.replace(/^▌\s*/u, "").trim()), input.pinSlots ? [] : ["NOW    Thinking…"], JSON.stringify(input) + "\n" + diffCard.join("\n"));
    if (input.pinSlots) assert.match(diffCard[0]!, /\[mobile\] hub-repo/, JSON.stringify(input) + "\n" + diffCard[0]);
    else {
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

test("unselected request modules keep the request within two lines and leave the recommendation to the card", () => {
  const asking = session("asking", { status: "waiting", context: { version: 1, updatedAt: NOW,
    attention: { kind: "ready", requestId: "r", text: longRequest, recommendation: "Run reflect next" } } });
  for (const width of [60, 100, 160]) {
    const rendered = render([session("selected"), asking], { width, height: 40 });
    const card = cardLines(rendered, "asking");
    assert.equal(card.length, 2, `${width}:\n${card.join("\n")}`);
    assert.match(card[0]!, /RDY {4}Review complete/);
    assert.ok(!card.some((line) => line.includes("Run reflect next")), `${width}:\n${card.join("\n")}`);
    // Continuation lines hang under the request text, not under the label.
    assert.equal(card[1]!.search(/\S/), card[0]!.indexOf("Review"), `${width}:\n${card.join("\n")}`);
  }
  // Selected, the card carries the whole request and its recommendation.
  const selected = cardLines(render([asking, session("other")], { width: 160, height: 40 }), "asking");
  const text = selected.join(" ").replace(/\s+/g, " ");
  assert.ok(text.includes("keycap spacing"), text);
  assert.ok(selected.some((line) => /→ Run reflect next/.test(line)), selected.join("\n"));
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
  assert.ok(rows.some((row) => row.includes(styleToken(theme, "muted", "cards · Taller fleet cards"))), rows.join("\n"));
  assert.ok(rows.some((row) => row.includes(styleToken(theme, "muted", "▱▱▱▱▱"))), rows.join("\n"));
  assert.ok(rows.every((row) => !row.includes("\u001b[48;")));
});
