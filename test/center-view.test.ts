import test from "node:test";
import assert from "node:assert/strict";
import { CenterController } from "../src/app/controller.js";
import { CenterView } from "../src/tui/center-view.js";
import { darkTheme, stripAnsi } from "../src/tui/theme.js";
import type { CenterSession } from "../src/core/types.js";

function session(id: string, title: string): CenterSession {
  return {
    id,
    title,
    cwd: `/tmp/${title}`,
    group: "default",
    tmuxSession: `pi-center-${id}`,
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
  };
}

test("filter mode filters live and escape clears", () => {
  const controller = new CenterController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new CenterView(controller, () => {});

  view.handleInput("/");
  view.handleInput("d");
  view.handleInput("o");
  assert.equal(controller.snapshot().filter, "do");
  assert.match(view.render(100).join("\n"), /docs/);
  assert.doesNotMatch(view.render(100).join("\n"), /api/);

  view.handleInput("\u001b");
  assert.equal(controller.snapshot().filter, undefined);
});

test("committed filter footer uses esc clear and escape clears", () => {
  const controller = new CenterController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new CenterView(controller, () => {});
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
  const view = new CenterView(new CenterController(), () => { stopped = true; });
  view.handleInput("q");
  assert.equal(stopped, true);
});

test("slash on empty state does not trap q in filter mode", () => {
  let stopped = false;
  const view = new CenterView(new CenterController(), () => { stopped = true; });
  view.handleInput("/");
  view.handleInput("q");
  assert.equal(stopped, true);
});

test("help overlay opens and closes", () => {
  const view = new CenterView(new CenterController(), () => {});
  view.handleInput("?");
  assert.match(view.render(80).join("\n"), /pi center help/);
  view.handleInput("\u001b");
  assert.doesNotMatch(view.render(80).join("\n"), /pi center help/);
});

test("q quits from help overlay", () => {
  let stopped = false;
  const view = new CenterView(new CenterController(), () => { stopped = true; });
  view.handleInput("?");
  view.handleInput("q");
  assert.equal(stopped, true);
});

