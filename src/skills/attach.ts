import { cp, lstat, mkdir, readlink, rm, symlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { readJsonOr, writeJsonAtomic } from "../core/atomic-json.js";
import { projectSkillsStatePath } from "../core/paths.js";

export interface ProjectSkillsState {
  version: 1;
  attached: SkillAttachment[];
}

export interface SkillAttachment {
  name: string;
  source: "sessions-pool" | "path";
  sourcePath: string;
  materializedPath: string;
}

export interface AttachSkillOptions {
  projectCwd: string;
  sourcePath: string;
  name?: string;
  preferSymlink?: boolean;
}

export interface ProjectSkillSelection {
  name: string;
  sourcePath: string;
  enabled: boolean;
}

export async function loadProjectSkillsState(projectCwd: string): Promise<ProjectSkillsState> {
  return readJsonOr<ProjectSkillsState>(projectSkillsStatePath(projectCwd), { version: 1, attached: [] });
}

export async function attachSkill(options: AttachSkillOptions): Promise<SkillAttachment> {
  const attachment = await materializeSkill(options.projectCwd, options.name ?? basename(options.sourcePath), options.sourcePath, options.preferSymlink ?? true);
  const state = await loadProjectSkillsState(options.projectCwd);
  const next = state.attached.filter((item) => item.name !== attachment.name);
  next.push(attachment);
  await writeJsonAtomic(projectSkillsStatePath(options.projectCwd), { version: 1, attached: next });
  return attachment;
}

export async function setProjectSkills(projectCwd: string, skills: ProjectSkillSelection[]): Promise<ProjectSkillsState> {
  const state = await loadProjectSkillsState(projectCwd);
  const disabled = new Set(skills.filter((skill) => !skill.enabled).map((skill) => skill.name));
  const attached = state.attached.filter((attachment) => !disabled.has(attachment.name));

  for (const skill of skills) {
    if (skill.enabled) {
      const attachment = await materializeSkill(projectCwd, skill.name, skill.sourcePath, true);
      const index = attached.findIndex((item) => item.name === skill.name);
      if (index !== -1) attached.splice(index, 1);
      attached.push(attachment);
    }
  }

  for (const attachment of state.attached) {
    if (disabled.has(attachment.name)) {
      await assertManagedMaterialization(attachment);
      await rm(attachment.materializedPath, { recursive: true, force: false });
    }
  }

  const next: ProjectSkillsState = { version: 1, attached };
  await writeJsonAtomic(projectSkillsStatePath(projectCwd), next);
  return next;
}

export async function detachSkill(projectCwd: string, name: string): Promise<boolean> {
  const state = await loadProjectSkillsState(projectCwd);
  const attachment = state.attached.find((item) => item.name === name);
  if (!attachment) return false;

  await assertManagedMaterialization(attachment);
  await rm(attachment.materializedPath, { recursive: true, force: false });
  await writeJsonAtomic(projectSkillsStatePath(projectCwd), {
    version: 1,
    attached: state.attached.filter((item) => item.name !== name),
  });
  return true;
}

async function materializeSkill(projectCwd: string, name: string, inputPath: string, preferSymlink: boolean): Promise<SkillAttachment> {
  const sourcePath = resolve(inputPath);
  const materializedPath = join(resolve(projectCwd), ".pi", "skills", name);
  const attachment: SkillAttachment = { name, source: "path", sourcePath, materializedPath };

  await mkdir(join(resolve(projectCwd), ".pi", "skills"), { recursive: true });
  if (preferSymlink) {
    try {
      await symlink(sourcePath, materializedPath, "dir");
    } catch (error) {
      if (!isAlreadyExists(error)) await cp(sourcePath, materializedPath, { recursive: true });
    }
  } else {
    await cp(sourcePath, materializedPath, { recursive: true });
  }
  return attachment;
}

async function assertManagedMaterialization(attachment: SkillAttachment): Promise<void> {
  const stat = await lstat(attachment.materializedPath);
  if (!stat.isSymbolicLink()) return;
  const target = await readlink(attachment.materializedPath);
  if (resolve(target) !== resolve(attachment.sourcePath)) {
    throw new Error(`Refusing to detach unmanaged skill path: ${attachment.materializedPath}`);
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
