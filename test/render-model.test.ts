import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildRenderModel, retainSelectionAfterRefresh } from "../src/tui/render-model.js";
import { renderSessions } from "../src/tui/layout.js";
import { stripAnsi } from "../src/tui/theme.js";
import type { ManagedSession, SessionStatus } from "../src/core/types.js";

function session(id: string, group: string, status: SessionStatus, title = id): ManagedSession {
  return {
    id,
    title,
    cwd: `/tmp/${title}`,
    group,
    tmuxSession: `pi-agent-hub-${id}`,
    status,
    createdAt: 1,
    updatedAt: 1,
  };
}

test("empty state rendering includes first-run prompts", () => {
  const lines = renderSessions(buildRenderModel({ sessions: [], width: 64 }));
  assert.match(lines.join("\n"), /No managed Pi sessions yet/);
  assert.match(lines.join("\n"), /▶ n  create a session/);
  assert.match(lines.join("\n"), /  q  quit/);
});

test("grouping order and status counts", () => {
  const model = buildRenderModel({
    sessions: [session("b", "work", "idle"), session("a", "default", "waiting"), session("e", "default", "error")],
    width: 120,
  });
  assert.deepEqual(model.groups.map((group) => group.name), ["default", "work"]);
  assert.deepEqual(model.groups[0]?.statusCounts, { running: 0, waiting: 1, idle: 0, error: 1, stopped: 0 });
  assert.deepEqual(model.groups[1]?.statusCounts, { running: 0, waiting: 0, idle: 1, error: 0, stopped: 0 });
  const rendered = renderSessions(model).join("\n");
  assert.match(rendered, /◐1 ×1/);
  assert.doesNotMatch(rendered, /1 waiting · 1 error/);
});

test("session order is stable and ignores status and title", () => {
  const model = buildRenderModel({
    sessions: [
      session("worker", "default", "idle", "zzz"),
      session("api", "default", "error", "aaa"),
      session("docs", "default", "waiting", "mmm"),
    ],
    width: 120,
  });
  assert.deepEqual(model.groups[0]?.sessions.map((item) => item.id), ["worker", "api", "docs"]);
});

test("narrow layout hides preview and uses compact footer", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "idle")], width: 70 });
  assert.equal(model.showPreview, false);
  assert.match(model.footer, /\?/);
  assert.match(model.footer, /i/);
  assert.match(model.footer, /│/);
  assert.doesNotMatch(model.footer, /Info/);
});


test("wide footer groups keys by intent", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "idle")], width: 120 });
  assert.equal(model.footer, "Enter Open · n New · / Filter  │  i Info · r Rename · R Restart · w Finish WT  │  ? Help");
});

test("long titles/cwd truncate without exceeding width", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "idle", "a".repeat(100))], width: 60 });
  for (const line of renderSessions(model)) assert.ok(visibleWidth(line) <= 60, line);
});


test("long paths truncate from the start and keep basename", () => {
  const longPath = `/tmp/${"deep/".repeat(20)}project-api`;
  const model = buildRenderModel({ sessions: [{ ...session("a", "default", "idle", "api"), cwd: longPath }], selectedId: "a", width: 80 });
  const rendered = renderSessions(model).join("\n");
  assert.match(rendered, /….*project-api/);
  for (const line of renderSessions(model)) assert.ok(visibleWidth(line) <= 80, line);
});

test("wide preview glyphs do not exceed terminal width", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "idle", "api")], selectedId: "a", width: 80, preview: " - npm test ✅\n - npm run package:check ✅" });
  for (const line of renderSessions(model)) assert.ok(visibleWidth(line) <= 80, line);
});

