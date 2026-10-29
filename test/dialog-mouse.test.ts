import test from "node:test";
import assert from "node:assert/strict";
import { SessionsController } from "../src/app/controller.js";
import { SessionsView } from "../src/tui/sessions-view.js";
import { stripAnsi } from "../src/tui/theme.js";
import { footerHits } from "../src/tui/dialog-mouse.js";
import type { ManagedSession } from "../src/core/types.js";
import type { SessionsViewActions } from "../src/tui/dialog.js";

function session(id: string, title: string): ManagedSession {
  return { id, title, cwd: `/tmp/${title}`, group: "default", tmuxSession: `pi-agent-hub-${id}`, status: "idle", createdAt: 1, updatedAt: 1 };
}

function view(actions: Partial<SessionsViewActions>, sessions: ManagedSession[] = [session("api", "api")]) {
  let now = 1_000;
  const instance = new SessionsView(new SessionsController({ version: 1, sessions }), () => {}, { terminalRows: () => 40, now: () => now, ...actions });
  return {
    instance,
    lines: (width = 120) => instance.render(width).map(stripAnsi),
    /** Renders, then presses the first row matching `text`, at `x` or at the text's start column. */
    click(text: string | RegExp, options: { width?: number; x?: number; wait?: number } = {}) {
      now += options.wait ?? 1_000;
      const lines = instance.render(options.width ?? 120).map(stripAnsi);
      const row = lines.findIndex((line) => typeof text === "string" ? line.includes(text) : text.test(line));
      assert.ok(row >= 0, `no row matches ${text}:\n${lines.join("\n")}`);
      const column = options.x ?? 1 + (typeof text === "string" ? lines[row]!.indexOf(text) : lines[row]!.search(text));
      instance.handleInput(`\u001b[<0;${column};${row + 1}M`);
    },
  };
}

test("footer hints map labels to replayable keys", () => {
  const hits = footerHits(7, "↑↓ Move · Space Sync · Enter Apply · Ctrl+Y Create  Esc Cancel", 2);
  assert.deepEqual(hits.map((hit) => [hit.key, hit.x, hit.width]), [[" ", 12, 10], ["\r", 25, 11], ["\u0019", 39, 13], ["\u001b", 54, 10]]);
  assert.deepEqual(footerHits(0, "Enter Apply · Esc Cancel", 2, 12).map((hit) => hit.key), ["\r"]);
});

