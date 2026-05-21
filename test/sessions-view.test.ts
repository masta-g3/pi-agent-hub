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
    tmuxSession: `pi-agent-hub-${id}`,
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
  let now = 100;
  const view = new SessionsView(controller, () => {}, { now: () => now });

  view.handleInput("/");
  for (const char of "api") view.handleInput(char);
  view.handleInput("\u001b[D");
  view.handleInput("X");

  const rendered = view.render(100).join("\n");
  assert.match(rendered, /\u001b\[5m█\u001b\[25m/);
  assert.match(stripAnsi(rendered), /filter: apX█i/);
  now = 1_100;
  assert.match(view.render(100).join("\n"), /\u001b\[5m▌\u001b\[25m/);
  assert.equal(controller.snapshot().filter, "apXi");
});

test("committed filter moves to top summary and escape clears", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {});
  view.handleInput("/");
  view.handleInput("d");
  view.handleInput("o");
  view.handleInput("\r");
  const rendered = view.render(100).join("\n");
  assert.match(rendered, /1\/2 sessions .* filter: do/);
  assert.match(rendered, /\? Help/);
  assert.doesNotMatch(rendered, /enter done/);
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
  const help = view.render(80).join("\n");
  assert.match(help, /pi agent hub help/);
  assert.match(help, /Status legend/);
  assert.match(help, /Ctrl\+Q/);
  assert.match(help, /Alt\+R/);
  assert.match(help, /i toggle/);
  assert.match(help, /p send/);
  assert.match(help, /zero counts are hidden/);
  view.handleInput("\u001b");
  assert.doesNotMatch(view.render(80).join("\n"), /pi agent hub help/);
});

test("q quits from help overlay", () => {
  let stopped = false;
  const view = new SessionsView(new SessionsController(), () => { stopped = true; });
  view.handleInput("?");
  view.handleInput("q");
  assert.equal(stopped, true);
});


test("help overlay stays within terminal width", () => {
  const view = new SessionsView(new SessionsController(), () => {});
  view.handleInput("?");
  for (const width of [40, 80]) {
    for (const line of view.render(width)) assert.ok(stripAnsi(line).length <= width, stripAnsi(line));
  }
});

test("J K and shift arrows reorder selected session", () => {
  const deltas: number[] = [];
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] }), () => {}, {
    reorderSelected: (delta) => { deltas.push(delta); },
  });

  view.handleInput("J");
  view.handleInput("K");
  view.handleInput("\u001b[b");
  view.handleInput("\u001b[a");

  assert.deepEqual(deltas, [1, -1, 1, -1]);
});

test("shift N syncs selected session title from Pi name", async () => {
  const synced: string[] = [];
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    syncPiName: (sessionId) => {
      synced.push(sessionId);
      return Promise.resolve({ status: "synced", name: "Pi Name" });
    },
  });

  view.handleInput("N");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(synced, ["api"]);
  assert.match(stripAnsi(view.render(100).join("\n")), /renamed from Pi name: Pi Name/);
});

test("shift N reports when the selected session has no Pi name", async () => {
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    syncPiName: () => Promise.resolve({ status: "unnamed" }),
  });

  view.handleInput("N");
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(stripAnsi(view.render(100).join("\n")), /no Pi name set/);
});

test("reorder is disabled while filter is active", () => {
  const deltas: number[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, {
    reorderSelected: (delta) => { deltas.push(delta); },
  });

  view.handleInput("/");
  view.handleInput("a");
  view.handleInput("\r");
  view.handleInput("J");

  assert.deepEqual(deltas, []);
  assert.match(view.render(100).join("\n"), /clear filter to reorder/);
});

