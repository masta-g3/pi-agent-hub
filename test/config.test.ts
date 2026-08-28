import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { configPath, effectiveDashboardShortcuts, effectiveDashboardThemePreference, effectiveMcpCatalogPath, effectiveSessionPrelude, effectiveSkillPoolDirs, effectiveWorktreeDefault, setDashboardThemePreference, setSessionPrelude, setSkillPoolDirs, setWorktreeDefault, unsetSessionPrelude, unsetWorktreeDefault } from "../src/core/config.js";
import { loadMcpCatalog } from "../src/mcp/config.js";
import { listSkillPool } from "../src/skills/catalog.js";

async function makeSkill(root: string, name: string) {
  const path = join(root, name);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "SKILL.md"), `---\nname: ${name}\n---\n`, "utf8");
  return path;
}

test("config defaults to the built-in skill pool and MCP catalog", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };

  assert.equal(configPath(env), join(root, "config.json"));
  assert.deepEqual(await effectiveSkillPoolDirs(env), [join(root, "skills", "pool")]);
  assert.equal(await effectiveMcpCatalogPath(env), join(root, "mcp.json"));
  assert.equal(await effectiveSessionPrelude(env), undefined);
  assert.equal(await effectiveWorktreeDefault(env), true);
  assert.deepEqual(await effectiveDashboardThemePreference(env), { syncPi: true });
  assert.deepEqual(await effectiveDashboardShortcuts(env), []);
});

test("session prelude config is trimmed and validated", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };
  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    session: { prelude: "  echo setup  " },
  }), "utf8");

  assert.equal(await effectiveSessionPrelude(env), "echo setup");

  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    session: { prelude: 42 },
  }), "utf8");

  await assert.rejects(() => effectiveSessionPrelude(env), /Invalid session\.prelude/);
});

test("worktree default is validated and preserves unrelated session config", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };
  await writeFile(configPath(env), JSON.stringify({ version: 1, session: { prelude: "echo setup" } }), "utf8");

  await setWorktreeDefault(false, env);
  assert.equal(await effectiveWorktreeDefault(env), false);
  assert.equal(await effectiveSessionPrelude(env), "echo setup");

  await unsetWorktreeDefault(env);
  assert.equal(await effectiveWorktreeDefault(env), true);
  assert.equal(await effectiveSessionPrelude(env), "echo setup");

  await writeFile(configPath(env), JSON.stringify({ version: 1, session: { worktreeDefault: "yes" } }), "utf8");
  await assert.rejects(() => effectiveWorktreeDefault(env), /Invalid session\.worktreeDefault/);
});

test("unsetting the final session setting removes the empty session object", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };
  await writeFile(configPath(env), JSON.stringify({ version: 1, session: { prelude: "echo setup" } }), "utf8");

  await unsetSessionPrelude(env);
  assert.deepEqual(JSON.parse(await readFile(configPath(env), "utf8")), { version: 1 });

  await writeFile(configPath(env), JSON.stringify({ version: 1, session: { prelude: "echo setup", worktreeDefault: true } }), "utf8");
  await unsetSessionPrelude(env);
  assert.deepEqual(JSON.parse(await readFile(configPath(env), "utf8")), { version: 1, session: { worktreeDefault: true } });

  await unsetWorktreeDefault(env);
  assert.deepEqual(JSON.parse(await readFile(configPath(env), "utf8")), { version: 1 });

  await writeFile(configPath(env), JSON.stringify({ version: 1 }), "utf8");
  await unsetSessionPrelude(env);
  assert.deepEqual(JSON.parse(await readFile(configPath(env), "utf8")), { version: 1 });
});

test("session prelude setters preserve unrelated config", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };
  const shared = join(root, "shared-skills");
  const catalogPath = join(root, "mcp.json");
  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    skills: { poolDirs: [shared] },
    mcp: { catalogPath },
  }), "utf8");

  await setSessionPrelude("  echo setup  ", env);
  assert.equal(await effectiveSessionPrelude(env), "echo setup");
  assert.deepEqual(await effectiveSkillPoolDirs(env), [shared]);
  assert.equal(await effectiveMcpCatalogPath(env), catalogPath);

  await unsetSessionPrelude(env);
  assert.equal(await effectiveSessionPrelude(env), undefined);
  assert.deepEqual(await effectiveSkillPoolDirs(env), [shared]);
  assert.equal(await effectiveMcpCatalogPath(env), catalogPath);
});