test("styled preview lines keep italics only", () => {
  const preview = "\u001b[1;38;5;244mHeading\u001b[0m\n\u001b[3;38;2;1;2;3m- thought\u001b[0m\n\u001b[4munderlined\u001b[0m";
  const rendered = renderSessions(buildRenderModel({ sessions: [session("a", "default", "idle", "api")], selectedId: "a", width: 120, preview })).join("\n");

  assert.doesNotMatch(rendered, /\u001b\[1mHeading/);
  assert.match(rendered, /\u001b\[3m- thought\u001b\[0m/);
  assert.doesNotMatch(rendered, /\u001b\[4munderlined/);
  assert.doesNotMatch(rendered, /38;[25];/);
  for (const line of rendered.split("\n")) assert.ok(visibleWidth(line) <= 120, line);
});

test("top summary shows visible totals status counts and filter", () => {
  const model = buildRenderModel({
    sessions: [session("api", "default", "running"), session("docs", "default", "waiting"), session("web", "default", "error")],
    width: 120,
    filter: "doc",
  });

  assert.equal(model.summary.total, 3);
  assert.equal(model.summary.visibleTotal, 1);
  assert.deepEqual(model.summary.statusCounts, { running: 0, waiting: 1, idle: 0, error: 0, stopped: 0 });
  assert.match(renderSessions(model).join("\n"), /1\/3 sessions · ◐1 · filter: doc/);
});


test("error reason appears in selected metadata", () => {
  const broken = { ...session("a", "default", "error", "api"), error: "MCP failed" };
  const lines = renderSessions(buildRenderModel({ sessions: [broken], selectedId: "a", width: 120 }));
  assert.match(lines.join("\n"), /error\s+MCP failed/);
});

test("selected and stopped rows have distinct treatments without moving stopped rows", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "stopped", "api"), session("b", "default", "idle", "docs")], selectedId: "b", width: 100 });
  const lines = renderSessions(model).join("\n");
  assert.match(lines, /· - api[\s\S]*▶ ○ docs/);
  assert.doesNotMatch(lines, /Stopped/);
});

test("preview renders captured tmux output with empty state", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "idle", "api")], selectedId: "a", width: 120, preview: "one\ntwo" });
  const lines = renderSessions(model).join("\n");
  assert.match(lines, /one/);
  assert.match(lines, /two/);
  assert.doesNotMatch(lines, /preview loads from tmux/);

  const empty = renderSessions(buildRenderModel({ sessions: [session("a", "default", "idle", "api")], selectedId: "a", width: 120, preview: "" })).join("\n");
  assert.match(empty, /preview empty/);
});

test("filter matches across title group cwd basename and status", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "idle", "api"), session("b", "work", "waiting", "docs")], width: 100, filter: "wait" });
  assert.equal(model.groups.length, 1);
  assert.equal(model.groups[0]?.sessions[0]?.id, "b");
});

test("multi-repo sessions render repo badge and compact details", () => {
  const multi = {
    ...session("a", "default", "idle", "api"),
    cwd: "/repo/api",
    additionalCwds: ["/repo/web", "/repo/shared"],
    workspaceCwd: "/state/workspaces/a",
  };
  const model = buildRenderModel({ sessions: [multi], selectedId: "a", width: 120, filter: "shared" });

  assert.equal(model.selected?.repoCount, 3);
  const rendered = renderSessions(model).join("\n");
  assert.match(rendered, /\[3 repos\]/);
  assert.match(rendered, /\/repo\/api · 3 repos/);
  assert.doesNotMatch(rendered, /group default/);
  assert.doesNotMatch(rendered, /extra\s+\/repo\/web/);
  assert.doesNotMatch(rendered, /runtime\s+\/state\/workspaces\/a/);
});


test("single-repo compact details omit repo count and group", () => {
  const model = buildRenderModel({
    sessions: [{ ...session("a", "default", "idle", "api"), cwd: "/repo/api" }],
    selectedId: "a",
    width: 120,
  });
  const rendered = renderSessions(model).join("\n");
  assert.match(rendered, /\/repo\/api/);
  assert.doesNotMatch(rendered, /1 repo/);
  assert.doesNotMatch(rendered, /group default/);
});


