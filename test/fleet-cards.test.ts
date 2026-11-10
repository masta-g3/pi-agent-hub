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
  },
});

function render(sessions: RuntimeSession[], input: Partial<BuildRenderModelInput> = {}) {
  const layout = renderSessions(buildRenderModel({
    sessions, selectedId: sessions[0]!.id, width: 160, height: 60, now: NOW, guidanceHidden: true, ...input,
  }));
  return { layout, lines: layout.lines.map(stripAnsi) };
}

function targetId(target: SessionListTarget | undefined): string | undefined {
  return target && "id" in target ? target.id : undefined;
}

function titleLine(rendered: ReturnType<typeof render>, id: string): string {
  return rendered.lines[rendered.layout.rowTargets.findIndex((target) => target?.kind === "session" && target.id === id)] ?? "";
}

/** The first row of the docked card below the dock rule, or -1 when nothing is docked. */
function dockStart(rendered: ReturnType<typeof render>): number {
  const rule = rendered.lines.findIndex((line, index) => index > 0 && /^─{20,}$/u.test(line.trim()));
  return rule < 0 ? -1 : rule + 1;
}

/**
 * The detail lines for one session: the docked card below its identity row when it is selected,
 * otherwise the module's continuation lines under its title.
 */
function cardLines(rendered: ReturnType<typeof render>, id: string): string[] {
  const targets = rendered.layout.rowTargets;
  const dock = dockStart(rendered);
  const docked = dock >= 0 && targetId(targets[dock]) === id;
  const title = docked ? dock : targets.findIndex((target) => target?.kind === "session" && target.id === id);
  if (title < 0) return [];
  const lines: string[] = [];
  for (let index = title + 1; targets[index]?.kind === "session-continuation" && targetId(targets[index]) === id; index += 1) {
    const line = rendered.lines[index]!;
    if (!line.includes("Enter Open in Pi") && line.replace(/[▌\s]/gu, "")) lines.push(line);
  }
  return lines;
}

/** The docked card's identity row. */
function dockTitle(rendered: ReturnType<typeof render>): string {
  const dock = dockStart(rendered);
  return dock < 0 ? "" : rendered.lines[dock] ?? "";
}

test("wide selected modules show repo beside group, then task, NOW and the LCD readout", () => {
  const rendered = render([rich]);
  const card = cardLines(rendered, "rich");
  assert.equal(card.length, 5, card.join("\n"));
  assert.match(dockTitle(rendered), /Dashboard UI polish ⎇ {2}cards/);
  assert.match(card[0]!, /hub-repo ⎇ feat\/taller-cards/);
  assert.match(card[1]!, /Taller fleet cards/);
  assert.match(card[2]!, /NOW {3}writing plan \(pass 2\)/);
  assert.match(card[3]!, /STEP +TASK +PHASE/);
  assert.match(card[4]!, /PL✓ EX◉ RV· +▰{3}▱{5} 3\/8 +2\/4/);
});

test("stopped cards omit stale activity", () => {
  const card = cardLines(render([{ ...rich, status: "stopped" }]), "rich");
  assert.ok(!card.some((line) => line.includes("writing plan") || line.includes("Phase 2/4")), card.join("\n"));
  assert.ok(card.some((line) => line.includes("hub-repo ⎇ feat/taller-cards")));
});

test("repo grouping shows only the branch and omits the line without one", () => {
  // With no repo name beside it, the branch follows the group on the card's title line.
  const groupedRender = render([rich], { fleetGrouping: "repo" });
  assert.match(dockTitle(groupedRender), /cards · feat\/taller-cards/);
  assert.ok(!cardLines(groupedRender, "rich").some((line) => line.includes("feat/taller-cards") || line.includes("hub-repo")));
  const branchless = cardLines(render([{ ...rich, worktreeBranch: undefined }], { fleetGrouping: "repo" }), "rich");
  assert.ok(!branchless.some((line) => line.includes("⎇") || line.includes("◈ hub-repo")), branchless.join("\n"));
});

