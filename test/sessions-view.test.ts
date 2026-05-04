import test from "node:test";
import assert from "node:assert/strict";
import { SessionsController } from "../src/app/controller.js";
import { SessionsView } from "../src/tui/sessions-view.js";
import { darkTheme, stripAnsi } from "../src/tui/theme.js";
import type { ManagedSession } from "../src/core/types.js";

function session(id: string, title: string): ManagedSession {
  return {
    id,
    title,
    cwd: `/tmp/${title}`,
    group: "default",
    tmuxSession: `pi-sessions-${id}`,
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
  };
}

test("filter mode filters live and escape clears", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {});

  view.handleInput("/");
  view.handleInput("d");
  view.handleInput("o");
  assert.equal(controller.snapshot().filter, "do");
  assert.match(view.render(100).join("\n"), /docs/);
  assert.doesNotMatch(view.render(100).join("\n"), /api/);

  view.handleInput("\u001b");
  assert.equal(controller.snapshot().filter, undefined);
});

test("filter input supports cursor movement", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {});

  view.handleInput("/");
  for (const char of "api") view.handleInput(char);
  view.handleInput("\u001b[D");
  view.handleInput("X");

  assert.match(view.render(100).join("\n"), /filter: apX█i/);
  assert.equal(controller.snapshot().filter, "apXi");
});

test("committed filter footer uses esc clear and escape clears", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {});
  view.handleInput("/");
  view.handleInput("d");
  view.handleInput("o");
  view.handleInput("\r");
  assert.match(view.render(100).join("\n"), /esc clear/);
  assert.doesNotMatch(view.render(100).join("\n"), /enter done/);
  view.handleInput("\u001b");
  assert.equal(controller.snapshot().filter, undefined);
});

test("q stops the TUI", () => {
  let stopped = false;
  const view = new SessionsView(new SessionsController(), () => { stopped = true; });
  view.handleInput("q");
  assert.equal(stopped, true);
});

test("slash on empty state does not trap q in filter mode", () => {
  let stopped = false;
  const view = new SessionsView(new SessionsController(), () => { stopped = true; });
  view.handleInput("/");
  view.handleInput("q");
  assert.equal(stopped, true);
});

test("help overlay opens and closes", () => {
  const view = new SessionsView(new SessionsController(), () => {});
  view.handleInput("?");
  assert.match(view.render(80).join("\n"), /pi sessions help/);
  view.handleInput("\u001b");
  assert.doesNotMatch(view.render(80).join("\n"), /pi sessions help/);
});

test("q quits from help overlay", () => {
  let stopped = false;
  const view = new SessionsView(new SessionsController(), () => { stopped = true; });
  view.handleInput("?");
  view.handleInput("q");
  assert.equal(stopped, true);
});

test("enter triggers attach action outside tmux", () => {
  const oldTmux = process.env.TMUX;
  delete process.env.TMUX;
  try {
    let attached: string | undefined;
    const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
    const view = new SessionsView(controller, () => {}, { attachOutsideTmux: (tmuxSession) => { attached = tmuxSession; } });
    view.handleInput("\r");
    assert.equal(attached, "pi-sessions-api");
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("enter inside tmux switches client and keeps command visible", () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    let switched: string | undefined;
    let copied: string | undefined;
    const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
    const view = new SessionsView(controller, () => {}, {
      attachOutsideTmux: () => { throw new Error("outside attach should not run inside tmux"); },
      switchInsideTmux: (tmuxSession) => { switched = tmuxSession; },
      copy: (text) => { copied = text; },
    });

    view.handleInput("\r");

    assert.equal(switched, "pi-sessions-api");
    assert.equal(copied, "tmux switch-client -t pi-sessions-api");
    assert.match(view.render(100).join("\n"), /tmux switch-client -t pi-sessions-api/);
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("inside tmux switch action errors show in footer", async () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
    const view = new SessionsView(controller, () => {}, {
      switchInsideTmux: async () => { throw new Error("switch failed"); },
    });

    view.handleInput("\r");
    await new Promise((resolve) => setImmediate(resolve));

    assert.match(view.render(100).join("\n"), /switch failed: switch failed/);
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("new form submits with smart defaults on enter", () => {
  let created: { cwd: string; group: string; title: string } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api" }),
  });
  view.handleInput("n");
  const rendered = view.render(120).join("\n");
  assert.match(rendered, /New session/);
  assert.match(rendered, /cwd/);
  assert.match(rendered, /group/);
  assert.match(rendered, /title/);
  view.handleInput("\r");
  assert.deepEqual(created, { cwd: "/tmp/api", group: "default", title: "api" });
});

test("new form tab cycles focus and edits target field", () => {
  let created: { cwd: string; group: string; title: string } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api" }),
  });
  view.handleInput("n");
  view.handleInput("\t");
  view.handleInput("\t");
  for (const char of "-prod") view.handleInput(char);
  view.handleInput("\r");
  assert.deepEqual(created, { cwd: "/tmp/api", group: "default", title: "api-prod" });
});

test("new form per-field validation focuses first invalid field on enter", () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    newFormContext: () => ({ cwd: "/tmp/api" }),
  });
  view.handleInput("n");
  for (let i = 0; i < "/tmp/api".length; i += 1) view.handleInput("\u007f");
  view.handleInput("\r");
  const invalid = view.render(120).join("\n");
  assert.match(invalid, /New session/);
  assert.match(invalid, /cwd is required/);
  view.handleInput("\u001b");
  assert.doesNotMatch(view.render(120).join("\n"), /cwd is required/);
});

