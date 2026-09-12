import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import {
  detectTerminalAppearance,
  readDashboardAppearance,
  effectiveDashboardTheme,
  loadGlobalThemeCatalog,
  parseAutomaticTheme,
  readGlobalPiThemeSetting,
  resolveThemeName,
  saveGlobalPiTheme,
} from "../src/tui/theme.js";

const foregroundColors = [
  "accent", "border", "borderAccent", "borderMuted", "success", "error", "warning", "muted", "dim", "text",
  "thinkingText", "userMessageText", "customMessageText", "customMessageLabel", "toolTitle", "toolOutput", "mdHeading",
  "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock", "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet",
  "toolDiffAdded", "toolDiffRemoved", "toolDiffContext", "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable",
  "syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation", "thinkingOff", "thinkingMinimal",
  "thinkingLow", "thinkingMedium", "thinkingHigh", "thinkingXhigh", "thinkingMax", "bashMode",
];
const backgroundColors = ["selectedBg", "userMessageBg", "customMessageBg", "toolPendingBg", "toolSuccessBg", "toolErrorBg"];

function validTheme(name: string, accent: string) {
  return {
    name,
    colors: {
      ...Object.fromEntries(foregroundColors.map((token) => [token, "#778899"])),
      ...Object.fromEntries(backgroundColors.map((token) => [token, "#112233"])),
      accent,
    },
  };
}

test("automatic theme settings parse and resolve once for terminal appearance", () => {
  assert.deepEqual(parseAutomaticTheme(" latte / mocha "), { lightTheme: "latte", darkTheme: "mocha" });
  assert.equal(parseAutomaticTheme("one/two/three"), undefined);
  assert.equal(resolveThemeName("latte/mocha", "light"), "latte");
  assert.equal(resolveThemeName("latte/mocha", "dark"), "mocha");
  assert.equal(resolveThemeName("dark", "light"), "dark");
  assert.equal(resolveThemeName("broken/", "dark"), undefined);
  assert.equal(detectTerminalAppearance({ COLORFGBG: "0;15" }), "light");
  assert.equal(detectTerminalAppearance({ COLORFGBG: "15;0" }), "dark");
  assert.equal(detectTerminalAppearance({ COLORFGBG: "0;245" }), "dark");
  assert.equal(detectTerminalAppearance({}), "dark");
});

test("dashboard appearance follows macOS changes without a terminal hint", async () => {
  let preferences = '<plist><dict><key>AppleInterfaceStyleSwitchesAutomatically</key><true/></dict></plist>';
  const readPreferences = async () => preferences;
  assert.equal(await readDashboardAppearance({}, "darwin", readPreferences), "light");
  preferences = '<plist><dict><key>AppleInterfaceStyle</key>\n<string>Dark</string></dict></plist>';
  assert.equal(await readDashboardAppearance({ COLORFGBG: "0;15" }, "darwin", readPreferences), "dark");
  preferences = '<plist><dict/></plist>';
  assert.equal(await readDashboardAppearance({ COLORFGBG: "15;0" }, "darwin", readPreferences), "light");
  assert.equal(await readDashboardAppearance({ COLORFGBG: "0;15" }, "linux", async () => { throw new Error("must not query macOS"); }), "light");
  await assert.rejects(readDashboardAppearance({}, "darwin", async () => { throw new Error("read failed"); }), /read failed/);
});