test("enter triggers attach action outside tmux", () => {
  const oldTmux = process.env.TMUX;
  delete process.env.TMUX;
  try {
    let attached: string | undefined;
    const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
    const view = new SessionsView(controller, () => {}, { attachOutsideTmux: (tmuxSession) => { attached = tmuxSession; } });
    view.handleInput("\r");
    assert.equal(attached, "pi-agent-hub-api");
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("enter inside tmux flashes switch command then restores footer without touching clipboard", () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    let now = 100;
    let switched: string | undefined;
    let copied: string | undefined;
    const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
    const view = new SessionsView(controller, () => {}, {
      attachOutsideTmux: () => { throw new Error("outside attach should not run inside tmux"); },
      switchInsideTmux: (tmuxSession) => { switched = tmuxSession; },
      copy: (text) => { copied = text; },
      now: () => now,
    });

    view.handleInput("\r");

    assert.equal(switched, "pi-agent-hub-api");
    assert.equal(copied, undefined);
    assert.match(view.render(100).join("\n"), /tmux switch-client -t pi-agent-hub-api/);
    now = 1_700;
    const rendered = view.render(100).join("\n");
    assert.doesNotMatch(rendered, /tmux switch-client -t pi-agent-hub-api/);
    assert.match(rendered, /Enter Open .* i Info .* \? Help/);
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("enter on waiting session marks read before switching inside tmux", async () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    let resolveAcknowledge: (() => void) | undefined;
    const events: string[] = [];
    const waiting = { ...session("api", "api"), status: "waiting" as const };
    const controller = new SessionsController({ version: 1, sessions: [waiting] });
    const view = new SessionsView(controller, () => {}, {
      acknowledge: () => new Promise<void>((resolve) => {
        events.push("acknowledge");
        resolveAcknowledge = resolve;
      }),
      switchInsideTmux: (tmuxSession) => { events.push(`switch:${tmuxSession}`); },
    });

    view.handleInput("\r");

    assert.deepEqual(events, ["acknowledge"]);
    resolveAcknowledge?.();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(events, ["acknowledge", "switch:pi-agent-hub-api"]);
    const rendered = stripAnsi(view.render(100).join("\n"));
    assert.doesNotMatch(rendered, /marking read/);
    assert.match(rendered, /tmux switch-client -t pi-agent-hub-api/);
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("external rename action selects the target session and opens rename dialog", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {});

  controller.move(1);

  assert.equal(view.openRenameForTmuxSession("pi-agent-hub-api"), true);
  const rendered = stripAnsi(view.render(100).join("\n"));

  assert.equal(controller.selected()?.id, "api");
  assert.match(rendered, /Rename session/);
  assert.match(rendered, /api/);
  assert.doesNotMatch(rendered, /rename api:/);
});

test("external rename action switches back to the session after rename", async () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    let resolveRename: (() => void) | undefined;
    const events: string[] = [];
    const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
    const view = new SessionsView(controller, () => {}, {
      renameSession: (id, title) => new Promise<void>((resolve) => {
        events.push(`rename:${id}:${title}`);
        resolveRename = resolve;
      }),
      switchInsideTmux: (tmuxSession) => { events.push(`switch:${tmuxSession}`); },
    });

    assert.equal(view.openRenameForTmuxSession("pi-agent-hub-api"), true);
    view.handleInput(" ");
    view.handleInput("v");
    view.handleInput("2");
    view.handleInput("\r");

    assert.deepEqual(events, ["rename:api:api v2"]);
    resolveRename?.();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(events, ["rename:api:api v2", "switch:pi-agent-hub-api"]);
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("inside tmux switch action errors show in footer", async () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    let now = 100;
    const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
    const view = new SessionsView(controller, () => {}, {
      switchInsideTmux: async () => { throw new Error("switch failed"); },
      now: () => now,
    });

    view.handleInput("\r");
    await new Promise((resolve) => setImmediate(resolve));
    now = 2_000;

    assert.match(view.render(100).join("\n"), /switch failed: switch failed/);
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("enter on stopped session restarts instead of switching to missing tmux session", async () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    const stopped = { ...session("api", "api"), status: "stopped" as const };
    const restarted: string[] = [];
    const switched: string[] = [];
    const controller = new SessionsController({ version: 1, sessions: [stopped] });
    const view = new SessionsView(controller, () => {}, {
      restart: async (id) => { restarted.push(id); },
      switchInsideTmux: (tmuxSession) => { switched.push(tmuxSession); },
    });

    view.handleInput("\r");
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(restarted, ["api"]);
    assert.deepEqual(switched, []);
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("enter on stopped session without restart action explains the recovery key", () => {
  const controller = new SessionsController({ version: 1, sessions: [{ ...session("api", "api"), status: "stopped" }] });
  const view = new SessionsView(controller, () => {});

  view.handleInput("\r");

  assert.match(view.render(100).join("\n"), /session stopped; press R twice to restart/);
});

test("new form submits with basename group and random title on enter", () => {
  let created: { cwd: string; group: string; title: string } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", titleGenerator: () => "black-aleph" }),
  });
  view.handleInput("n");
  const rendered = view.render(120).join("\n");
  assert.match(rendered, /New session/);
  assert.match(rendered, /repos/);
  assert.match(rendered, /★ primary/);
  assert.doesNotMatch(rendered, /repo 2/);
  assert.doesNotMatch(rendered, /repo 3/);
  assert.match(rendered, /worktree\s+off · ctrl-t to enable/);
  assert.match(rendered, /group/);
  assert.match(rendered, /title/);
  assert.match(rendered, /black-aleph/);
  view.handleInput("\r");
  assert.deepEqual(created, { cwd: "/tmp/api", group: "api", title: "black-aleph" });
});

test("new form tab cycles focus and edits title", () => {
  let created: { cwd: string; group: string; title: string } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", titleGenerator: () => "api" }),
  });
  view.handleInput("n");
  view.handleInput("\t");
  view.handleInput("\t");
  for (const char of "-prod") view.handleInput(char);
  view.handleInput("\r");
  assert.deepEqual(created, { cwd: "/tmp/api", group: "api", title: "api-prod" });
});

test("new form worktree toggle uses branch as session title", () => {
  let created: { cwd: string; group: string; title: string; worktree?: { branch: string } } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", titleGenerator: () => "api" }),
  });
  view.handleInput("n");
  view.handleInput("\u0014");
  const rendered = view.render(120).join("\n");
  assert.match(rendered, /worktree\s+on · ctrl-t to disable/);
  assert.match(rendered, /branch/);
  assert.doesNotMatch(rendered, /title/);
  for (let i = 0; i < "api".length; i += 1) view.handleInput("\u007f");
  for (const char of "feature/api") view.handleInput(char);
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/api", group: "api", title: "feature/api", worktree: { branch: "feature/api" } });
});

