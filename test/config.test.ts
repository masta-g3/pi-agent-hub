import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { configPath, effectiveDashboardShortcuts, effectiveDashboardThemeSessionId, effectiveMcpCatalogPath, effectiveSessionPrelude, effectiveSkillPoolDirs, setDashboardThemeSessionId, setSessionPrelude, setSkillPoolDir, unsetSessionPrelude } from "../src/core/config.js";
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
  assert.equal(await effectiveDashboardThemeSessionId(env), undefined);
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

test("dashboard theme session config is trimmed validated and preserves unrelated config", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };
  const shared = join(root, "shared-skills");
  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    skills: { poolDirs: [shared] },
  }), "utf8");

  await setDashboardThemeSessionId("  session-123  ", env);

  assert.equal(await effectiveDashboardThemeSessionId(env), "session-123");
  assert.deepEqual(await effectiveSkillPoolDirs(env), [shared]);

  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    dashboard: { themeSessionId: 42 },
  }), "utf8");

  await assert.rejects(() => effectiveDashboardThemeSessionId(env), /Invalid dashboard\.themeSessionId/);
});

test("dashboard shortcut config is normalized and validated", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };
  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    dashboard: {
      themeSessionId: "session-1",
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
  assert.equal(await effectiveDashboardThemeSessionId(env), "session-1");
});

test("dashboard shortcut config rejects conflicts and invalid send values", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };
  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    dashboard: { shortcuts: [{ key: "N", send: "/session-summary name" }] },
  }), "utf8");
  await assert.rejects(() => effectiveDashboardShortcuts(env), /conflicts with a built-in dashboard shortcut/);

  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    dashboard: { shortcuts: [{ key: "C-q", send: "/session-summary name" }] },
  }), "utf8");
  await assert.rejects(() => effectiveDashboardShortcuts(env), /conflicts with a built-in dashboard shortcut/);

  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    dashboard: { shortcuts: [{ key: "C-m", send: "/session-summary name" }] },
  }), "utf8");
  await assert.rejects(() => effectiveDashboardShortcuts(env), /conflicts with a built-in dashboard shortcut/);

  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    dashboard: { shortcuts: [{ key: "C-n", send: "/one\n/two" }] },
  }), "utf8");
  await assert.rejects(() => effectiveDashboardShortcuts(env), /must be one line/);

  await writeFile(configPath(env), JSON.stringify({
    version: 1,
    dashboard: { shortcuts: [{ key: "C-n", send: "\n/session-summary name" }] },
  }), "utf8");
  await assert.rejects(() => effectiveDashboardShortcuts(env), /must be one line/);
});

test("setDashboardThemeSessionId rejects blank ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };

  await assert.rejects(() => setDashboardThemeSessionId("   ", env), /theme session id cannot be blank/);
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
    dashboard: { themeSessionId: "session-1" },
  }), "utf8");

  await setSkillPoolDir(`  ${pool}  `, env);

  assert.deepEqual(await effectiveSkillPoolDirs(env), [pool]);
  assert.equal(await effectiveMcpCatalogPath(env), catalogPath);
  assert.equal(await effectiveSessionPrelude(env), "echo setup");
  assert.equal(await effectiveDashboardThemeSessionId(env), "session-1");
});

test("skill pool setter rejects blank paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };

  await assert.rejects(() => setSkillPoolDir("   ", env), /skill pool dir cannot be blank/);
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