test("dashboard theme preference defaults to Pi sync and detached saves scrub the old anchor", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };
  const shared = join(root, "shared-skills");
  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    skills: { poolDirs: [shared] },
    dashboard: { themeSessionId: "old-session" },
  }), "utf8");

  await setDashboardThemePreference({ syncPi: false, theme: " light-theme/dark-theme " }, env);

  assert.deepEqual(await effectiveDashboardThemePreference(env), { syncPi: false, theme: "light-theme/dark-theme" });
  assert.deepEqual(await effectiveSkillPoolDirs(env), [shared]);
  assert.deepEqual(JSON.parse(await readFile(configPath(env), "utf8")).dashboard, {
    themeSync: false,
    theme: "light-theme/dark-theme",
  });

  await setDashboardThemePreference({ syncPi: true }, env);
  assert.deepEqual(await effectiveDashboardThemePreference(env), { syncPi: true });
  assert.equal(JSON.parse(await readFile(configPath(env), "utf8")).dashboard.theme, undefined);
});

test("dashboard theme preference validates sync and detached theme", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };

  await assert.rejects(() => setDashboardThemePreference({ syncPi: false, theme: "  " }, env), /dashboard theme cannot be blank/);
  await writeFile(configPath(env), JSON.stringify({ version: 1, dashboard: { themeSync: "yes" } }), "utf8");
  await assert.rejects(() => effectiveDashboardThemePreference(env), /Invalid dashboard\.themeSync/);
  await writeFile(configPath(env), JSON.stringify({ version: 1, dashboard: { themeSync: false, theme: 42 } }), "utf8");
  await assert.rejects(() => effectiveDashboardThemePreference(env), /Invalid dashboard\.theme/);
});

test("dashboard shortcut config is normalized and validated", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };
  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    dashboard: {
      themeSync: false,
      theme: "light",
      shortcuts: [
        { key: "ctrl+n", label: " summarize name ", send: " /session-summary name ", syncPiNameAfterMs: 8000 },
        { key: "alt+x", send: "/other" },
      ],
    },
  }), "utf8");

  assert.deepEqual(await effectiveDashboardShortcuts(env), [
    { key: "C-n", label: "summarize name", send: "/session-summary name", syncPiNameAfterMs: 8000 },
    { key: "M-x", send: "/other" },
  ]);
  assert.deepEqual(await effectiveDashboardThemePreference(env), { syncPi: false, theme: "light" });
});

test("dashboard shortcut config allows non-reserved printable variants", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };
  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    dashboard: { shortcuts: [{ key: "O", send: "/session-name refresh" }, { key: "!", send: "/shifted" }] },
  }), "utf8");

  assert.deepEqual(await effectiveDashboardShortcuts(env), [{ key: "O", send: "/session-name refresh" }, { key: "!", send: "/shifted" }]);
});

test("dashboard shortcut config rejects conflicts and invalid send values", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };
  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    dashboard: { shortcuts: [{ key: "N", send: "/session-name refresh" }] },
  }), "utf8");
  await assert.rejects(() => effectiveDashboardShortcuts(env), /conflicts with a built-in dashboard shortcut/);

  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    dashboard: { shortcuts: [{ key: "A", send: "/session-name refresh" }] },
  }), "utf8");
  await assert.rejects(() => effectiveDashboardShortcuts(env), /conflicts with a built-in dashboard shortcut/);

  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    dashboard: { shortcuts: [{ key: "C-q", send: "/session-name refresh" }] },
  }), "utf8");
  await assert.rejects(() => effectiveDashboardShortcuts(env), /conflicts with a built-in dashboard shortcut/);

  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    dashboard: { shortcuts: [{ key: "M-q", send: "/session-name refresh" }] },
  }), "utf8");
  await assert.rejects(() => effectiveDashboardShortcuts(env), /conflicts with a built-in dashboard shortcut/);

  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    dashboard: { shortcuts: [{ key: "C-m", send: "/session-name refresh" }] },
  }), "utf8");
  await assert.rejects(() => effectiveDashboardShortcuts(env), /conflicts with a built-in dashboard shortcut/);

  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    dashboard: { shortcuts: [{ key: "v", send: "/session-name refresh" }] },
  }), "utf8");
  await assert.rejects(() => effectiveDashboardShortcuts(env), /conflicts with a built-in dashboard shortcut/);

  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    dashboard: { shortcuts: [{ key: "F", send: "/session-name refresh" }] },
  }), "utf8");
  await assert.rejects(() => effectiveDashboardShortcuts(env), /conflicts with a built-in dashboard shortcut/);

  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    dashboard: { shortcuts: [{ key: "1", send: "/session-name refresh" }] },
  }), "utf8");
  await assert.rejects(() => effectiveDashboardShortcuts(env), /conflicts with a built-in dashboard shortcut/);

  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    dashboard: { shortcuts: [{ key: "M-1", send: "/session-name refresh" }] },
  }), "utf8");
  await assert.rejects(() => effectiveDashboardShortcuts(env), /conflicts with a built-in dashboard shortcut/);

  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    dashboard: { shortcuts: [{ key: "o", send: "/session-name refresh" }] },
  }), "utf8");
  await assert.rejects(() => effectiveDashboardShortcuts(env), /conflicts with a built-in dashboard shortcut/);

  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    dashboard: { shortcuts: [{ key: "C-n", send: "/one\n/two" }] },
  }), "utf8");
  await assert.rejects(() => effectiveDashboardShortcuts(env), /must be one line/);

  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    dashboard: { shortcuts: [{ key: "C-n", send: "\n/session-name refresh" }] },
  }), "utf8");
  await assert.rejects(() => effectiveDashboardShortcuts(env), /must be one line/);
});