test("new form worktree toggle can turn off without crashing", () => {
  let created: { cwd: string; group: string; title: string; worktree?: { branch: string } } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", titleGenerator: () => "api" }),
  });
  view.handleInput("n");
  view.handleInput("\u0014");
  view.handleInput("\u0014");
  const rendered = view.render(120).join("\n");
  assert.match(rendered, /worktree\s+off · ctrl-t to enable/);
  assert.match(rendered, /title/);
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/api", group: "api", title: "api" });
});

test("new form worktree mode defaults branch from generated title", () => {
  let created: { cwd: string; group: string; title: string; worktree?: { branch: string } } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", titleGenerator: () => "api-work" }),
  });
  view.handleInput("n");
  view.handleInput("\u0014");
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/api", group: "api", title: "api-work", worktree: { branch: "api-work" } });
});

test("new form worktree mode rejects additional repos", () => {
  let created: unknown;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", titleGenerator: () => "api" }),
  });
  view.handleInput("n");
  view.handleInput("\u001ba");
  for (const char of "/tmp/web") view.handleInput(char);
  view.handleInput("\u0014");
  for (const char of "feature/api") view.handleInput(char);
  view.handleInput("\r");

  assert.equal(created, undefined);
  assert.match(view.render(120).join("\n"), /one primary repo/);
});

test("new form add repo shortcut submits one additional cwd", () => {
  let created: { cwd: string; group: string; title: string; additionalCwds?: string[] } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", titleGenerator: () => "api" }),
  });
  view.handleInput("n");
  view.handleInput("\u001ba");
  assert.match(view.render(120).join("\n"), /\+ repo/);
  for (const char of "/tmp/web") view.handleInput(char);
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/api", group: "api", title: "api", additionalCwds: ["/tmp/web"] });
});

test("new form add repo shortcut supports more than two additional cwds", () => {
  let created: { cwd: string; group: string; title: string; additionalCwds?: string[] } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", titleGenerator: () => "api" }),
  });
  view.handleInput("n");
  for (const repo of ["/tmp/web", "/tmp/shared", "/tmp/docs"]) {
    view.handleInput("\u001ba");
    for (const char of repo) view.handleInput(char);
  }
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/api", group: "api", title: "api", additionalCwds: ["/tmp/web", "/tmp/shared", "/tmp/docs"] });
});

test("new form remove shortcut removes focused extra repo and omits blank rows", () => {
  let created: { cwd: string; group: string; title: string; additionalCwds?: string[] } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", titleGenerator: () => "api" }),
  });
  view.handleInput("n");
  view.handleInput("\u001ba");
  for (const char of "/tmp/web") view.handleInput(char);
  view.handleInput("\u001ba");
  view.handleInput("\u001bx");
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/api", group: "api", title: "api", additionalCwds: ["/tmp/web"] });
});

test("new form remove shortcut is a no-op on primary repo", () => {
  let created: { cwd: string; group: string; title: string; additionalCwds?: string[] } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", titleGenerator: () => "api" }),
  });
  view.handleInput("n");
  view.handleInput("\u001bx");
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/api", group: "api", title: "api" });
});

test("new form can default to selected session cwd, group, and all additional repos", () => {
  let created: { cwd: string; group: string; title: string; additionalCwds?: string[] } | undefined;
  const controller = new SessionsController({
    version: 1,
    sessions: [{ ...session("api", "api"), cwd: "/repo/api", group: "backend", additionalCwds: ["/repo/web", "/repo/shared", "/repo/docs"] }],
  });
  const view = new SessionsView(controller, () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => {
      const selected = controller.selected();
      return {
        cwd: selected?.cwd ?? "/dashboard",
        group: selected?.group,
        knownCwds: ["/dashboard", "/repo/api", "/repo/web", "/repo/shared", "/repo/docs"],
        additionalCwds: selected?.additionalCwds,
        titleGenerator: () => "api",
      };
    },
  });
  view.handleInput("n");
  const rendered = view.render(120).join("\n");
  assert.match(rendered, /\/repo\/api/);
  assert.match(rendered, /\/repo\/web/);
  assert.match(rendered, /\/repo\/shared/);
  assert.match(rendered, /\/repo\/docs/);
  assert.match(rendered, /backend/);
  view.handleInput("\r");
  assert.deepEqual(created, { cwd: "/repo/api", group: "backend", title: "api", additionalCwds: ["/repo/web", "/repo/shared", "/repo/docs"] });
});