test("new form ctrl-n cycles cwd suggestions and updates title until touched", () => {
  let created: { cwd: string; group: string; title: string } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", knownCwds: ["/tmp/web", "/tmp/api"] }),
  });
  view.handleInput("n");
  view.handleInput("\u000e");
  const rendered = view.render(120).join("\n");
  assert.match(rendered, /\/tmp\/web/);
  assert.match(rendered, /web/);
  view.handleInput("\r");
  assert.deepEqual(created, { cwd: "/tmp/web", group: "default", title: "web" });
});

test("new form preserves user-edited title across cwd changes", () => {
  let created: { cwd: string; group: string; title: string } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", knownCwds: ["/tmp/api", "/tmp/web"] }),
  });
  view.handleInput("n");
  view.handleInput("\t");
  view.handleInput("\t");
  for (let i = 0; i < "api".length; i += 1) view.handleInput("\u007f");
  for (const char of "manual") view.handleInput(char);
  view.handleInput("\t");
  view.handleInput("\u000e");
  view.handleInput("\r");
  assert.deepEqual(created, { cwd: "/tmp/web", group: "default", title: "manual" });
});

test("new form context fills group from registry cwd history", () => {
  let created: { cwd: string; group: string; title: string } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", groupForCwd: () => "backend" }),
  });
  view.handleInput("n");
  view.handleInput("\r");
  assert.deepEqual(created, { cwd: "/tmp/api", group: "backend", title: "api" });
});

test("delete dialog requires confirmation and escape cancels", () => {
  let deleted: string | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { deleteSession: (id) => { deleted = id; } });

  view.handleInput("d");
  const rendered = view.render(100).join("\n");
  assert.match(rendered, /Delete session/);
  assert.match(rendered, /api/);
  assert.match(rendered, /▶ press d again to delete/);
  view.handleInput("\u001b");
  assert.equal(deleted, undefined);
  assert.doesNotMatch(view.render(100).join("\n"), /Delete session/);
});

test("delete dialog confirms with second d", () => {
  let deleted: string | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { deleteSession: (id) => { deleted = id; } });

  view.handleInput("d");
  view.handleInput("d");
  assert.equal(deleted, "api");
  assert.doesNotMatch(view.render(100).join("\n"), /Delete session/);
});

test("delete dialog ignores repeated confirm while async delete is pending", async () => {
  let calls = 0;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { deleteSession: () => { calls += 1; return pending; } });

  view.handleInput("d");
  view.handleInput("d");
  view.handleInput("d");
  assert.equal(calls, 1);
  assert.match(view.render(100).join("\n"), /deleting/);
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.doesNotMatch(view.render(100).join("\n"), /Delete session/);
});

test("delete dialog keeps async errors visible", async () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { deleteSession: async () => { throw new Error("delete failed"); } });

  view.handleInput("d");
  view.handleInput("d");
  await new Promise((resolve) => setImmediate(resolve));
  const rendered = view.render(100).join("\n");
  assert.match(rendered, /Delete session/);
  assert.match(rendered, /delete failed/);
});

test("controller removeSession keeps neighboring selection", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs"), session("web", "web")] });
  controller.move(1);
  controller.removeSession("docs");
  assert.equal(controller.snapshot().selectedId, "web");
  assert.deepEqual(controller.snapshot().registry.sessions.map((item) => item.id), ["api", "web"]);
});

