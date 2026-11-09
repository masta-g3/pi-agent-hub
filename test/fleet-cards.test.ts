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

/** Continuation lines rendered for one session, in order. */
function titleLine(rendered: ReturnType<typeof render>, id: string): string {
  return rendered.lines[rendered.layout.rowTargets.findIndex((target) => target?.kind === "session" && target.id === id)] ?? "";
}

function cardLines(rendered: ReturnType<typeof render>, id: string): string[] {
  const targets = rendered.layout.rowTargets;
  const title = targets.findIndex((target) => target?.kind === "session" && target.id === id);
  if (title < 0) return [];
  const lines: string[] = [];
  for (let index = title + 1; targets[index]?.kind === "session-continuation" && targetId(targets[index]) === id; index += 1) {
    const line = rendered.lines[index]!;
    if (!line.includes("Enter Open in Pi") && line.replace(/[▌\s]/gu, "")) lines.push(line);
  }
  return lines;
}

test("wide active cards show repo beside group, then task and activity", () => {
  const rendered = render([rich]);
  const card = cardLines(rendered, "rich");
  assert.equal(card.length, 3, card.join("\n"));
  assert.match(rendered.lines[rendered.layout.rowTargets.findIndex(target => target?.kind === "session" && target.id === "rich")]!, /Dashboard UI polish ⎇ {2}cards/);
  assert.match(card[0]!, /hub-repo ⎇ feat\/taller-cards/);
  assert.match(card[1]!, /Taller fleet cards/);
  assert.match(card[2]!, /writing plan \(pass 2\) · Phase 2\/4 · Tests/);
});

test("stopped cards omit stale activity", () => {
  const card = cardLines(render([{ ...rich, status: "stopped" }]), "rich");
  assert.ok(!card.some((line) => line.includes("writing plan") || line.includes("Phase 2/4")), card.join("\n"));
  assert.ok(card.some((line) => line.includes("hub-repo ⎇ feat/taller-cards")));
});

test("repo grouping shows only the branch and omits the line without one", () => {
  // With no repo name beside it, the branch follows the group on the card's title line.
  const groupedRender = render([rich], { fleetGrouping: "repo" });
  assert.match(titleLine(groupedRender, "rich"), /cards · feat\/taller-cards/);
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
  assert.match(card[1]!, /QUESTION/);
  assert.match(card[2]!, /Choose the boundary/);
  assert.ok(card.some((line) => line.includes("hub-repo ⎇ feat/taller-cards")));
});

test("below 100 columns cards keep task and metadata without activity", () => {
  const card = cardLines(render([rich], { width: 99 }), "rich");
  assert.equal(card.length, 2, card.join("\n"));
  assert.match(card[0]!, /hub-repo ⎇ feat\/taller-cards/);
  assert.ok(!card.some((line) => line.includes("writing plan")));
});

function linesBetween(rendered: ReturnType<typeof render>, firstId: string, secondId: string): string[] {
  const targets = rendered.layout.rowTargets;
  const second = targets.findIndex((target) => target?.kind === "session" && target.id === secondId);
  let last = second - 1;
  while (last >= 0 && !targetId(targets[last])) last -= 1;
  assert.equal(targetId(targets[last]), firstId);
  return rendered.lines.slice(last + 1, second);
}

test("wide cards in one group are separated by one plain spacer", () => {
  const rendered = render([rich, session("next")]);
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
  let last = targets.length - 1;
  while (last >= 0 && !targetId(targets[last])) last -= 1;
  const blank = rendered.lines.slice(first, last + 1).filter((line) => line.trim() === "");
  assert.deepEqual(blank, []);
});

test("neighbor cards keep group and task beside the title and drop only their activity line", () => {
  const seen = new Set<number>();
  for (let height = 8; height <= 30; height += 1) {
    const rendered = render([session("selected"), { ...rich, group: "cards" }], { height });
    const title = titleLine(rendered, "rich");
    if (!title) continue;
    assert.match(title, /Dashboard UI polish ⎇ {3}cards · Taller fleet cards/, `height ${height}`);
    const card = cardLines(rendered, "rich");
    assert.ok(card.length <= 1, `height ${height}:\n${card.join("\n")}`);
    if (card.length) assert.match(card[0]!, /writing plan \(pass 2\) · Phase 2\/4 · Tests · 3\/8 tasks/);
    seen.add(card.length);
  }
  assert.deepEqual([...seen].sort(), [0, 1]);
});