test("new form per-field validation focuses first invalid field on enter", () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    newFormContext: () => ({ cwd: "/tmp/api", titleGenerator: () => "api" }),
  });
  view.handleInput("n");
  for (let i = 0; i < "/tmp/api".length; i += 1) view.handleInput("\u007f");
  view.handleInput("\r");
  const invalid = view.render(120).join("\n");
  assert.match(invalid, /New session/);
  assert.match(invalid, /primary is required/);
  view.handleInput("\u001b");
  assert.doesNotMatch(view.render(120).join("\n"), /primary is required/);
});

test("new form ctrl-n cycles primary cwd suggestions and updates group only", () => {
  let created: { cwd: string; group: string; title: string } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", knownCwds: ["/tmp/web", "/tmp/api"], titleGenerator: () => "api" }),
  });
  view.handleInput("n");
  view.handleInput("\u000e");
  const rendered = view.render(120).join("\n");
  assert.match(rendered, /\/tmp\/web/);
  assert.match(rendered, /web/);
  view.handleInput("\r");
  assert.deepEqual(created, { cwd: "/tmp/web", group: "web", title: "api" });
});

test("new form ctrl-n cycles cwd suggestions on extra repo fields", () => {
  let created: { cwd: string; group: string; title: string; additionalCwds?: string[] } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", knownCwds: ["/tmp/api", "/tmp/web"], titleGenerator: () => "api" }),
  });
  view.handleInput("n");
  view.handleInput("\u001ba");
  view.handleInput("\u000e");
  view.handleInput("\u000e");
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/api", group: "api", title: "api", additionalCwds: ["/tmp/web"] });
});

test("new form repo picker selects primary cwd and updates group", () => {
  let created: { cwd: string; group: string; title: string } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", knownCwds: ["/tmp/api", "/tmp/web-client"], titleGenerator: () => "api" }),
  });
  view.handleInput("n");
  view.handleInput("\u000f");
  assert.match(view.render(120).join("\n"), /Recent repos/);
  for (const char of "client") view.handleInput(char);
  view.handleInput("\r");
  assert.match(view.render(120).join("\n"), /\/tmp\/web-client/);
  assert.match(view.render(120).join("\n"), /web-client/);
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/web-client", group: "web-client", title: "api" });
});

test("new form repo picker selects extra repo without changing group", () => {
  let created: { cwd: string; group: string; title: string; additionalCwds?: string[] } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", knownCwds: ["/tmp/api", "/tmp/web"], titleGenerator: () => "api" }),
  });
  view.handleInput("n");
  view.handleInput("\u001ba");
  view.handleInput("\u000f");
  for (const char of "web") view.handleInput(char);
  view.handleInput("\r");
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/api", group: "api", title: "api", additionalCwds: ["/tmp/web"] });
});

test("new form repo picker escape preserves form state", () => {
  let created: { cwd: string; group: string; title: string } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", knownCwds: ["/tmp/api", "/tmp/web"], titleGenerator: () => "api" }),
  });
  view.handleInput("n");
  view.handleInput("\u000f");
  for (const char of "web") view.handleInput(char);
  view.handleInput("\u001b");
  assert.match(view.render(120).join("\n"), /New session/);
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/api", group: "api", title: "api" });
});

test("new form repo picker enter with no match stays open", () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    newFormContext: () => ({ cwd: "/tmp/api", knownCwds: ["/tmp/api", "/tmp/web"], titleGenerator: () => "api" }),
  });
  view.handleInput("n");
  view.handleInput("\u000f");
  for (const char of "zzz") view.handleInput(char);
  view.handleInput("\r");

  const rendered = view.render(120).join("\n");
  assert.match(rendered, /Recent repos/);
  assert.match(rendered, /No repos match/);
});

test("new form ctrl-o outside repo fields is a no-op", () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    newFormContext: () => ({ cwd: "/tmp/api", knownCwds: ["/tmp/api", "/tmp/web"], titleGenerator: () => "api" }),
  });
  view.handleInput("n");
  view.handleInput("\t");
  view.handleInput("\u000f");

  assert.match(view.render(120).join("\n"), /New session/);
  assert.doesNotMatch(view.render(120).join("\n"), /Recent repos/);
});

test("new form printable a and x edit text instead of adding or removing repos", () => {
  let created: { cwd: string; group: string; title: string; additionalCwds?: string[] } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", titleGenerator: () => "api" }),
  });
  view.handleInput("n");
  view.handleInput("\t");
  view.handleInput("\t");
  view.handleInput("x");
  view.handleInput("a");
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/api", group: "api", title: "apixa" });
});