test("group dialog moves selected session to typed group", () => {
  let moved: { id: string; group: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { changeGroup: (id, group) => { moved = { id, group }; } });

  view.handleInput("g");
  const rendered = view.render(100).join("\n");
  assert.match(rendered, /Move to group/);
  assert.match(rendered, /▎ group\s+█/);
  assert.match(rendered, /existing or new group label/);
  for (const char of "backend") view.handleInput(char);
  view.handleInput("\r");

  assert.deepEqual(moved, { id: "api", group: "backend" });
  assert.doesNotMatch(view.render(100).join("\n"), /Move to group/);
});

test("group dialog validates blank group and escape cancels", () => {
  let moved: { id: string; group: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { changeGroup: (id, group) => { moved = { id, group }; } });

  view.handleInput("g");
  view.handleInput("\r");
  assert.equal(moved, undefined);
  assert.match(view.render(100).join("\n"), /group is required/);

  view.handleInput("\u001b");
  assert.doesNotMatch(view.render(100).join("\n"), /Move to group/);
});

test("r opens rename dialog for selected session title", () => {
  let renamed: { id: string; title: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { renameSession: (id, title) => { renamed = { id, title }; } });

  view.handleInput("r");
  const rendered = view.render(100).join("\n");
  assert.match(rendered, /Rename session/);
  assert.match(rendered, /▎ title\s+api█/);
  assert.match(rendered, /session display title/);
  for (let i = 0; i < "api".length; i += 1) view.handleInput("\u007f");
  for (const char of "backend") view.handleInput(char);
  view.handleInput("\r");

  assert.deepEqual(renamed, { id: "api", title: "backend" });
  assert.doesNotMatch(view.render(100).join("\n"), /Rename session/);
});

test("rename dialog supports cursor movement and mid-line editing", () => {
  let renamed: { id: string; title: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { renameSession: (id, title) => { renamed = { id, title }; } });

  view.handleInput("r");
  view.handleInput("\u001b[D");
  view.handleInput("X");
  assert.match(view.render(100).join("\n"), /apX█i/);
  view.handleInput("\r");

  assert.deepEqual(renamed, { id: "api", title: "apXi" });
});

test("rename dialog supports word movement and word backspace", () => {
  let renamed: { id: string; title: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "alpha beta gamma")] });
  const view = new SessionsView(controller, () => {}, { renameSession: (id, title) => { renamed = { id, title }; } });

  view.handleInput("r");
  view.handleInput("\u001b[1;5D");
  view.handleInput("\u0017");
  view.handleInput("\r");

  assert.deepEqual(renamed, { id: "api", title: "alpha gamma" });
});

test("rename dialog validates blank title", () => {
  let renamed: { id: string; title: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { renameSession: (id, title) => { renamed = { id, title }; } });

  view.handleInput("r");
  for (let i = 0; i < "api".length; i += 1) view.handleInput("\u007f");
  view.handleInput("\r");

  assert.equal(renamed, undefined);
  assert.match(view.render(100).join("\n"), /title is required/);
});

test("e remains a rename alias", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {});

  view.handleInput("e");

  assert.match(view.render(100).join("\n"), /Rename session/);
});

test("group rename dialog renames selected session current group", () => {
  let renamed: { from: string; to: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [{ ...session("api", "api"), group: "backend" }, { ...session("docs", "docs"), group: "backend" }] });
  const view = new SessionsView(controller, () => {}, { renameGroup: (from, to) => { renamed = { from, to }; } });

  view.handleInput("G");
  const rendered = view.render(100).join("\n");
  assert.match(rendered, /Rename group/);
  assert.match(rendered, /▎ to\s+backend█/);
  assert.match(rendered, /renames all sessions currently in backend/);
  for (let i = 0; i < "backend".length; i += 1) view.handleInput("\u007f");
  for (const char of "api") view.handleInput(char);
  view.handleInput("\r");

  assert.deepEqual(renamed, { from: "backend", to: "api" });
  assert.doesNotMatch(view.render(100).join("\n"), /Rename group/);
});

test("group rename dialog validates blank group", () => {
  let renamed: { from: string; to: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [{ ...session("api", "api"), group: "backend" }] });
  const view = new SessionsView(controller, () => {}, { renameGroup: (from, to) => { renamed = { from, to }; } });

  view.handleInput("G");
  for (let i = 0; i < "backend".length; i += 1) view.handleInput("\u007f");
  view.handleInput("\r");

  assert.equal(renamed, undefined);
  assert.match(view.render(100).join("\n"), /group is required/);
});

