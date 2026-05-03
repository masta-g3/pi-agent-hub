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
  const root = await mkdtemp(join(tmpdir(), "pi-sessions-skills-"));
  const project = join(root, "project");
  const source = await makeSkill(root, "repo-rules");

  const attachment = await attachSkill({ projectCwd: project, sourcePath: source, preferSymlink: false });
  assert.equal(attachment.name, "repo-rules");
  assert.match(await readFile(join(project, ".pi", "skills", "repo-rules", "SKILL.md"), "utf8"), /repo-rules/);
  assert.equal((await loadProjectSkillsState(project)).attached.length, 1);
});

test("bulk skill selection writes final state and preserves unrelated attachments", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-sessions-skills-"));
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

test("detach removes only managed attachment", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-sessions-skills-"));
  const project = join(root, "project");
  const source = await makeSkill(root, "repo-rules");
  await attachSkill({ projectCwd: project, sourcePath: source, preferSymlink: false });

  assert.equal(await detachSkill(project, "repo-rules"), true);
  assert.equal((await loadProjectSkillsState(project)).attached.length, 0);
});

test("detach refuses unmanaged skill names", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-sessions-skills-"));
  const project = join(root, "project");
  await mkdir(join(project, ".pi", "skills", "manual"), { recursive: true });
  await writeFile(join(project, ".pi", "skills", "manual", "SKILL.md"), "manual", "utf8");

  assert.equal(await detachSkill(project, "manual"), false);
  assert.match(await readFile(join(project, ".pi", "skills", "manual", "SKILL.md"), "utf8"), /manual/);
});

test("listSkillPool discovers pool skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-sessions-skill-pool-"));
  const stateDir = join(root, "state");
  await makeSkill(join(stateDir, "skills", "pool"), "a");
  await makeSkill(join(stateDir, "skills", "pool"), "b");

  assert.deepEqual((await listSkillPool({ PI_SESSIONS_DIR: stateDir })).map((skill) => skill.name), ["a", "b"]);
});

test("skills state path is project local", () => {
  assert.match(projectSkillsStatePath("/tmp/project"), /\.pi\/sessions\/skills\.json$/);
});