test("new form preserves user-edited title across cwd changes", () => {
  let created: { cwd: string; group: string; title: string } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", knownCwds: ["/tmp/api", "/tmp/web"], titleGenerator: () => "api" }),
  });
  view.handleInput("n");
  view.handleInput("\t");
  view.handleInput("\t");
  for (let i = 0; i < "api".length; i += 1) view.handleInput("\u007f");
  for (const char of "manual") view.handleInput(char);
  view.handleInput("\t");
  view.handleInput("\u000e");
  view.handleInput("\r");
  assert.deepEqual(created, { cwd: "/tmp/web", group: "web", title: "manual" });
});

test("new form preserves user-edited group across cwd changes", () => {
  let created: { cwd: string; group: string; title: string } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", knownCwds: ["/tmp/api", "/tmp/web"], titleGenerator: () => "api" }),
  });
  view.handleInput("n");
  view.handleInput("\t");
  for (let i = 0; i < "api".length; i += 1) view.handleInput("\u007f");
  for (const char of "backend") view.handleInput(char);
  view.handleInput("\t");
  view.handleInput("\t");
  view.handleInput("\u000e");
  view.handleInput("\r");
  assert.deepEqual(created, { cwd: "/tmp/web", group: "backend", title: "api" });
});

test("selected session surfaces cached skill count", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { skillCount: (cwd) => cwd === "/tmp/api" ? 2 : undefined });

  assert.match(view.render(120).join("\n"), /skills 2\s+s\/m edit/);
});


