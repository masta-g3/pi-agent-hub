import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { configPath, effectiveMcpCatalogPath, effectiveSkillPoolDirs } from "../src/core/config.js";
import { loadMcpCatalog } from "../src/mcp/config.js";
import { listSkillPool } from "../src/skills/catalog.js";

async function makeSkill(root: string, name: string) {
  const path = join(root, name);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "SKILL.md"), `---\nname: ${name}\n---\n`, "utf8");
  return path;
}

test("config defaults to the legacy skill pool and MCP catalog", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-sessions-config-"));
  const env = { PI_SESSIONS_DIR: root };

  assert.equal(configPath(env), join(root, "config.json"));
  assert.deepEqual(await effectiveSkillPoolDirs(env), [join(root, "skills", "pool")]);
  assert.equal(await effectiveMcpCatalogPath(env), join(root, "mcp.json"));
});

test("listSkillPool reads configured skill directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-sessions-config-"));
  const env = { PI_SESSIONS_DIR: root };
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
  const root = await mkdtemp(join(tmpdir(), "pi-sessions-config-"));
  const env = { PI_SESSIONS_DIR: root };
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