test("compact details surface selected skills and MCP when present", () => {
  const withTools = {
    ...session("a", "default", "idle", "api"),
    cwd: "/repo/api",
    enabledMcpServers: ["filesystem", "github"],
  };
  const model = buildRenderModel({ sessions: [withTools], selectedId: "a", width: 120, selectedSkillCount: 3 });

  const rendered = renderSessions(model).join("\n");
  assert.match(rendered, /skills 3 · mcp 2\s+s\/m edit/);
  assert.doesNotMatch(rendered, /filesystem, github/);
});


test("compact details hide capabilities line when no skills or MCP are attached", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "idle", "api")], selectedId: "a", width: 120, selectedSkillCount: 0 });
  const rendered = renderSessions(model).join("\n");
  assert.doesNotMatch(rendered, /skills 0/);
  assert.doesNotMatch(rendered, /mcp 0/);
  assert.doesNotMatch(rendered, /s\/m edit/);
});


test("preview divider has no read-only label", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "idle", "api")], selectedId: "a", width: 120, preview: "hi" });
  const rendered = renderSessions(model).join("\n");
  assert.match(rendered, /── preview ─/);
  assert.doesNotMatch(rendered, /read-only/);
});


test("selected title and status render inline on the same line", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "running", "c-bridge")], selectedId: "a", width: 200 });
  const rendered = renderSessions(model).join("\n");
  const titleLine = rendered.split("\n").find((line) => line.includes("c-bridge") && !line.includes("▶"));
  assert.ok(titleLine, "expected an inline title row in the right pane");
  assert.match(titleLine!, /c-bridge\s{1,}● running/);
});


test("long selected title preserves inline status", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "waiting", "selected-title-".repeat(10))], selectedId: "a", width: 80 });
  const lines = renderSessions(model);
  const titleLine = lines.find((line) => line.includes("◐ waiting") && !line.includes("▶"));
  assert.ok(titleLine, "expected selected details to keep the status badge");
  assert.match(stripAnsi(titleLine!), /…\s+◐ waiting/);
  for (const line of lines) assert.ok(visibleWidth(line) <= 80, line);
});


test("model.height pads body rows so the box fills the terminal", () => {
  const lines = renderSessions(buildRenderModel({
    sessions: [session("a", "default", "idle", "api")],
    selectedId: "a",
    width: 120,
    height: 30,
  }));
  assert.equal(lines.length, 30);
});


test("narrow group header truncates name before status counts", () => {
  const sessions = [
    { ...session("a", "long-group-name-that-overflows", "running"), cwd: "/r/a" },
    { ...session("b", "long-group-name-that-overflows", "waiting"), cwd: "/r/b" },
    { ...session("c", "long-group-name-that-overflows", "error"), cwd: "/r/c" },
  ];
  const lines = renderSessions(buildRenderModel({ sessions, width: 50 }));
  const groupLine = lines.find((line) => line.includes("◐1") || line.includes("●1"));
  assert.ok(groupLine, "expected a group header line with status counts");
  for (const line of lines) assert.ok(visibleWidth(line) <= 50, line);
  assert.match(groupLine!, /●1\s◐1\s×1/);
});


test("very long group names preserve status counts", () => {
  const group = "group-".repeat(20);
  const sessions = [session("a", group, "running"), session("b", group, "waiting"), session("c", group, "error")];
  const lines = renderSessions(buildRenderModel({ sessions, width: 50 }));
  const groupLine = lines.map(stripAnsi).find((line) => line.includes("group-") && line.includes("●1") && line.includes("◐1") && line.includes("×1"));
  assert.ok(groupLine, "expected counts to remain visible after group name truncation");
  assert.match(groupLine!, /…\s+●1\s◐1\s×1/);
  for (const line of lines) assert.ok(visibleWidth(line) <= 50, line);
});