test("i toggles selected session metadata expansion", () => {
  const controller = new SessionsController({
    version: 1,
    sessions: [{
      ...session("api", "api"),
      cwd: "/repo/api",
      additionalCwds: ["/repo/web"],
      workspaceCwd: "/state/workspaces/api",
    }],
  });
  const view = new SessionsView(controller, () => {});

  const compact = view.render(120).join("\n");
  assert.match(compact, /\/repo\/api · 2 repos/);
  assert.doesNotMatch(compact, /group default/);
  assert.doesNotMatch(compact, /extra\s+\/repo\/web/);

  view.handleInput("i");
  const expanded = view.render(120).join("\n");
  assert.match(expanded, /extra\s+\/repo\/web/);
  assert.match(expanded, /runtime\s+\/state\/workspaces\/api/);

  view.handleInput("i");
  assert.doesNotMatch(view.render(120).join("\n"), /extra\s+\/repo\/web/);
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

test("delete dialog offers subagent-only cleanup for parent sessions", () => {
  let closed: string | undefined;
  let deleted: string | undefined;
  const parent = session("api", "api");
  const child = { ...session("child", "smoke"), kind: "subagent" as const, parentId: parent.id, agentName: "smoke" };
  const controller = new SessionsController({ version: 1, sessions: [parent, child] });
  const view = new SessionsView(controller, () => {}, {
    closeSubagents: (id) => { closed = id; },
    deleteSession: (id) => { deleted = id; },
  });

  view.handleInput("d");
  const rendered = view.render(100).join("\n");
  assert.match(rendered, /1 subagent/);
  assert.match(rendered, /s\s+close subagents only/);
  assert.match(rendered, /d\s+delete session \+ subagents/);
  view.handleInput("s");

  assert.equal(closed, "api");
  assert.equal(deleted, undefined);
  assert.doesNotMatch(view.render(100).join("\n"), /Delete session/);
});

test("delete dialog keeps full delete on d confirmation", () => {
  let closed: string | undefined;
  let deleted: string | undefined;
  const parent = session("api", "api");
  const child = { ...session("child", "smoke"), kind: "subagent" as const, parentId: parent.id, agentName: "smoke" };
  const controller = new SessionsController({ version: 1, sessions: [parent, child] });
  const view = new SessionsView(controller, () => {}, {
    closeSubagents: (id) => { closed = id; },
    deleteSession: (id) => { deleted = id; },
  });

  view.handleInput("d");
  view.handleInput("d");

  assert.equal(deleted, "api");
  assert.equal(closed, undefined);
});

test("delete dialog does not offer subagent-only cleanup for selected subagent", () => {
  const parent = session("api", "api");
  const child = { ...session("child", "smoke"), kind: "subagent" as const, parentId: parent.id, agentName: "smoke" };
  const controller = new SessionsController({ version: 1, sessions: [parent, child] });
  const view = new SessionsView(controller, () => {}, { closeSubagents: () => {} });

  controller.move(1);
  view.handleInput("d");
  const rendered = view.render(100).join("\n");

  assert.match(rendered, /target\s+smoke/);
  assert.doesNotMatch(rendered, /close subagents only/);
});

test("delete dialog distinguishes forgetting and discarding worktree sessions", () => {
  let deleted: string | undefined;
  let discarded: string | undefined;
  const controller = new SessionsController({ version: 1, sessions: [{
    ...session("api", "api"),
    worktreePath: "/hub/worktrees/api/api-feature",
    worktreeRepoRoot: "/repo/api",
    worktreeBranch: "feature/api",
    worktreeBaseBranch: "main",
    worktreeOwnedByHub: true,
  }] });
  const view = new SessionsView(controller, () => {}, {
    deleteSession: (id) => { deleted = id; },
    discardWorktree: (id) => { discarded = id; },
  });

  view.handleInput("d");
  const rendered = view.render(100).join("\n");

  assert.match(rendered, /d\s+forget dashboard row only/);
  assert.match(rendered, /keeps worktree and branch/);
  assert.match(rendered, /D\s+discard worktree and branch/);
  assert.match(rendered, /w\s+finish instead/);

  view.handleInput("d");
  assert.equal(deleted, "api");
  assert.equal(discarded, undefined);
});

test("delete dialog shift D discards worktree session", () => {
  let deleted: string | undefined;
  let discarded: string | undefined;
  const controller = new SessionsController({ version: 1, sessions: [{
    ...session("api", "api"),
    worktreePath: "/hub/worktrees/api/api-feature",
    worktreeRepoRoot: "/repo/api",
    worktreeBranch: "feature/api",
    worktreeBaseBranch: "main",
    worktreeOwnedByHub: true,
  }] });
  const view = new SessionsView(controller, () => {}, {
    deleteSession: (id) => { deleted = id; },
    discardWorktree: (id) => { discarded = id; },
  });

  view.handleInput("d");
  view.handleInput("D");

  assert.equal(deleted, undefined);
  assert.equal(discarded, "api");
  assert.doesNotMatch(view.render(100).join("\n"), /Delete session/);
});

test("finish worktree dialog confirms with second w", () => {
  let finished: string | undefined;
  const controller = new SessionsController({ version: 1, sessions: [{
    ...session("api", "api"),
    worktreePath: "/hub/worktrees/api/api-feature",
    worktreeRepoRoot: "/repo/api",
    worktreeBranch: "feature/api",
    worktreeBaseBranch: "main",
    worktreeOwnedByHub: true,
  }] });
  const view = new SessionsView(controller, () => {}, { finishWorktree: (id) => { finished = id; } });

  view.handleInput("w");
  const rendered = view.render(100).join("\n");
  assert.match(rendered, /Finish worktree/);
  assert.match(rendered, /feature\/api → main/);
  assert.match(rendered, /press w again to finish/);
  view.handleInput("w");

  assert.equal(finished, "api");
  assert.doesNotMatch(view.render(100).join("\n"), /Finish worktree/);
});

test("finish worktree key ignores non-worktree sessions", () => {
  let finished: string | undefined;
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    finishWorktree: (id) => { finished = id; },
  });

  view.handleInput("w");

  assert.equal(finished, undefined);
  assert.match(view.render(100).join("\n"), /selected session is not a worktree/);
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

test("r opens footer rename prompt for selected session title", () => {
  let renamed: { id: string; title: string } | undefined;
  let now = 100;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    renameSession: (id, title) => { renamed = { id, title }; },
    now: () => now,
  });

  view.handleInput("r");
  const rendered = view.render(100).join("\n");
  assert.match(rendered, /\u001b\[5m█\u001b\[25m/);
  assert.match(stripAnsi(rendered), /rename api: api█/);
  assert.doesNotMatch(stripAnsi(rendered), /Rename session/);
  now = 1_100;
  assert.match(view.render(100).join("\n"), /\u001b\[5m▌\u001b\[25m/);
  for (let i = 0; i < "api".length; i += 1) view.handleInput("\u007f");
  for (const char of "backend") view.handleInput(char);
  view.handleInput("\r");

  assert.deepEqual(renamed, { id: "api", title: "backend" });
  assert.doesNotMatch(view.render(100).join("\n"), /rename api:/);
});

test("footer rename prompt supports cursor movement and mid-line editing", () => {
  let renamed: { id: string; title: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { renameSession: (id, title) => { renamed = { id, title }; } });

  view.handleInput("r");
  view.handleInput("\u001b[D");
  view.handleInput("X");
  assert.match(stripAnsi(view.render(100).join("\n")), /apX[█▌]i/);
  view.handleInput("\r");

  assert.deepEqual(renamed, { id: "api", title: "apXi" });
});

test("footer rename prompt supports word movement and word backspace", () => {
  let renamed: { id: string; title: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "alpha beta gamma")] });
  const view = new SessionsView(controller, () => {}, { renameSession: (id, title) => { renamed = { id, title }; } });

  view.handleInput("r");
  view.handleInput("\u001b[1;5D");
  view.handleInput("\u0017");
  view.handleInput("\r");

  assert.deepEqual(renamed, { id: "api", title: "alpha gamma" });
});

test("footer rename prompt validates blank title", () => {
  let renamed: { id: string; title: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { renameSession: (id, title) => { renamed = { id, title }; } });

  view.handleInput("r");
  for (let i = 0; i < "api".length; i += 1) view.handleInput("\u007f");
  view.handleInput("\r");

  assert.equal(renamed, undefined);
  assert.match(view.render(100).join("\n"), /title is required/);
});

test("p opens footer send prompt and submits message to selected live session", async () => {
  const sent: Array<{ tmuxSession: string; message: string }> = [];
  let now = 100;
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    sendMessage: async (tmuxSession, message) => { sent.push({ tmuxSession, message }); },
    now: () => now,
  });

  view.handleInput("p");
  const rawPrompt = view.render(100).join("\n");
  assert.match(rawPrompt, /\u001b\[5m█\u001b\[25m/);
  const prompt = stripAnsi(rawPrompt);
  assert.match(prompt, /pi agent hub/);
  assert.match(prompt, /▶ . api/);
  assert.match(prompt, /send to api: █/);
  assert.doesNotMatch(prompt, /Send to api/);
  now = 1_100;
  assert.match(view.render(100).join("\n"), /\u001b\[5m▌\u001b\[25m/);
  for (const char of "fix it") view.handleInput(char);
  view.handleInput("\r");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(sent, [{ tmuxSession: "pi-agent-hub-api", message: "fix it" }]);
  assert.match(stripAnsi(view.render(100).join("\n")), /sent → api/);
  now = 3_000;
  assert.doesNotMatch(stripAnsi(view.render(100).join("\n")), /sent → api/);
});

test("themed footer text remains styled when input is truncated", () => {
  const theme = { ...darkTheme, dim: "#010203", border: "#040506" };
  const cases = [
    { key: "r", expected: "rename api:" },
    { key: "p", expected: "send to api:" },
  ];

  for (const { key, expected } of cases) {
    const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
      sendMessage: () => {},
    }, theme);
    view.handleInput(key);
    for (const char of "界".repeat(52)) view.handleInput(char);

    const footer = view.render(50).at(-2) ?? "";
    assert.match(footer, /\u001b\[38;2;1;2;3m/);
    assert.match(stripAnsi(footer), new RegExp(`${expected}.*…`));
    assert.ok(stripAnsi(footer).length <= 50, stripAnsi(footer));
  }
});

test("footer send prompt validates blank message and escape cancels", () => {
  const sent: string[] = [];
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    sendMessage: (_tmuxSession, message) => { sent.push(message); },
  });

  view.handleInput("p");
  view.handleInput("\r");
  assert.match(stripAnsi(view.render(100).join("\n")), /message is required/);
  view.handleInput("\u001b");

  assert.deepEqual(sent, []);
  assert.doesNotMatch(stripAnsi(view.render(100).join("\n")), /send to api/);
});

