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
function cardLines(rendered: ReturnType<typeof render>, id: string): string[] {
  const targets = rendered.layout.rowTargets;
  const title = targets.findIndex((target) => target?.kind === "session" && target.id === id);
  if (title < 0) return [];
  const lines: string[] = [];
  for (let index = title + 1; targets[index]?.kind === "session-continuation" && targetId(targets[index]) === id; index += 1) lines.push(rendered.lines[index]!);
  return lines;
}

test("wide active cards show summary, activity, then repo and branch", () => {
  const rendered = render([rich]);
  const card = cardLines(rendered, "rich");
  assert.equal(card.length, 4, card.join("\n"));
  assert.match(card[0]!, /\[cards\]/);
  assert.match(card[1]!, /Taller fleet cards/);
  assert.match(card[2]!, /writing plan \(pass 2\) · Phase 2\/4 · Tests/);
  assert.match(card[3]!, /hub-repo ⎇ feat\/taller-cards/);
});

test("stopped cards omit stale activity", () => {
  const card = cardLines(render([{ ...rich, status: "stopped" }]), "rich");
  assert.ok(!card.some((line) => line.includes("writing plan") || line.includes("Phase 2/4")), card.join("\n"));
  assert.ok(card.some((line) => line.includes("hub-repo ⎇ feat/taller-cards")));
});

test("repo grouping shows only the branch and omits the line without one", () => {
  const grouped = cardLines(render([rich], { fleetGrouping: "repo" }), "rich");
  const repoLine = grouped.find((line) => line.includes("⎇ feat/taller-cards"));
  assert.ok(repoLine);
  assert.ok(!repoLine.includes("hub-repo"), repoLine);
  const branchless = cardLines(render([{ ...rich, worktreeBranch: undefined }], { fleetGrouping: "repo" }), "rich");
  assert.ok(!branchless.some((line) => line.includes("⎇") || line.includes("hub-repo")), branchless.join("\n"));
});

test("status grouping without a branch shows the repo label alone", () => {
  const card = cardLines(render([{ ...rich, worktreeBranch: undefined }]), "rich");
  assert.match(card.at(-1)!, /[│└] ◈ hub-repo\s/, card.join("\n"));
  assert.ok(!card.some((line) => line.includes("⎇")));
});

test("explicit requests stay the first continuation after metadata", () => {
  const asking = {
    ...rich, status: "waiting" as const,
    context: { version: 1 as const, updatedAt: NOW, attention: { kind: "question" as const, text: "Choose the boundary", requestId: "r1" } },
  };
  const card = cardLines(render([asking]), "rich");
  assert.match(card[1]!, /“Choose the boundary”/);
  assert.ok(card.some((line) => line.includes("hub-repo ⎇ feat/taller-cards")));
});

test("below 100 columns cards keep their previous lines", () => {
  const card = cardLines(render([rich], { width: 99 }), "rich");
  assert.equal(card.length, 2, card.join("\n"));
  assert.ok(!card.some((line) => line.includes("⎇") || line.includes("writing plan")));
});

/** List column zero sits after the left frame and the 17-cell tier navigator at 120+ columns. */
const LIST_START = 19;

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
  assert.equal(spacer[LIST_START + 1], " ", "no tree gutter on the spacer");
  assert.equal(spacer.slice(LIST_START, spacer.indexOf("│", LIST_START)).trim(), "");
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
  const blank = rendered.lines.slice(first, last + 1).filter((line) => line.slice(LIST_START, line.indexOf("│", LIST_START + 2)).trim() === ""
    && !/↑|↓/.test(line));
  assert.deepEqual(blank, []);
});

test("neighbor cards drop activity, then repo, then summary, keeping metadata", () => {
  const expected: Record<number, RegExp[]> = {
    1: [/\[cards\]/],
    2: [/\[cards\]/, /Taller fleet cards/],
    3: [/\[cards\]/, /Taller fleet cards/, /◈ hub-repo ⎇/],
    4: [/\[cards\]/, /Taller fleet cards/, /writing plan/, /◈ hub-repo ⎇/],
  };
  const seen = new Set<number>();
  for (let height = 8; height <= 30; height += 1) {
    const card = cardLines(render([session("selected"), { ...rich, group: "cards" }], { height }), "rich");
    if (!card.length) continue;
    const order = expected[card.length]!;
    card.forEach((line, index) => assert.match(line, order[index]!, `height ${height}:\n${card.join("\n")}`));
    seen.add(card.length);
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4]);
});

test("crowded panes keep the selected card whole with neighbors on both sides", () => {
  const sessions = Array.from({ length: 7 }, (_, index) => index === 3 ? { ...rich, id: "s3" } : session(`s${index}`));
  const rendered = render(sessions, { selectedId: "s3", height: 20 });
  assert.equal(cardLines(rendered, "s3").length, 4);
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

test("the bold group badge stands in for a repo that repeats it", () => {
  const same = cardLines(render([session("same", { group: "Hub Repo" })]), "same");
  assert.equal(same.length, 1, same.join("\n"));
  const branched = cardLines(render([session("same", { group: "hub-repo", worktreeBranch: "feat/x" })]), "same");
  const repoLine = branched.find((line) => line.includes("⎇ feat/x"));
  assert.ok(repoLine && !/hub-repo ⎇/.test(repoLine), branched.join("\n"));
  const raw = renderSessions(buildRenderModel({ sessions: [session("same")], selectedId: "same", width: 160, height: 60, now: NOW, guidanceHidden: true }), darkTheme).lines;
  assert.ok(raw.some((line) => line.includes("\u001b[1mcards\u001b[22m")), "bold group badge");
  const differing = raw.find((line) => stripAnsi(line).includes("◈ hub-repo"))!;
  assert.ok(differing.includes(styleToken(darkTheme, "accent", "◈")) && differing.includes("\u001b[1mhub-repo\u001b[22m"), differing);
});

test("narrow and pinned views carry a differing repo name on the metadata line", () => {
  const differing = session("diff", { group: "mobile" });
  const same = session("same", { group: "hub-repo" });
  for (const input of [{ width: 60 }, { width: 99 }, { width: 120, pinSlots: ["diff", undefined], activePinnedSessionId: "diff" }] as Partial<BuildRenderModelInput>[]) {
    const rendered = render([differing, same], { height: 40, ...input });
    const diffCard = cardLines(rendered, "diff");
    assert.equal(diffCard.length, 1, JSON.stringify(input) + "\n" + diffCard.join("\n"));
    assert.match(diffCard[0]!, /\[mobile\] ◈ hub-repo/, JSON.stringify(input) + "\n" + diffCard[0]);
    const sameCard = cardLines(rendered, "same");
    assert.doesNotMatch(sameCard[0]!, /◈/, JSON.stringify(input) + "\n" + sameCard[0]);
  }
  const wide = cardLines(render([differing]), "diff");
  assert.doesNotMatch(wide[0]!, /◈/, "wide cards keep the repo on its own line\n" + wide.join("\n"));
  assert.ok(wide.some((line) => /◈ hub-repo/.test(line)), wide.join("\n"));
  const tight = cardLines(render([differing], { width: 30, height: 40 }), "diff");
  assert.match(tight[0]!, /\[mobile\]/, tight.join("\n"));
});