test("theme rows select on click, apply on double-click, and Sync toggles", async () => {
  const previews: string[] = [];
  const applies: Array<[string, boolean]> = [];
  const dashboard = view({
    themeSettings: () => ({ names: ["dark", "light"], setting: "dark", syncPi: true }),
    previewDashboardTheme: (setting) => { previews.push(setting); },
    applyDashboardTheme: async (setting, sync) => { applies.push([setting, sync]); },
  });
  dashboard.instance.handleInput("t");
  dashboard.click("[ ] light");
  assert.deepEqual(previews, ["light"]);
  dashboard.click("Sync to Pi");
  assert.match(dashboard.lines().join("\n"), /Sync to Pi\s+\[ \] off/);
  dashboard.click("[✓] light");
  dashboard.click("[✓] light", { wait: 100 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(applies, [["light", false]]);
});

test("theme footer Esc tap cancels the preview", () => {
  const cancelled: string[] = [];
  const dashboard = view({
    themeSettings: () => ({ names: ["dark", "light"], setting: "dark", syncPi: true }),
    cancelDashboardTheme: (setting) => { cancelled.push(setting); },
  });
  dashboard.instance.handleInput("t");
  dashboard.click("Esc Cancel");
  assert.deepEqual(cancelled, ["dark"]);
  assert.doesNotMatch(dashboard.lines().join("\n"), /Sync to Pi/);
});

test("new session fields focus on click and action rows run on click", () => {
  let created: unknown;
  const dashboard = view({ newFormContext: () => ({ cwd: "/tmp/api" }), createSession: (input) => { created = input; } });
  dashboard.instance.handleInput("n");
  dashboard.click("Options");
  dashboard.click(/^│. worktree/);
  assert.match(dashboard.lines().join("\n"), /worktree\s+\[x\] on/);
  dashboard.click("+ Add directory");
  assert.match(dashboard.lines().join("\n"), /▎ Additional/);
  dashboard.click(/^│. group/);
  assert.match(dashboard.lines().join("\n"), /▎ group/);
  for (const char of "\u007f\u007f\u007fweb") dashboard.instance.handleInput(char);
  dashboard.click(/^│. branch/);
  for (const char of "feat") dashboard.instance.handleInput(char);
  dashboard.click("[ Create session ]");
  assert.deepEqual(created, { cwd: "/tmp/api", group: "web", worktree: { branch: "feat" } });
});

test("repo picker rows select on click and choose on double-click", () => {
  const dashboard = view({ newFormContext: () => ({ cwd: "/tmp/api", knownCwds: ["/tmp/api", "/tmp/web"] }) });
  dashboard.instance.handleInput("n");
  dashboard.instance.handleInput("\u000f");
  assert.match(dashboard.lines().join("\n"), /Recent repos/);
  dashboard.click("web");
  dashboard.click("web", { wait: 100 });
  const form = dashboard.lines().join("\n");
  assert.match(form, /New session/);
  assert.match(form, /\/tmp\/web/);
});

test("favorites rows select on click and apply on double-click", () => {
  const dashboard = view({
    newFormContext: () => ({ cwd: "/tmp/api" }),
    favorites: {
      load: () => ({ version: 1, favorites: [{ id: "a", name: "alpha", cwds: ["/tmp/alpha"] }, { id: "b", name: "beta", cwds: ["/tmp/beta", "/tmp/docs"] }] }),
      save: () => { throw new Error("unused"); },
      update: () => { throw new Error("unused"); },
      rename: () => { throw new Error("unused"); },
      remove: () => { throw new Error("unused"); },
    },
  });
  dashboard.instance.handleInput("n");
  dashboard.instance.handleInput("\u0006");
  dashboard.click("beta");
  dashboard.click("beta", { wait: 100 });
  const form = dashboard.lines().join("\n");
  assert.match(form, /New session/);
  assert.match(form, /\/tmp\/docs/);
});

test("form footer Enter tap submits through the normal guards", () => {
  const moves: string[] = [];
  const dashboard = view({ changeGroup: (id, group) => { moves.push(`${id}:${group}`); } });
  dashboard.instance.handleInput("g");
  for (const char of "\u007f\u007f\u007f\u007f\u007f\u007f\u007fops") dashboard.instance.handleInput(char);
  dashboard.click("Enter Move");
  assert.deepEqual(moves, ["api:ops"]);
});

test("archive and restart choice rows send their keys", () => {
  const events: string[] = [];
  const dashboard = view({
    archiveSession: (id, closure) => { events.push(`archive:${id}:${closure}`); },
    restart: (id) => { events.push(`restart:${id}`); },
  });
  dashboard.instance.handleInput("A");
  dashboard.click("Finished what I needed");
  dashboard.instance.handleInput("r");
  dashboard.click("Restart selected");
  assert.deepEqual(events, ["archive:api:done", "restart:api"]);
});

test("delete choices stay keyboard-only while Esc is tappable", () => {
  const deleted: string[] = [];
  const dashboard = view({ deleteSession: (id) => { deleted.push(id); } });
  dashboard.instance.handleInput("d");
  dashboard.click("d Delete session");
  assert.deepEqual(deleted, []);
  assert.match(dashboard.lines().join("\n"), /Delete session/);
  dashboard.click("Esc Cancel");
  assert.doesNotMatch(dashboard.lines().join("\n"), /Delete session/);
});

test("skills picker items toggle on double-click and Enter tap applies", () => {
  let applied: Array<{ name: string; enabled: boolean }> | undefined;
  const dashboard = view({
    skills: () => [{ name: "alpha", enabled: false }, { name: "beta", enabled: false }],
    applySkills: (items) => { applied = items; },
  });
  dashboard.instance.handleInput("s");
  dashboard.click("beta");
  dashboard.click("beta", { wait: 100 });
  dashboard.click("Enter Apply");
  assert.deepEqual(applied, [{ name: "alpha", enabled: false }, { name: "beta", enabled: true }]);
});

test("phone-width stacked form rows keep their click targets", () => {
  const dashboard = view({ newFormContext: () => ({ cwd: "/tmp/api" }) });
  dashboard.instance.handleInput("n");
  dashboard.click("+ Add directory", { width: 50 });
  assert.match(dashboard.lines(50).join("\n"), /▎ Additional/);
  dashboard.click("/tmp/api", { width: 50 });
  assert.match(dashboard.lines(50).join("\n"), /▎ Primary/);
});
