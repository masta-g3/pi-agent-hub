import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { buildRenderModel } from "../src/tui/render-model.js";
import { renderSessions, renderForm } from "../src/tui/layout.js";
import { darkTheme, lightTheme, loadActiveTheme, loadSessionsTheme, stripAnsi, stripAnsiExceptItalics, styleToken, themeFromPiTheme } from "../src/tui/theme.js";
import type { ManagedSession } from "../src/core/types.js";

function session(): ManagedSession {
  return {
    id: "s1",
    title: "api",
    cwd: "/tmp/api",
    group: "default",
    tmuxSession: "pi-agent-hub-s1",
    status: "waiting",
    createdAt: 1,
    updatedAt: 1,
  };
}

test("themeFromPiTheme resolves vars for sessions tokens", () => {
  const theme = themeFromPiTheme({
    vars: { blue: "#00aaff", gray: 242, crust: "#dce0e8" },
    colors: { accent: "blue", success: "#00ff00", muted: "gray", statusLineBg: "crust" },
  });
  assert.equal(theme.accent, "#00aaff");
  assert.equal(theme.success, "#00ff00");
  assert.equal(theme.muted, 242);
  assert.equal(theme.statusLineBg, "#dce0e8");
  assert.equal(theme.error, darkTheme.error);
});

test("themeFromPiTheme leaves missing statusLineBg empty so tmux chrome can fall back", () => {
  const theme = themeFromPiTheme({ colors: { accent: "#00aaff", border: "#ccd0da" } });
  assert.equal(theme.statusLineBg, "");
});

test("loadSessionsTheme reads project settings before global settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-theme-"));
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

test("loadSessionsTheme loads selected theme from a global git package", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-theme-"));
  const agent = join(root, "agent");
  const packageRoot = join(agent, "git", "github.com", "hasit", "pi-community-themes");
  await mkdir(join(packageRoot, "themes"), { recursive: true });
  await writeFile(join(agent, "settings.json"), JSON.stringify({
    theme: "solarized-light",
    packages: ["git:https://github.com/hasit/pi-community-themes"],
  }), "utf8");
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ pi: { themes: ["./themes"] } }), "utf8");
  await writeFile(join(packageRoot, "themes", "solarized-light.json"), JSON.stringify({ colors: { accent: "#268bd2" } }), "utf8");

  const theme = await loadSessionsTheme({ env: { PI_CODING_AGENT_DIR: agent } });
  assert.equal(theme.accent, "#268bd2");
});

test("loadSessionsTheme supports package theme file entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-theme-"));
  const agent = join(root, "agent");
  const packageRoot = join(agent, "git", "github.com", "hasit", "pi-community-themes");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(agent, "settings.json"), JSON.stringify({
    theme: "solarized-light",
    packages: ["git:github.com/hasit/pi-community-themes"],
  }), "utf8");
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ pi: { themes: ["./solarized-light.json"] } }), "utf8");
  await writeFile(join(packageRoot, "solarized-light.json"), JSON.stringify({ colors: { accent: "#2aa198" } }), "utf8");

  const theme = await loadSessionsTheme({ env: { PI_CODING_AGENT_DIR: agent } });
  assert.equal(theme.accent, "#2aa198");
});

test("loadSessionsTheme prefers project package themes before global package themes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-theme-"));
  const project = join(root, "project");
  const agent = join(root, "agent");
  const projectPackage = join(project, ".pi", "git", "github.com", "hasit", "pi-community-themes");
  const globalPackage = join(agent, "git", "github.com", "hasit", "pi-community-themes");
  await mkdir(join(projectPackage, "themes"), { recursive: true });
  await mkdir(join(globalPackage, "themes"), { recursive: true });
  await writeFile(join(project, ".pi", "settings.json"), JSON.stringify({
    theme: "shared-theme",
    packages: ["git:https://github.com/hasit/pi-community-themes"],
  }), "utf8");
  await mkdir(agent, { recursive: true });
  await writeFile(join(agent, "settings.json"), JSON.stringify({
    packages: ["git:https://github.com/hasit/pi-community-themes"],
  }), "utf8");
  await writeFile(join(projectPackage, "package.json"), JSON.stringify({ pi: { themes: ["./themes"] } }), "utf8");
  await writeFile(join(globalPackage, "package.json"), JSON.stringify({ pi: { themes: ["./themes"] } }), "utf8");
  await writeFile(join(projectPackage, "themes", "shared-theme.json"), JSON.stringify({ colors: { accent: "#111111" } }), "utf8");
  await writeFile(join(globalPackage, "themes", "shared-theme.json"), JSON.stringify({ colors: { accent: "#222222" } }), "utf8");

  const theme = await loadSessionsTheme({ cwd: project, env: { PI_CODING_AGENT_DIR: agent } });
  assert.equal(theme.accent, "#111111");
});

test("loadSessionsTheme respects settings themes directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-theme-"));
  const agent = join(root, "agent");
  await mkdir(join(agent, "community-themes"), { recursive: true });
  await writeFile(join(agent, "settings.json"), JSON.stringify({ theme: "custom", themes: ["./community-themes"] }), "utf8");
  await writeFile(join(agent, "community-themes", "custom.json"), JSON.stringify({ colors: { accent: "#abcdef" } }), "utf8");

  const theme = await loadSessionsTheme({ env: { PI_CODING_AGENT_DIR: agent } });
  assert.equal(theme.accent, "#abcdef");
});