test("enter triggers attach action outside tmux", () => {
  const oldTmux = process.env.TMUX;
  delete process.env.TMUX;
  try {
    let attached: string | undefined;
    const controller = new CenterController({ version: 1, sessions: [session("api", "api")] });
    const view = new CenterView(controller, () => {}, { attachOutsideTmux: (tmuxSession) => { attached = tmuxSession; } });
    view.handleInput("\r");
    assert.equal(attached, "pi-center-api");
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
    const controller = new CenterController({ version: 1, sessions: [session("api", "api")] });
    const view = new CenterView(controller, () => {}, {
      attachOutsideTmux: () => { throw new Error("outside attach should not run inside tmux"); },
      switchInsideTmux: (tmuxSession) => { switched = tmuxSession; },
      copy: (text) => { copied = text; },
    });

    view.handleInput("\r");

    assert.equal(switched, "pi-center-api");
    assert.equal(copied, "tmux switch-client -t pi-center-api");
    assert.match(view.render(100).join("\n"), /tmux switch-client -t pi-center-api/);
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("inside tmux switch action errors show in footer", async () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    const controller = new CenterController({ version: 1, sessions: [session("api", "api")] });
    const view = new CenterView(controller, () => {}, {
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

test("new dialog submits cwd group title", () => {
  let created: { cwd: string; group: string; title: string } | undefined;
  const view = new CenterView(new CenterController(), () => {}, { createSession: (input) => { created = input; } });
  view.handleInput("n");
  for (const char of "api") view.handleInput(char);
  const rendered = view.render(120).join("\n");
  assert.match(rendered, /New session/);
  assert.match(rendered, /cwd/);
  assert.match(rendered, /group/);
  assert.match(rendered, /title/);
  view.handleInput("\r");
  assert.equal(created?.cwd, process.cwd());
  assert.equal(created?.group, "default");
  assert.equal(created?.title, "api");
});

test("new dialog shows validation message and escape clears it", () => {
  const view = new CenterView(new CenterController(), () => {});
  view.handleInput("n");
  view.handleInput("\r");
  const invalid = view.render(120).join("\n");
  assert.match(invalid, /New session/);
  assert.match(invalid, /Required: cwd, group, and title/);
  view.handleInput("\u001b");
  assert.doesNotMatch(view.render(120).join("\n"), /Required: cwd/);
});

test("fork dialog submits selected session defaults", () => {
  let forked: { source: string; group: string; title: string } | undefined;
  const controller = new CenterController({ version: 1, sessions: [session("api", "api")] });
  const view = new CenterView(controller, () => {}, { forkSession: (source, input) => { forked = { source, ...input }; } });
  view.handleInput("f");
  assert.match(view.render(120).join("\n"), /Fork session/);
  view.handleInput("\r");
  assert.deepEqual(forked, { source: "api", group: "default", title: "api fork" });
});

test("skills picker toggles and applies with restart prompt", () => {
  let applied: Array<{ name: string; enabled: boolean }> | undefined;
  const view = new CenterView(new CenterController(), () => {}, {
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
  const view = new CenterView(new CenterController(), () => {}, {
    skills: () => [{ name: "repo-rules", enabled: false }],
    applySkills: async () => { throw new Error("write failed"); },
  });
  view.handleInput("s");
  view.handleInput("\r");
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(view.render(100).join("\n"), /write failed/);
  assert.doesNotMatch(view.render(100).join("\n"), /restart session to reload skills/);
});

test("picker search filters visible items before toggling", () => {
  let applied: Array<{ name: string; enabled: boolean }> | undefined;
  const view = new CenterView(new CenterController(), () => {}, {
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
  const view = new CenterView(new CenterController(), () => {}, {
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
  const view = new CenterView(new CenterController(), () => {}, {
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
  const view = new CenterView(new CenterController(), () => {}, { skills: () => [] });
  view.handleInput("s");
  assert.match(view.render(100).join("\n"), /skills: nothing available/);
  view.handleInput("\u001b");
  assert.doesNotMatch(view.render(100).join("\n"), /skills: nothing available/);
});

test("themed footer messages keep terminal width", () => {
  const view = new CenterView(new CenterController(), () => {}, { skills: () => [] }, darkTheme);
  view.handleInput("s");
  for (const line of view.render(80)) assert.ok(stripAnsi(line).length <= 80, stripAnsi(line));
});

test("restart requires double press", () => {
  const restarted: string[] = [];
  let now = 100;
  const controller = new CenterController({ version: 1, sessions: [session("api", "api")] });
  const view = new CenterView(controller, () => {}, { restart: (id) => restarted.push(id), now: () => now });
  view.handleInput("r");
  const rendered = view.render(100).join("\n");
  assert.match(rendered, /Restart session/);
  assert.match(rendered, /press r again to restart api/);
  assert.deepEqual(restarted, []);
  now = 200;
  view.handleInput("r");
  assert.deepEqual(restarted, ["api"]);
});

test("stale restart confirmation clears on render", () => {
  let now = 100;
  const controller = new CenterController({ version: 1, sessions: [session("api", "api")] });
  const view = new CenterView(controller, () => {}, { now: () => now });
  view.handleInput("r");
  now = 2_200;
  assert.doesNotMatch(view.render(100).join("\n"), /press r again/);
});

test("escape cancels pending restart", () => {
  const restarted: string[] = [];
  const controller = new CenterController({ version: 1, sessions: [session("api", "api")] });
  const view = new CenterView(controller, () => {}, { restart: (id) => restarted.push(id), now: () => 100 });
  view.handleInput("r");
  view.handleInput("\u001b");
  view.handleInput("r");
  assert.deepEqual(restarted, []);
});

test("escape clearing filter also cancels hidden pending restart", () => {
  const restarted: string[] = [];
  const controller = new CenterController({ version: 1, sessions: [session("api", "api")] });
  const view = new CenterView(controller, () => {}, { restart: (id) => restarted.push(id), now: () => 100 });
  view.handleInput("/");
  view.handleInput("a");
  view.handleInput("\r");
  view.handleInput("r");
  view.handleInput("\u001b");
  view.handleInput("r");
  assert.deepEqual(restarted, []);
});

test("help, empty picker, and attach cancel pending restart", () => {
  const restarted: string[] = [];
  const controller = new CenterController({ version: 1, sessions: [session("api", "api")] });
  const view = new CenterView(controller, () => {}, { restart: (id) => restarted.push(id), now: () => 100, skills: () => [] });
  view.handleInput("r");
  view.handleInput("?");
  view.handleInput("\u001b");
  view.handleInput("r");
  assert.deepEqual(restarted, []);

  view.handleInput("\u001b");
  view.handleInput("r");
  view.handleInput("s");
  view.handleInput("r");
  assert.deepEqual(restarted, []);

  view.handleInput("\u001b");
  view.handleInput("r");
  view.handleInput("\r");
  view.handleInput("r");
  assert.deepEqual(restarted, []);
});

test("zero-match filter blocks selected actions", async () => {
  const restarted: string[] = [];
  const controller = new CenterController({ version: 1, sessions: [session("api", "api")] });
  const view = new CenterView(controller, () => {}, { restart: (id) => restarted.push(id) });
  view.handleInput("/");
  for (const char of "zzz") view.handleInput(char);
  assert.match(view.render(100).join("\n"), /No sessions match/);
  view.handleInput("\r");
  await controller.refresh();
  view.handleInput("r");
  view.handleInput("r");
  assert.deepEqual(restarted, []);
});

test("filter matching ignores parent cwd directories for action selection", async () => {
  const restarted: string[] = [];
  const controller = new CenterController({ version: 1, sessions: [{ ...session("api", "api"), cwd: "/tmp/hidden-parent/api" }] });
  const view = new CenterView(controller, () => {}, { restart: (id) => restarted.push(id) });
  view.handleInput("/");
  for (const char of "hidden") view.handleInput(char);
  assert.match(view.render(100).join("\n"), /No sessions match/);
  view.handleInput("\r");
  await controller.refresh();
  view.handleInput("r");
  view.handleInput("r");
  assert.deepEqual(restarted, []);
});

test("starting no-match filter clears stale attach message", () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    const controller = new CenterController({ version: 1, sessions: [session("api", "api")] });
    const view = new CenterView(controller, () => {});
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