test("fork dialog submits selected session defaults", () => {
  let forked: { source: string; group: string; title: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { forkSession: (source, input) => { forked = { source, ...input }; } });
  view.handleInput("f");
  const rendered = view.render(120).join("\n");
  assert.match(rendered, /Fork session/);
  assert.match(rendered, /▎ group\s+default█/);
  assert.match(rendered, /title\s+api fork/);
  view.handleInput("\r");
  assert.deepEqual(forked, { source: "api", group: "default", title: "api fork" });
});

test("fork dialog tab cycles and edits title field", () => {
  let forked: { source: string; group: string; title: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { forkSession: (source, input) => { forked = { source, ...input }; } });
  view.handleInput("f");
  view.handleInput("\t");
  for (let i = 0; i < "api fork".length; i += 1) view.handleInput("\u007f");
  for (const char of "api-copy") view.handleInput(char);
  view.handleInput("\r");
  assert.deepEqual(forked, { source: "api", group: "default", title: "api-copy" });
});

test("fork dialog reports async action errors", async () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { forkSession: async () => { throw new Error("history is not saved yet"); } });
  view.handleInput("f");
  view.handleInput("\r");
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(view.render(120).join("\n"), /history is not saved yet/);
});

test("fork dialog blocks other registry writes while async action is pending", () => {
  let resolveFork: (() => void) | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { forkSession: () => new Promise<void>((resolve) => { resolveFork = resolve; }) });
  view.handleInput("f");
  view.handleInput("\r");
  view.handleInput("a");
  assert.equal(controller.snapshot().registry.sessions[0]?.acknowledgedAt, undefined);
  resolveFork?.();
});

test("skills picker toggles and applies with restart prompt", () => {
  let applied: Array<{ name: string; enabled: boolean }> | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    skills: () => [{ name: "repo-rules", enabled: false }],
    applySkills: (items) => { applied = items; },
  });
  view.handleInput("s");
  assert.match(view.render(100).join("\n"), /Skills/);
  view.handleInput(" ");
  view.handleInput("\r");
  assert.equal(applied?.[0]?.enabled, true);
  assert.match(view.render(100).join("\n"), /restart session to reload skills/);
});

test("picker apply reports async errors instead of success", async () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    skills: () => [{ name: "repo-rules", enabled: false }],
    applySkills: async () => { throw new Error("write failed"); },
  });
  view.handleInput("s");
  view.handleInput("\r");
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(view.render(100).join("\n"), /write failed/);
  assert.doesNotMatch(view.render(100).join("\n"), /restart session to reload skills/);
});

test("picker search supports cursor movement", () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    skills: () => [{ name: "api-tools", enabled: false }, { name: "docs-tools", enabled: false }],
  });

  view.handleInput("s");
  for (const char of "api") view.handleInput(char);
  view.handleInput("\u001b[D");
  view.handleInput("X");

  assert.match(view.render(100).join("\n"), /search: apX█i/);
});

test("picker search filters visible items before toggling", () => {
  let applied: Array<{ name: string; enabled: boolean }> | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    skills: () => [{ name: "api-tools", enabled: false }, { name: "docs-tools", enabled: false }],
    applySkills: (items) => { applied = items; },
  });
  view.handleInput("s");
  for (const char of "docs") view.handleInput(char);
  const rendered = view.render(100).join("\n");
  assert.match(rendered, /search: docs/);
  assert.match(rendered, /docs-tools/);
  assert.doesNotMatch(rendered, /api-tools/);
  view.handleInput(" ");
  view.handleInput("\r");
  assert.equal(applied?.find((item) => item.name === "docs-tools")?.enabled, true);
  assert.equal(applied?.find((item) => item.name === "api-tools")?.enabled, false);
});

test("picker search accepts j and k as text", () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    skills: () => [{ name: "jekyll", enabled: false }, { name: "docs", enabled: false }],
  });
  view.handleInput("s");
  for (const char of "jek") view.handleInput(char);
  const rendered = view.render(80).join("\n");
  assert.match(rendered, /search: jek/);
  assert.match(rendered, /jekyll/);
  assert.doesNotMatch(rendered, /docs/);
});

