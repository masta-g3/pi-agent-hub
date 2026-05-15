import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { configPath, effectiveMcpCatalogPath, effectiveSessionPrelude, effectiveSkillPoolDirs, setSessionPrelude, unsetSessionPrelude } from "../src/core/config.js";
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

test("setSessionPrelude rejects blank commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-config-"));
  const env = { PI_AGENT_HUB_DIR: root };

  await assert.rejects(() => setSessionPrelude("   ", env), /session-prelude cannot be blank/);
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
