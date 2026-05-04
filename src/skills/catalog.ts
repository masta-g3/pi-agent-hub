import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { effectiveSkillPoolDirs } from "../core/config.js";

export interface SkillCatalogEntry {
  name: string;
  path: string;
}

export async function listSkillPool(env: NodeJS.ProcessEnv = process.env): Promise<SkillCatalogEntry[]> {
  const seen = new Set<string>();
  const skills: SkillCatalogEntry[] = [];
  for (const pool of await effectiveSkillPoolDirs(env)) {
    for (const skill of await listPoolDir(pool)) {
      if (seen.has(skill.name)) continue;
      seen.add(skill.name);
      skills.push(skill);
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

async function listPoolDir(pool: string): Promise<SkillCatalogEntry[]> {
  try {
    const entries = await readdir(pool, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, path: join(pool, entry.name) }));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}