test("send shortcut blocks subagent stopped and error rows", () => {
  const blockedSessions: ManagedSession[] = [
    { ...session("child", "child"), kind: "subagent", parentId: "missing", agentName: "scout" },
    { ...session("stopped", "stopped"), status: "stopped" },
    { ...session("error", "error"), status: "error" },
  ];
  const messages: RegExp[] = [/subagent rows cannot receive input/, /session is not live/, /session is not live/];

  for (let i = 0; i < blockedSessions.length; i += 1) {
    let called = false;
    const view = new SessionsView(new SessionsController({ version: 1, sessions: [blockedSessions[i]!] }), () => {}, {
      sendMessage: () => { called = true; },
    });
    view.handleInput("p");
    assert.equal(called, false);
    assert.match(stripAnsi(view.render(100).join("\n")), messages[i]!);
  }
});

test("send shortcut allows all live statuses", () => {
  for (const status of ["starting", "running", "waiting", "idle"] as const) {
    const view = new SessionsView(new SessionsController({ version: 1, sessions: [{ ...session(status, status), status }] }), () => {}, {
      sendMessage: () => {},
    });
    view.handleInput("p");
    assert.match(stripAnsi(view.render(100).join("\n")), new RegExp(`send to ${status}:`));
  }
});

test("send shortcut reports unavailable without a transport action", () => {
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {});

  view.handleInput("p");

  assert.match(stripAnsi(view.render(100).join("\n")), /send unavailable/);
  assert.doesNotMatch(stripAnsi(view.render(100).join("\n")), /send to api/);
});

test("send action errors show in footer", async () => {
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    sendMessage: async () => { throw new Error("send failed"); },
  });

  view.handleInput("p");
  view.handleInput("h");
  view.handleInput("\r");
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(stripAnsi(view.render(100).join("\n")), /send failed/);
});

test("e remains a rename alias", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {});

  view.handleInput("e");

  assert.match(stripAnsi(view.render(100).join("\n")), /rename api: api/);
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

test("async skills picker loads before rendering", async () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    skills: async () => [{ name: "repo-rules", enabled: false }],
  });
  view.handleInput("s");
  assert.match(view.render(100).join("\n"), /loading skills/);

  await new Promise((resolve) => setImmediate(resolve));

  assert.match(view.render(100).join("\n"), /Skills/);
  assert.match(view.render(100).join("\n"), /repo-rules/);
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