test("expanded multi-repo details show full metadata", () => {
  const multi = {
    ...session("a", "default", "idle", "api"),
    cwd: "/repo/api",
    additionalCwds: ["/repo/web", "/repo/shared"],
    workspaceCwd: "/state/workspaces/a",
  };
  const model = buildRenderModel({ sessions: [multi], selectedId: "a", width: 120, detailsExpanded: true });

  const rendered = renderSessions(model).join("\n");
  assert.match(rendered, /extra\s+\/repo\/web/);
  assert.match(rendered, /extra\s+\/repo\/shared/);
  assert.match(rendered, /runtime\s+\/state\/workspaces\/a/);
});

test("filter with zero matches renders no-match state", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "idle", "api")], width: 100, filter: "zzz" });
  assert.equal(model.noMatches, true);
  const rendered = renderSessions(model).join("\n");
  assert.match(rendered, /0\/1 sessions · filter: zzz/);
  assert.match(rendered, /No sessions match/);
  assert.match(rendered, /▶ Use the footer controls below/);
});

test("starting displays and counts as running", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "starting")], width: 100 });
  assert.equal(model.selected?.displayStatus, "running");
  assert.deepEqual(model.summary.statusCounts, { running: 1, waiting: 0, idle: 0, error: 0, stopped: 0 });
});

test("selection retention chooses next sibling without jumping groups", () => {
  const previous = [session("a", "default", "idle"), session("b", "default", "idle"), session("c", "work", "idle")];
  const next = [session("a", "default", "idle"), session("c", "work", "idle")];
  assert.equal(retainSelectionAfterRefresh(previous, next, "b"), "a");
});

test("subagent rows render directly under their parent", () => {
  const parent = session("parent", "default", "idle", "api");
  const child = {
    ...session("child", "default", "running", "scout child"),
    kind: "subagent" as const,
    parentId: "parent",
    agentName: "scout",
    taskPreview: "read auth.ts",
  };
  const sibling = session("sibling", "default", "idle", "web");
  const model = buildRenderModel({ sessions: [parent, sibling, child], width: 120 });

  assert.deepEqual(model.groups[0]?.sessions.map((item) => item.id), ["parent", "child", "sibling"]);
  assert.equal(model.groups[0]?.sessions[1]?.depth, 1);
  const lines = renderSessions(model).join("\n");
  assert.match(lines, /↳ .*scout/);
  assert.doesNotMatch(lines, /read auth\.ts/);
});

test("nested subagent rows render under their subagent parent", () => {
  const parent = session("parent", "default", "idle", "api");
  const child = {
    ...session("child", "default", "running", "worker"),
    kind: "subagent" as const,
    parentId: "parent",
    agentName: "worker",
  };
  const grandchild = {
    ...session("grandchild", "default", "waiting", "critic"),
    kind: "subagent" as const,
    parentId: "child",
    agentName: "code-critic",
  };
  const model = buildRenderModel({ sessions: [parent, grandchild, child], width: 120 });

  assert.deepEqual(model.groups[0]?.sessions.map((item) => item.id), ["parent", "child", "grandchild"]);
  assert.equal(model.groups[0]?.sessions[1]?.depth, 1);
  assert.equal(model.groups[0]?.sessions[2]?.depth, 2);
  assert.match(renderSessions(model).join("\n"), /↳ .*worker[\s\S]*↳ .*code-critic/);
});

test("filtering by nested child includes ancestor context", () => {
  const parent = session("parent", "default", "idle", "api");
  const child = {
    ...session("child", "default", "running", "scout child"),
    kind: "subagent" as const,
    parentId: "parent",
    agentName: "scout",
  };
  const grandchild = {
    ...session("grandchild", "default", "waiting", "critic child"),
    kind: "subagent" as const,
    parentId: "child",
    agentName: "code-critic",
    taskPreview: "unique nested task",
  };
  const model = buildRenderModel({ sessions: [parent, child, grandchild, session("other", "default", "idle", "web")], width: 120, filter: "unique" });

  assert.deepEqual(model.groups[0]?.sessions.map((item) => item.id), ["parent", "child", "grandchild"]);
});