test("status grouping without a branch shows the repo label alone", () => {
  const card = cardLines(render([{ ...rich, worktreeBranch: undefined }]), "rich");
  assert.match(card[0]!, /^▌ +hub-repo\s/, card.join("\n"));
  assert.ok(!card.some((line) => line.includes("⎇")));
});

test("explicit requests stay the first continuation after metadata", () => {
  const asking = {
    ...rich, status: "waiting" as const,
    context: { version: 1 as const, updatedAt: NOW, attention: { kind: "question" as const, text: "Choose the boundary", requestId: "r1" } },
  };
  const card = cardLines(render([asking]), "rich");
  assert.match(card[1]!, /ASK {3}Choose the boundary/);
  assert.ok(card.some((line) => line.includes("hub-repo ⎇ feat/taller-cards")));
});

test("below 100 columns the selected module folds its LCD into one readout line", () => {
  const card = cardLines(render([rich], { width: 99 }), "rich");
  assert.equal(card.length, 4, card.join("\n"));
  assert.match(card[0]!, /hub-repo ⎇ feat\/taller-cards/);
  assert.match(card[3]!, /STEP {2}PL✓ EX◉ RV· {3}TASK ▰{3}▱{5} 3\/8 {3}PHASE 2\/4/);
});

function linesBetween(rendered: ReturnType<typeof render>, firstId: string, secondId: string): string[] {
  const targets = rendered.layout.rowTargets;
  const second = targets.findIndex((target) => target?.kind === "session" && target.id === secondId);
  let last = second - 1;
  while (last >= 0 && !targetId(targets[last])) last -= 1;
  assert.equal(targetId(targets[last]), firstId);
  return rendered.lines.slice(last + 1, second);
}

test("moving the selection never moves list rows: the selected card docks below the list", () => {
  const sessions = [session("first"), rich, session("next")];
  const rows = (selectedId: string) => {
    const layout = render(sessions, { selectedId });
    return sessions.map((item) => layout.layout.rowTargets.findIndex((target) => target?.kind === "session" && target.id === item.id));
  };
  assert.deepEqual(rows("rich"), rows("first"));
  assert.deepEqual(rows("next"), rows("first"));
  const docked = render(sessions, { selectedId: "rich" });
  assert.match(dockTitle(docked), /Dashboard UI polish/);
  assert.ok(cardLines(docked, "rich").some((line) => line.includes("Taller fleet cards")));
});

test("wide cards in one group are separated by one plain spacer", () => {
  const rendered = render([session("selected"), rich, session("next")]);
  const between = linesBetween(rendered, "rich", "next");
  assert.equal(between.length, 1, between.join("\n"));
  const spacer = between[0]!;
  assert.equal(spacer.trim(), "", "the spacer carries no gutter or frame");
  const spacerIndex = rendered.lines.indexOf(spacer);
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
  const sessions = Array.from({ length: 8 }, (_, index) => session(`s${index}`));
  const rendered = render(sessions, { height: 20 });
  const targets = rendered.layout.rowTargets;
  const first = targets.findIndex((target) => target?.kind === "session");
  // Only the list counts; the dock below its rule keeps blank rows reserved for longer cards.
  let last = dockStart(rendered) - 2;
  while (last >= 0 && !targetId(targets[last])) last -= 1;
  const blank = rendered.lines.slice(first, last + 1).filter((line) => line.trim() === "");
  assert.deepEqual(blank, []);
});

test("neighbor modules keep group and task beside the title and drop only their field lines", () => {
  const seen = new Set<number>();
  for (let height = 8; height <= 30; height += 1) {
    const rendered = render([session("selected"), { ...rich, group: "cards" }], { height });
    const title = titleLine(rendered, "rich");
    if (!title) continue;
    assert.match(title, /Dashboard UI polish ⎇ {3}cards · Taller fleet cards/, `height ${height}`);
    const card = cardLines(rendered, "rich");
    assert.ok(card.length <= 2, `height ${height}:\n${card.join("\n")}`);
    if (card.length) assert.match(card[0]!, /NOW {3}writing plan \(pass 2\)/);
    if (card.length > 1) assert.match(card[1]!, /STEP {2}PL✓ EX◉ RV· {3}TASK ▰{3}▱{5} 3\/8 {3}PHASE 2\/4/);
    seen.add(card.length);
  }
  assert.ok(seen.has(0) && seen.has(2), [...seen].join(","));
});