test("crowded panes keep the selected card whole with neighbors on both sides", () => {
  const sessions = Array.from({ length: 7 }, (_, index) => index === 3 ? { ...rich, id: "s3" } : session(`s${index}`));
  const rendered = render(sessions, { selectedId: "s3", height: 20 });
  assert.equal(cardLines(rendered, "s3").length, 3);
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
  assert.match(titleLine(branchedRender, "same"), /hub-repo · feat\/x/);
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

test("unselected request cards show the whole request, wrapped to three lines, before the recommendation", () => {
  const asking = session("asking", { status: "waiting", context: { version: 1, updatedAt: NOW,
    attention: { kind: "ready", requestId: "r", text: longRequest, recommendation: "Run reflect next" } } });
  for (const width of [60, 100, 160]) {
    const rendered = render([session("selected"), asking], { width });
    const card = cardLines(rendered, "asking");
    assert.ok(card.length >= 2 && card.length <= 3, `${width}:\n${card.join("\n")}`);
    assert.match(card[0]!, /READY +Review complete/);
    const text = card.join(" ").replace(/\s+/g, " ");
    if (width >= 160) {
      assert.ok(text.includes("keycap spacing"), text);
      assert.match(card.at(-1)!, /→ Run reflect next/);
    }
    // Continuation lines hang under the request text, not under the pill.
    if (card.length > 1) assert.equal(card[1]!.search(/\S/), card[0]!.indexOf("Review"), `${width}:\n${card.join("\n")}`);
  }
});

test("unselected active cards say which step they are on and what they are doing", () => {
  for (const width of [60, 100, 160]) {
    const rendered = render([session("selected"), { ...rich, id: "busy" }], { width });
    const card = cardLines(rendered, "busy");
    assert.equal(card.length, 1, `${width}:\n${card.join("\n")}`);
    assert.match(card[0]!, /writing plan \(pass 2\) · Phase 2\/4 · Tests · 3\/8 tasks/);
    // Below 80 the title row already names the step.
    if (width >= 80) assert.match(card[0]!, /^\s+Execute · writing plan/);
    else assert.match(titleLine(rendered, "busy"), /Execute\s*$/);
  }
  const idle = render([session("selected"), session("plain", { workflow })]);
  assert.match(cardLines(idle, "plain")[0] ?? "", /^\s+Execute\s*$/, "a step without activity still names the step");
});

test("unselected health cards show their error reason", () => {
  const broken = session("broken", { status: "error", error: "MCP pool failed to start" });
  const rendered = renderSessions(buildRenderModel({ sessions: [session("selected"), broken], selectedId: "selected", width: 120, height: 40, now: NOW, guidanceHidden: true }), darkTheme);
  const index = rendered.rowTargets.findIndex((target) => target?.kind === "session" && target.id === "broken");
  const detail = rendered.lines[index + 1]!;
  assert.match(stripAnsi(detail), /MCP pool failed to start/);
  assert.ok(detail.includes(styleToken(darkTheme, "error", "MCP pool failed to start")));
});

test("quiet rows stay one line even with a workflow", () => {
  const quiet = session("quiet", { status: "idle", workflow: rich.workflow });
  const rendered = render([session("selected", { status: "idle" }), quiet], { width: 160 });
  assert.deepEqual(cardLines(rendered, "quiet"), []);
});

test("an idle parent with running subagents names what they are doing", () => {
  const parent = session("parent", { status: "idle", title: "Tile review" });
  const child = (id: string, agentName: string, taskPreview: string, status: RuntimeSession["status"] = "running") =>
    session(id, { kind: "subagent", parentId: "parent", agentName, taskPreview, status });
  const rendered = render([session("selected"), parent, child("c1", "code-critic", "Review the pixel map diff"), child("c2", "scout", "Find tile loaders"), child("c3", "worker", "Done earlier", "stopped")]);
  assert.match(titleLine(rendered, "parent"), /Tile review ↳2/);
  assert.deepEqual(cardLines(rendered, "parent").map((line) => line.trim()), ["↳ code-critic · Review the pixel map diff · +1 more"]);
  // An expanded tree shows the subagent rows themselves instead.
  const expanded = render([session("selected"), parent, child("c1", "code-critic", "Review the pixel map diff")], { expandedProjectParentIds: new Set(["parent"]) });
  assert.ok(!cardLines(expanded, "parent").some((line) => line.trim().startsWith("↳")), cardLines(expanded, "parent").join("\n"));
  // A parent with its own activity keeps that line instead.
  const busy = render([session("selected"), { ...rich, id: "parent" }, child("c1", "code-critic", "Review the pixel map diff")]);
  assert.match(cardLines(busy, "parent")[0]!, /writing plan/);
});

test("painted unselected cards never draw dim text on their surface", () => {
  const theme = { ...darkTheme, dim: "#010203", muted: "#040506" };
  const sessions = [session("selected"), { ...rich, id: "busy" }, session("quiet", { status: "idle", workflow: rich.workflow })];
  const layout = renderSessions(buildRenderModel({ sessions, selectedId: "selected", width: 160, height: 40, now: NOW, guidanceHidden: true }), theme);
  const row = (id: string) => layout.lines[layout.rowTargets.findIndex((target) => target?.kind === "session" && target.id === id)]!;
  // Pending workflow markers on the ACTIVE card read in muted; the flat QUIET row keeps dim decoration.
  assert.ok(row("busy").includes(styleToken(theme, "muted", "·")) && !row("busy").includes(styleToken(theme, "dim", "·")), row("busy"));
  assert.ok(row("quiet").includes(styleToken(theme, "dim", "·")), row("quiet"));
});