test("global theme catalog includes built-ins and global themes but excludes project themes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-dashboard-theme-"));
  const agent = join(root, "agent");
  const project = join(root, "project");
  const packageRoot = join(root, "global-theme-package");
  await mkdir(join(agent, "themes"), { recursive: true });
  await mkdir(join(packageRoot, "themes"), { recursive: true });
  await mkdir(join(project, ".pi", "themes"), { recursive: true });
  await writeFile(join(agent, "themes", "global-theme.json"), JSON.stringify(validTheme("global-theme", "#123456")), "utf8");
  await writeFile(join(agent, "themes", "malformed.json"), "{", "utf8");
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ pi: { themes: ["themes"] } }), "utf8");
  await writeFile(join(packageRoot, "themes", "package-theme.json"), JSON.stringify(validTheme("package-theme", "#456789")), "utf8");
  await writeFile(join(agent, "settings.json"), JSON.stringify({ themes: [join(agent, "themes")], packages: [packageRoot] }), "utf8");
  await writeFile(join(project, ".pi", "themes", "project-theme.json"), JSON.stringify(validTheme("project-theme", "#654321")), "utf8");
  await writeFile(join(project, ".pi", "settings.json"), JSON.stringify({ themes: [join(project, ".pi", "themes")] }), "utf8");

  const catalog = await loadGlobalThemeCatalog({ PI_CODING_AGENT_DIR: agent, PI_AGENT_HUB_DIR: join(root, "hub") });
  assert.deepEqual(catalog.options.slice(0, 2).map((item) => item.name), ["dark", "light"]);
  assert.ok(catalog.options.some((item) => item.name === "global-theme" && item.theme.accent === "#123456"));
  assert.ok(catalog.options.some((item) => item.name === "package-theme" && item.theme.accent === "#456789"));
  assert.equal(catalog.options.some((item) => item.name === "project-theme"), false);
  assert.ok(catalog.diagnostics.some((message) => message.includes("malformed.json")));
});

test("effective dashboard theme uses Pi global setting while synced and Hub override while detached", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-dashboard-theme-"));
  const agent = join(root, "agent");
  await mkdir(join(agent, "themes"), { recursive: true });
  await writeFile(join(agent, "themes", "custom.json"), JSON.stringify(validTheme("custom", "#abcdef")), "utf8");
  await writeFile(join(agent, "settings.json"), JSON.stringify({ theme: "light", themes: [join(agent, "themes")] }), "utf8");
  const env = { PI_CODING_AGENT_DIR: agent, PI_AGENT_HUB_DIR: join(root, "hub") };
  const catalog = await loadGlobalThemeCatalog(env);

  const synced = await effectiveDashboardTheme(catalog, { syncPi: true }, "dark", env);
  assert.equal(synced.setting, "light");
  assert.equal(synced.name, "light");
  const detachedFallback = await effectiveDashboardTheme(catalog, { syncPi: false }, "dark", env);
  assert.equal(detachedFallback.setting, "light");
  const detached = await effectiveDashboardTheme(catalog, { syncPi: false, theme: "custom" }, "dark", env);
  assert.equal(detached.setting, "custom");
  assert.equal(detached.theme.accent, "#abcdef");

  await writeFile(join(agent, "themes", "custom.json"), JSON.stringify(validTheme("custom", "#010203")), "utf8");
  const refreshed = await effectiveDashboardTheme(catalog, { syncPi: false, theme: "custom" }, "dark", env);
  assert.equal(refreshed.theme.accent, "#010203");
});

test("saveGlobalPiTheme aborts when Pi records a global settings write error", async () => {
  let globalLoaded = false;
  const storage = {
    withLock(scope: "global" | "project", update: (current: string | undefined) => string | undefined) {
      if (scope === "global" && globalLoaded) throw new Error("disk full");
      update(undefined);
      if (scope === "global") globalLoaded = true;
    },
  };
  const settingsManager = SettingsManager.fromStorage(storage, { projectTrusted: false });

  await assert.rejects(() => saveGlobalPiTheme("light", {}, { settingsManager }), /global settings: disk full/);
});

test("saveGlobalPiTheme preserves unrelated settings and reports the persisted value", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-dashboard-theme-"));
  const agent = join(root, "agent");
  await mkdir(agent, { recursive: true });
  await writeFile(join(agent, "settings.json"), JSON.stringify({ theme: "dark", defaultProvider: "openai" }), "utf8");
  const env = { PI_CODING_AGENT_DIR: agent, PI_AGENT_HUB_DIR: join(root, "hub") };

  await saveGlobalPiTheme("light/dark", env);

  assert.equal(await readGlobalPiThemeSetting(env), "light/dark");
  assert.equal(JSON.parse(await readFile(join(agent, "settings.json"), "utf8")).defaultProvider, "openai");
});