test("loadSessionsTheme supports relative local package paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-theme-"));
  const agent = join(root, "agent");
  const packageRoot = join(root, "packages", "local-themes");
  await mkdir(join(packageRoot, "themes"), { recursive: true });
  await mkdir(agent, { recursive: true });
  await writeFile(join(agent, "settings.json"), JSON.stringify({
    theme: "local-theme",
    packages: ["../packages/local-themes"],
  }), "utf8");
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ pi: { themes: ["./themes"] } }), "utf8");
  await writeFile(join(packageRoot, "themes", "local-theme.json"), JSON.stringify({ colors: { accent: "#fedcba" } }), "utf8");

  const theme = await loadSessionsTheme({ env: { PI_CODING_AGENT_DIR: agent } });
  assert.equal(theme.accent, "#fedcba");
});

test("loadActiveTheme loads active source path before persisted settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-active-theme-"));
  const agent = join(root, "agent");
  const project = join(root, "project");
  await mkdir(join(agent, "themes"), { recursive: true });
  await mkdir(project, { recursive: true });
  const activePath = join(agent, "themes", "active.json");
  await writeFile(join(agent, "settings.json"), JSON.stringify({ theme: "dark" }), "utf8");
  await writeFile(activePath, JSON.stringify({ colors: { accent: "#123456", border: "#654321", statusLineBg: "#010203" } }), "utf8");

  const theme = await loadActiveTheme({ name: "active", sourcePath: activePath }, { cwd: project, env: { PI_CODING_AGENT_DIR: agent } });

  assert.equal(theme?.accent, "#123456");
  assert.equal(theme?.statusLineBg, "#010203");
});

test("loadActiveTheme overlays live tokens onto resolved active source", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-active-theme-"));
  const agent = join(root, "agent");
  await mkdir(join(agent, "themes"), { recursive: true });
  const activePath = join(agent, "themes", "active.json");
  await writeFile(activePath, JSON.stringify({ colors: { accent: "#123456", border: "#654321", statusLineBg: "#010203" } }), "utf8");

  const theme = await loadActiveTheme({ sourcePath: activePath, tokens: { accent: "#abcdef" } }, { env: { PI_CODING_AGENT_DIR: agent } });

  assert.equal(theme?.accent, "#abcdef");
  assert.equal(theme?.statusLineBg, "#010203");
});

test("loadActiveTheme resolves active name without changing settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-active-theme-"));
  const agent = join(root, "agent");
  await mkdir(join(agent, "themes"), { recursive: true });
  await writeFile(join(agent, "settings.json"), JSON.stringify({ theme: "dark" }), "utf8");
  await writeFile(join(agent, "themes", "active.json"), JSON.stringify({ colors: { accent: "#abcdef" } }), "utf8");

  const theme = await loadActiveTheme({ name: "active" }, { env: { PI_CODING_AGENT_DIR: agent } });

  assert.equal(theme?.accent, "#abcdef");
});

test("loadActiveTheme uses in-memory token snapshots", async () => {
  const theme = await loadActiveTheme({ name: "<in-memory>", tokens: { accent: "#111111", muted: 244 } });

  assert.equal(theme?.accent, "#111111");
  assert.equal(theme?.muted, 244);
});

test("loadSessionsTheme returns built-in light theme for Pi light", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-theme-"));
  const agent = join(root, "agent");
  await mkdir(agent, { recursive: true });
  await writeFile(join(agent, "settings.json"), JSON.stringify({ theme: "light" }), "utf8");

  const theme = await loadSessionsTheme({ env: { PI_CODING_AGENT_DIR: agent } });
  assert.deepEqual(theme, lightTheme);
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

test("stripAnsiExceptItalics preserves only italic styling", () => {
  const styled = "\u001b[1;38;5;244mBold\u001b[0m \u001b[3;38;2;1;2;3mItalic\u001b[23;39m \u001b[4;48;5;12mUnderBg\u001b[0m";

  assert.equal(stripAnsiExceptItalics(styled), "Bold\u001b[0m \u001b[3mItalic\u001b[23m UnderBg\u001b[0m");
  assert.equal(stripAnsi(stripAnsiExceptItalics(styled)), "Bold Italic UnderBg");
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
      { key: "cwd", label: "cwd", value: "/Users/manager/Code/agents/example-service", truncate: "start", error: "cwd is required" },
      { key: "group", label: "group", value: "default" },
      { key: "title", label: "title", value: "api" },
    ],
    focus: "cwd",
    footer: "tab/↓ next · enter create · esc cancel",
    narrowFooter: "tab · enter · esc",
  }, 30, darkTheme);
  const text = stripAnsi(lines.join("\n"));
  assert.match(text, /example-service|….*service/);
  assert.match(text, /cwd is required/);
  assert.doesNotMatch(text, /^\/Users\/manager.*…/m);
});


test("renderForm renders optional section headers width-safely", () => {
  const lines = renderForm({
    title: "New session",
    fields: [
      { key: "repo:0", label: "★ primary", value: "/tmp/api", section: "repos", truncate: "start" },
      { key: "group", label: "group", value: "api" },
      { key: "title", label: "title", value: "api" },
    ],
    focus: "repo:0",
    footer: "tab next · alt-a add repo · enter create · esc cancel",
  }, 42, darkTheme);

  const text = stripAnsi(lines.join("\n"));
  assert.match(text, /repos/);
  assert.match(text, /★ primary/);
  for (const line of lines) assert.equal(stripAnsi(line).length, 42, stripAnsi(line));
});

test("renderForm keeps stable width and marks one focused field", () => {
  const widths = [28, 60, 100];
  for (const width of widths) {
    const lines = renderForm({
      title: "New session",
      fields: [
        { key: "cwd", label: "cwd", value: "/tmp/api", hint: "current dir" },
        { key: "group", label: "group", value: "api", hint: "defaults to cwd basename" },
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