test("crowded panes keep the selected card whole with neighbors on both sides", () => {
  const sessions = Array.from({ length: 7 }, (_, index) => index === 3 ? { ...rich, id: "s3" } : session(`s${index}`));
  const rendered = render(sessions, { selectedId: "s3", height: 20 });
  // The fixed dock windows the card: identity, metadata and the keys stay.
  assert.ok(cardLines(rendered, "s3").length >= 1);
  assert.match(dockTitle(rendered), /Dashboard UI polish/);
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
  assert.match(dockTitle(branchedRender), /hub-repo · feat\/x/);
  assert.ok(!cardLines(branchedRender, "same").some((line) => /hub-repo|feat\/x/.test(line)));
  const raw = renderSessions(buildRenderModel({ sessions: [session("same")], selectedId: "same", width: 160, height: 60, now: NOW, guidanceHidden: true }), darkTheme).lines;
  const groupLine = raw.find((line) => / {2}cards/.test(stripAnsi(line)))!;
  assert.ok(groupLine.includes(styleToken(darkTheme, "muted", "cards")), "muted group");
  assert.ok(!groupLine.includes(`\u001b[1m${styleToken(darkTheme, "muted", "cards")}`));
  const differing = raw.find((line) => /^▌ +hub-repo/.test(stripAnsi(line)))!;
  assert.ok(differing.includes(styleToken(darkTheme, "muted", "hub-repo")), differing);
  assert.doesNotMatch(differing, /\u001b\[1m|◈/);
});

test("narrow and pinned views carry a differing repo name on the metadata line", () => {
  const differing = session("diff", { group: "mobile" });
  const same = session("same", { group: "hub-repo" });
  for (const input of [{ width: 60 }, { width: 99 }, { width: 120, pinSlots: ["diff", undefined], activePinnedSessionId: "diff" }] as Partial<BuildRenderModelInput>[]) {
    const rendered = render([differing, same], { height: 40, ...input });
    const diffCard = cardLines(rendered, "diff");
    assert.equal(diffCard.length, 1, JSON.stringify(input) + "\n" + diffCard.join("\n"));
    if (input.pinSlots) assert.match(diffCard[0]!, /\[mobile\] hub-repo/, JSON.stringify(input) + "\n" + diffCard[0]);
    else {
      const title = rendered.lines[rendered.layout.rowTargets.findIndex(target => target?.kind === "session" && target.id === "diff")]!;
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

test("unselected request modules keep the request within three lines before the recommendation", () => {
  const asking = session("asking", { status: "waiting", context: { version: 1, updatedAt: NOW,
    attention: { kind: "ready", requestId: "r", text: longRequest, recommendation: "Run reflect next" } } });
  for (const width of [60, 100, 160]) {
    const rendered = render([session("selected"), asking], { width });
    const card = cardLines(rendered, "asking");
    assert.ok(card.length >= 2 && card.length <= 3, `${width}:\n${card.join("\n")}`);
    assert.match(card[0]!, /RDY {3}Review complete/);
    const text = card.join(" ").replace(/\s+/g, " ");
    if (width >= 160) {
      assert.ok(text.includes("keycap spacing"), text);
      assert.match(card.at(-1)!, /→ Run reflect next/);
    }
    // Continuation lines hang under the request text, not under the label.
    if (card.length > 1) assert.equal(card[1]!.search(/\S/), card[0]!.indexOf("Review"), `${width}:\n${card.join("\n")}`);
  }
});

test("unselected active modules say what they are doing and where they are", () => {
  for (const width of [60, 100, 160]) {
    const rendered = render([session("selected"), { ...rich, id: "busy" }], { width });
    const card = cardLines(rendered, "busy");
    assert.equal(card.length, 2, `${width}:\n${card.join("\n")}`);
    assert.match(card[0]!, /NOW {3}writing plan \(pass 2\)/);
    // Below 80 STEP names the step in words instead of the marker row.
    assert.match(card[1]!, width >= 80 ? /STEP {2}PL✓ EX◉ RV·/ : /STEP {2}Execute/);
  }
  const idle = render([session("selected"), session("plain", { workflow })]);
  assert.match(cardLines(idle, "plain")[0] ?? "", /^\s+STEP {2}PL✓ EX◉ RV·\s*$/, "a step without activity still shows STEP");
});

test("unselected health modules show their error reason", () => {
  const broken = session("broken", { status: "error", error: "MCP pool failed to start" });
  const rendered = renderSessions(buildRenderModel({ sessions: [session("selected"), broken], selectedId: "selected", width: 120, height: 40, now: NOW, guidanceHidden: true }), darkTheme);
  const index = rendered.rowTargets.findIndex((target) => target?.kind === "session" && target.id === "broken");
  const detail = rendered.lines[index + 1]!;
  assert.match(stripAnsi(detail), /ERR {3}MCP pool failed to start/);
  assert.ok(detail.includes(styleToken(darkTheme, "error", "ERR")));
});

test("quiet modules show where a paused agent stopped", () => {
  const quiet = session("quiet", { status: "idle", workflow: rich.workflow });
  const rendered = render([session("selected", { status: "idle" }), quiet], { width: 160 });
  const card = cardLines(rendered, "quiet");
  // A paused agent keeps its last producer activity, then step, tasks and phase.
  assert.match(card[0]!, /NOW {3}writing plan \(pass 2\)/);
  assert.match(card.at(-1)!, /STEP {2}PL✓ EX◉ RV· {3}TASK ▰{3}▱{5} 3\/8 {3}PHASE 2\/4/);
});

test("an idle parent with running subagents names what they are doing", () => {
  const parent = session("parent", { status: "idle", title: "Tile review" });
  const child = (id: string, agentName: string, taskPreview: string, status: RuntimeSession["status"] = "running") =>
    session(id, { kind: "subagent", parentId: "parent", agentName, taskPreview, status });
  const rendered = render([session("selected"), parent, child("c1", "code-critic", "Review the pixel map diff"), child("c2", "scout", "Find tile loaders"), child("c3", "worker", "Done earlier", "stopped")]);
  assert.match(titleLine(rendered, "parent"), /Tile review ↳2/);
  assert.deepEqual(cardLines(rendered, "parent").map((line) => line.trim()), ["SUB   code-critic · Review the pixel map diff · +1 more"]);
  // An expanded tree shows the subagent rows themselves instead.
  const expanded = render([session("selected"), parent, child("c1", "code-critic", "Review the pixel map diff")], { expandedProjectParentIds: new Set(["parent"]) });
  assert.ok(!cardLines(expanded, "parent").some((line) => line.trim().startsWith("SUB")), cardLines(expanded, "parent").join("\n"));
  // A parent with its own activity shows it first and still names its subagents.
  const busy = cardLines(render([session("selected"), { ...rich, id: "parent" }, child("c1", "code-critic", "Review the pixel map diff")]), "parent");
  assert.match(busy[0]!, /NOW {3}writing plan/);
  assert.match(busy.at(-1)!, /SUB {3}code-critic/);
});

test("unselected modules keep dim for decoration off the plate", () => {
  const theme = { ...darkTheme, dim: "#010203", muted: "#040506" };
  const sessions = [session("selected"), { ...rich, id: "busy" }];
  const layout = renderSessions(buildRenderModel({ sessions, selectedId: "selected", width: 160, height: 40, now: NOW, guidanceHidden: true }), theme);
  const rows = layout.lines.filter((_line, index) => targetId(layout.rowTargets[index]) === "busy");
  // Field labels and pending step markers read in muted; unselected modules sit on no surface.
  assert.ok(rows.some((row) => row.includes(styleToken(theme, "muted", "STEP"))), rows.join("\n"));
  assert.ok(rows.every((row) => !row.includes("\u001b[48;")));
});