test("picker search accepts j k and e as text", () => {
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

test("skills picker displays pool dir and saves edited pool", async () => {
  let saved: string | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    skills: () => [{ name: "old-skill", enabled: false }],
    skillPoolDir: () => "",
    saveSkillPoolDir: async (dir) => {
      saved = dir;
      return [{ name: "new-skill", enabled: false }];
    },
  });

  view.handleInput("s");
  view.handleInput("\x1be");
  for (const char of "/tmp/new-skills") view.handleInput(char);
  view.handleInput("\r");
  await new Promise((resolve) => setImmediate(resolve));

  const rendered = view.render(100).join("\n");
  assert.equal(saved, "/tmp/new-skills");
  assert.match(rendered, /pool: \/tmp\/new-skills/);
  assert.match(rendered, /new-skill/);
  assert.match(rendered, /skill pool saved/);
  assert.doesNotMatch(rendered, /old-skill/);
});

test("skills picker rejects blank pool dir without saving", () => {
  let called = false;
  const view = new SessionsView(new SessionsController(), () => {}, {
    skills: () => [{ name: "repo-rules", enabled: false }],
    skillPoolDir: () => "   ",
    saveSkillPoolDir: () => { called = true; return []; },
  });

  view.handleInput("s");
  view.handleInput("\x1be");
  view.handleInput("\r");

  assert.equal(called, false);
  assert.match(view.render(100).join("\n"), /skill pool dir cannot be blank/);
});

test("escape during skill pool edit keeps picker open", () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    skills: () => [{ name: "repo-rules", enabled: false }],
    skillPoolDir: () => "/tmp/skills",
  });

  view.handleInput("s");
  view.handleInput("\x1be");
  view.handleInput("\u001b");

  const rendered = view.render(100).join("\n");
  assert.match(rendered, /Skills/);
  assert.match(rendered, /pool: \/tmp\/skills/);
});

test("empty skills picker still opens when pool dir can be edited", () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    skills: () => [],
    skillPoolDir: () => "/tmp/skills",
  });

  view.handleInput("s");

  const rendered = view.render(100).join("\n");
  assert.match(rendered, /Skills/);
  assert.match(rendered, /pool: \/tmp\/skills/);
  assert.match(rendered, /No items match/);
});

test("mcp picker does not edit skill pool", () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    mcpServers: () => [{ name: "filesystem", enabled: false }],
    skillPoolDir: () => "/tmp/skills",
  });

  view.handleInput("m");
  view.handleInput("\x1be");

  const rendered = view.render(100).join("\n");
  assert.match(rendered, /MCP/);
  assert.doesNotMatch(rendered, /pool:/);
  assert.doesNotMatch(rendered, /Alt\+E edit pool/);
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

test("setTheme updates rendered ANSI without changing visible width", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {}, { ...darkTheme, accent: "#010203" });
  const before = view.render(80);

  view.setTheme({ ...darkTheme, accent: "#040506" });
  const after = view.render(80);

  assert.notEqual(after.join("\n"), before.join("\n"));
  assert.deepEqual(after.map(stripAnsi), before.map(stripAnsi));
  for (const line of after) assert.ok(stripAnsi(line).length <= 80, stripAnsi(line));
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

test("restart confirmation ignores non-confirmation keys", () => {
  const restarted: string[] = [];
  const switched: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    restart: (id) => restarted.push(id),
    switchInsideTmux: (tmuxSession) => { switched.push(tmuxSession); },
    now: () => 100,
    skills: () => [],
  });

  view.handleInput("R");
  view.handleInput("\r");
  assert.deepEqual(switched, []);
  assert.match(view.render(100).join("\n"), /Restart session/);

  view.handleInput("?");
  assert.match(view.render(100).join("\n"), /Restart session/);

  view.handleInput("s");
  assert.match(view.render(100).join("\n"), /Restart session/);

  view.handleInput("R");
  assert.deepEqual(restarted, ["api"]);
});

test("zero-match filter blocks selected actions", () => {
  const restarted: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { restart: (id) => restarted.push(id) });
  view.handleInput("/");
  for (const char of "zzz") view.handleInput(char);
  assert.match(view.render(100).join("\n"), /No sessions match/);
  view.handleInput("\r");
  view.handleInput("R");
  view.handleInput("R");
  assert.deepEqual(restarted, []);
});

test("filter matching ignores parent cwd directories for action selection", () => {
  const restarted: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [{ ...session("api", "api"), cwd: "/tmp/hidden-parent/api" }] });
  const view = new SessionsView(controller, () => {}, { restart: (id) => restarted.push(id) });
  view.handleInput("/");
  for (const char of "hidden") view.handleInput(char);
  assert.match(view.render(100).join("\n"), /No sessions match/);
  view.handleInput("\r");
  view.handleInput("R");
  view.handleInput("R");
  assert.deepEqual(restarted, []);
});

test("starting no-match filter clears stale attach flash", () => {
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
