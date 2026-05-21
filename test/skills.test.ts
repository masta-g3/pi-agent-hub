import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { projectSkillsStatePath } from "../src/core/paths.js";
import { attachSkill, detachSkill, loadProjectSkillsState, setProjectSkills } from "../src/skills/attach.js";
import { listSkillPool } from "../src/skills/catalog.js";

async function makeSkill(root: string, name: string) {
  const path = join(root, name);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "SKILL.md"), `---\nname: ${name}\n---\n`, "utf8");
  return path;
}

test("attach records managed skill and materializes it", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-skills-"));
  const project = join(root, "project");
  const source = await makeSkill(root, "repo-rules");

  const attachment = await attachSkill({ projectCwd: project, sourcePath: source, preferSymlink: false });
  assert.equal(attachment.name, "repo-rules");
  assert.match(await readFile(join(project, ".pi", "skills", "repo-rules", "SKILL.md"), "utf8"), /repo-rules/);
  assert.equal((await loadProjectSkillsState(project)).attached.length, 1);
});

test("bulk skill selection writes final state and preserves unrelated attachments", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-skills-"));
  const project = join(root, "project");
  const keep = await makeSkill(root, "keep");
  const add = await makeSkill(root, "add");
  const drop = await makeSkill(root, "drop");
  await attachSkill({ projectCwd: project, sourcePath: keep, preferSymlink: false });
  await attachSkill({ projectCwd: project, sourcePath: drop, preferSymlink: false });

  const state = await setProjectSkills(project, [
    { name: "add", sourcePath: add, enabled: true },
    { name: "drop", sourcePath: drop, enabled: false },
  ]);

  assert.deepEqual(state.attached.map((skill) => skill.name).sort(), ["add", "keep"]);
  assert.match(await readFile(join(project, ".pi", "skills", "add", "SKILL.md"), "utf8"), /add/);
  await assert.rejects(readFile(join(project, ".pi", "skills", "drop", "SKILL.md"), "utf8"));
});

test("bulk skill selection reuses same-source attachments", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-skills-"));
  const project = join(root, "project");
  const docs = await makeSkill(root, "docs");

  await setProjectSkills(project, [{ name: "docs", sourcePath: docs, enabled: true }]);
  const state = await setProjectSkills(project, [{ name: "docs", sourcePath: docs, enabled: true }]);

  assert.deepEqual(state.attached.map((skill) => skill.name), ["docs"]);
  assert.match(await readFile(join(project, ".pi", "skills", "docs", "SKILL.md"), "utf8"), /docs/);
});

test("bulk skill selection replaces same-name attachments from a new source", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-skills-"));
  const project = join(root, "project");
  const poolA = await makeSkill(join(root, "pool-a"), "docs");
  const poolB = await makeSkill(join(root, "pool-b"), "docs");
  await writeFile(join(poolA, "SKILL.md"), "pool a", "utf8");
  await writeFile(join(poolB, "SKILL.md"), "pool b", "utf8");

  await setProjectSkills(project, [{ name: "docs", sourcePath: poolA, enabled: true }]);
  const state = await setProjectSkills(project, [{ name: "docs", sourcePath: poolB, enabled: true }]);

  assert.deepEqual(state.attached.map((skill) => skill.sourcePath), [poolB]);
  assert.match(await readFile(join(project, ".pi", "skills", "docs", "SKILL.md"), "utf8"), /pool b/);
});

test("bulk skill selection refuses to overwrite unmanaged existing skill paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-skills-"));
  const project = join(root, "project");
  const docs = await makeSkill(root, "docs");
  await mkdir(join(project, ".pi", "skills", "docs"), { recursive: true });
  await writeFile(join(project, ".pi", "skills", "docs", "SKILL.md"), "manual", "utf8");

  await assert.rejects(() => setProjectSkills(project, [{ name: "docs", sourcePath: docs, enabled: true }]), /EEXIST/);
  assert.match(await readFile(join(project, ".pi", "skills", "docs", "SKILL.md"), "utf8"), /manual/);
});

test("detach removes only managed attachment", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-skills-"));
  const project = join(root, "project");
  const source = await makeSkill(root, "repo-rules");
  await attachSkill({ projectCwd: project, sourcePath: source, preferSymlink: false });

  assert.equal(await detachSkill(project, "repo-rules"), true);
  assert.equal((await loadProjectSkillsState(project)).attached.length, 0);
});

test("detach refuses unmanaged skill names", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-skills-"));
  const project = join(root, "project");
  await mkdir(join(project, ".pi", "skills", "manual"), { recursive: true });
  await writeFile(join(project, ".pi", "skills", "manual", "SKILL.md"), "manual", "utf8");

  assert.equal(await detachSkill(project, "manual"), false);
  assert.match(await readFile(join(project, ".pi", "skills", "manual", "SKILL.md"), "utf8"), /manual/);
});

test("listSkillPool discovers pool skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-skill-pool-"));
  const stateDir = join(root, "state");
  await makeSkill(join(stateDir, "skills", "pool"), "a");
  await makeSkill(join(stateDir, "skills", "pool"), "b");

  assert.deepEqual((await listSkillPool({ PI_AGENT_HUB_DIR: stateDir })).map((skill) => skill.name), ["a", "b"]);
});

test("skills state path is project local", () => {
  assert.match(projectSkillsStatePath("/tmp/project"), /\.pi\/sessions\/skills\.json$/);
});