test("dashboard theme and command palette keys are reserved from configurable shortcuts", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };
  await writeFile(configPath(env), JSON.stringify({ version: 1, dashboard: { shortcuts: [{ key: "t", send: "/theme" }] } }), "utf8");
  await assert.rejects(() => effectiveDashboardShortcuts(env), /conflicts with a built-in dashboard shortcut/);
  await writeFile(configPath(env), JSON.stringify({ version: 1, dashboard: { shortcuts: [{ key: ":", send: "/palette" }] } }), "utf8");
  await assert.rejects(() => effectiveDashboardShortcuts(env), /conflicts with a built-in dashboard shortcut/);
});

test("setSessionPrelude rejects blank commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };

  await assert.rejects(() => setSessionPrelude("   ", env), /session-prelude cannot be blank/);
});

test("skill pool setter trims validates expands and preserves unrelated config", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };
  const pool = join(root, "shared-skills");
  const catalogPath = join(root, "mcp.json");
  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    skills: { poolDirs: [join(root, "old-skills")] },
    mcp: { catalogPath },
    session: { prelude: "echo setup" },
    dashboard: { themeSync: false, theme: "dark" },
  }), "utf8");

  await setSkillPoolDirs([`  ${pool}  `], env);

  assert.deepEqual(await effectiveSkillPoolDirs(env), [pool]);
  assert.equal(await effectiveMcpCatalogPath(env), catalogPath);
  assert.equal(await effectiveSessionPrelude(env), "echo setup");
  assert.deepEqual(await effectiveDashboardThemePreference(env), { syncPi: false, theme: "dark" });
});

test("skill pool setter rejects blank paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };

  await assert.rejects(() => setSkillPoolDirs(["   "], env), /skill pool dir cannot be blank/);
});

test("listSkillPool reads configured skill directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };
  const shared = join(root, "shared-skills");
  const team = join(root, "team-skills");
  await makeSkill(shared, "docs");
  await makeSkill(team, "frontend");
  await makeSkill(team, "docs");
  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    skills: { poolDirs: [shared, team] },
  }), "utf8");

  assert.deepEqual(await effectiveSkillPoolDirs(env), [shared, team]);
  assert.deepEqual(await listSkillPool(env), [
    { name: "docs", path: join(shared, "docs") },
    { name: "frontend", path: join(team, "frontend") },
  ]);
});

test("loadMcpCatalog reads configured catalog path", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };
  const catalogPath = join(root, "catalogs", "mcp.json");
  await mkdir(join(root, "catalogs"), { recursive: true });
  await writeFile(catalogPath, JSON.stringify({
    version: 1,
    servers: { fake: { type: "stdio", command: "fake" } },
  }), "utf8");
  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    mcp: { catalogPath },
  }), "utf8");

  const catalog = await loadMcpCatalog(undefined, env);
  assert.deepEqual(Object.keys(catalog.servers), ["fake"]);
});