test("mcp picker toggles and applies with restart prompt", () => {
  let applied: Array<{ name: string; enabled: boolean }> | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    mcpServers: () => [{ name: "filesystem", enabled: false }],
    applyMcpServers: (items) => { applied = items; },
  });
  view.handleInput("m");
  assert.match(view.render(100).join("\n"), /MCP/);
  view.handleInput(" ");
  view.handleInput("\r");
  assert.equal(applied?.[0]?.enabled, true);
  assert.match(view.render(100).join("\n"), /restart session to reload MCP tools/);
});

test("empty picker shows nothing available and escape clears it", () => {
  const view = new SessionsView(new SessionsController(), () => {}, { skills: () => [] });
  view.handleInput("s");
  assert.match(view.render(100).join("\n"), /skills: nothing available/);
  view.handleInput("\u001b");
  assert.doesNotMatch(view.render(100).join("\n"), /skills: nothing available/);
});

test("themed footer messages keep terminal width", () => {
  const view = new SessionsView(new SessionsController(), () => {}, { skills: () => [] }, darkTheme);
  view.handleInput("s");
  for (const line of view.render(80)) assert.ok(stripAnsi(line).length <= 80, stripAnsi(line));
});

test("restart requires double uppercase R press", () => {
  const restarted: string[] = [];
  let now = 100;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { restart: (id) => restarted.push(id), now: () => now });
  view.handleInput("R");
  const rendered = view.render(100).join("\n");
  assert.match(rendered, /Restart session/);
  assert.match(rendered, /▶ press R again to restart api/);
  assert.deepEqual(restarted, []);
  now = 200;
  view.handleInput("R");
  assert.deepEqual(restarted, ["api"]);
});

test("stale restart confirmation clears on render", () => {
  let now = 100;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { now: () => now });
  view.handleInput("R");
  now = 2_200;
  assert.doesNotMatch(view.render(100).join("\n"), /press R again/);
});

test("escape cancels pending restart", () => {
  const restarted: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { restart: (id) => restarted.push(id), now: () => 100 });
  view.handleInput("R");
  view.handleInput("\u001b");
  view.handleInput("R");
  assert.deepEqual(restarted, []);
});

test("escape clearing filter also cancels hidden pending restart", () => {
  const restarted: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { restart: (id) => restarted.push(id), now: () => 100 });
  view.handleInput("/");
  view.handleInput("a");
  view.handleInput("\r");
  view.handleInput("R");
  view.handleInput("\u001b");
  view.handleInput("R");
  assert.deepEqual(restarted, []);
});

test("help, empty picker, and attach cancel pending restart", () => {
  const restarted: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { restart: (id) => restarted.push(id), now: () => 100, skills: () => [] });
  view.handleInput("R");
  view.handleInput("?");
  view.handleInput("\u001b");
  view.handleInput("R");
  assert.deepEqual(restarted, []);

  view.handleInput("\u001b");
  view.handleInput("R");
  view.handleInput("s");
  view.handleInput("R");
  assert.deepEqual(restarted, []);

  view.handleInput("\u001b");
  view.handleInput("R");
  view.handleInput("\r");
  view.handleInput("R");
  assert.deepEqual(restarted, []);
});

test("zero-match filter blocks selected actions", async () => {
  const restarted: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { restart: (id) => restarted.push(id) });
  view.handleInput("/");
  for (const char of "zzz") view.handleInput(char);
  assert.match(view.render(100).join("\n"), /No sessions match/);
  view.handleInput("\r");
  await controller.refresh();
  view.handleInput("R");
  view.handleInput("R");
  assert.deepEqual(restarted, []);
});

test("filter matching ignores parent cwd directories for action selection", async () => {
  const restarted: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [{ ...session("api", "api"), cwd: "/tmp/hidden-parent/api" }] });
  const view = new SessionsView(controller, () => {}, { restart: (id) => restarted.push(id) });
  view.handleInput("/");
  for (const char of "hidden") view.handleInput(char);
  assert.match(view.render(100).join("\n"), /No sessions match/);
  view.handleInput("\r");
  await controller.refresh();
  view.handleInput("R");
  view.handleInput("R");
  assert.deepEqual(restarted, []);
});

test("starting no-match filter clears stale attach message", () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
    const view = new SessionsView(controller, () => {});
    view.handleInput("\r");
    assert.match(view.render(100).join("\n"), /switch-client/);
    view.handleInput("/");
    for (const char of "zzz") view.handleInput(char);
    assert.doesNotMatch(view.render(100).join("\n"), /switch-client/);
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});
