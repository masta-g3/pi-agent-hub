import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { buildRenderModel } from "../src/tui/render-model.js";
import { renderSessions, renderForm } from "../src/tui/layout.js";
import { darkTheme, loadSessionsTheme, stripAnsi, styleToken, themeFromPiTheme } from "../src/tui/theme.js";
import type { ManagedSession } from "../src/core/types.js";

function session(): ManagedSession {
  return {
    id: "s1",
    title: "api",
    cwd: "/tmp/api",
    group: "default",
    tmuxSession: "pi-sessions-s1",
    status: "waiting",
    createdAt: 1,
    updatedAt: 1,
  };
}

test("themeFromPiTheme resolves vars for sessions tokens", () => {
  const theme = themeFromPiTheme({
    vars: { blue: "#00aaff", gray: 242 },
    colors: { accent: "blue", success: "#00ff00", muted: "gray" },
  });
  assert.equal(theme.accent, "#00aaff");
  assert.equal(theme.success, "#00ff00");
  assert.equal(theme.muted, 242);
  assert.equal(theme.error, darkTheme.error);
});

test("loadSessionsTheme reads project settings before global settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-sessions-theme-"));
  const project = join(root, "project");
  const agent = join(root, "agent");
  await mkdir(join(project, ".pi", "themes"), { recursive: true });
  await mkdir(agent, { recursive: true });
  await writeFile(join(project, ".pi", "settings.json"), JSON.stringify({ theme: "project-theme" }), "utf8");
  await writeFile(join(project, ".pi", "themes", "project-theme.json"), JSON.stringify({ colors: { accent: "#123456" } }), "utf8");
  await writeFile(join(agent, "settings.json"), JSON.stringify({ theme: "global-theme" }), "utf8");

  const theme = await loadSessionsTheme({ cwd: project, env: { PI_CODING_AGENT_DIR: agent } });
  assert.equal(theme.accent, "#123456");
});

test("loadSessionsTheme falls back to dark theme", async () => {
  const theme = await loadSessionsTheme({ env: { PI_CODING_AGENT_DIR: "/definitely/missing" } });
  assert.deepEqual(theme, darkTheme);
});

test("styleToken uses ANSI without changing visible text", () => {
  const styled = styleToken({ ...darkTheme, accent: "#010203" }, "accent", "api");
  assert.match(styled, /\u001b\[38;2;1;2;3mapi\u001b\[0m/);
  assert.equal(stripAnsi(styled), "api");
});

test("renderSessions applies theme tokens without changing visible width", () => {
  const lines = renderSessions(buildRenderModel({ sessions: [session()], width: 80 }), { ...darkTheme, accent: "#010203" });
  assert.match(lines.join("\n"), /\u001b\[/);
  for (const line of lines) assert.ok(stripAnsi(line).length <= 80, stripAnsi(line));
});

test("renderForm renders cwd start-truncated and errors visible at narrow widths", () => {
  const lines = renderForm({
    title: "New session",
    fields: [
      { key: "cwd", label: "cwd", value: "/Users/manager/Code/agents/pi-sessions", truncate: "start", error: "cwd is required" },
      { key: "group", label: "group", value: "default" },
      { key: "title", label: "title", value: "api" },
    ],
    focus: "cwd",
    footer: "tab/↓ next · enter create · esc cancel",
    narrowFooter: "tab · enter · esc",
  }, 30, darkTheme);
  const text = stripAnsi(lines.join("\n"));
  assert.match(text, /pi-sessions|….*sessions/);
  assert.match(text, /cwd is required/);
  assert.doesNotMatch(text, /^\/Users\/manager.*…/m);
});

test("renderForm keeps stable width and marks one focused field", () => {
  const widths = [28, 60, 100];
  for (const width of widths) {
    const lines = renderForm({
      title: "New session",
      fields: [
        { key: "cwd", label: "cwd", value: "/tmp/api", hint: "current dir" },
        { key: "group", label: "group", value: "default", hint: "tab to focus" },
        { key: "title", label: "title", value: "api", hint: "defaults to cwd basename" },
      ],
      focus: "cwd",
      footer: "tab next · enter create · esc cancel",
    }, width, darkTheme);
    const inner = Math.max(20, Math.min(Math.max(20, width - 2), 86));
    const expectedWidth = inner + 2;
    for (const line of lines) assert.equal(stripAnsi(line).length, expectedWidth, `${width}: ${stripAnsi(line)}`);
    const carets = lines.filter((line) => stripAnsi(line).includes("▎"));
    assert.equal(carets.length, 1);
  }
});
