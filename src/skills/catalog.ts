import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { sessionsStateDir } from "../core/paths.js";

export interface SkillCatalogEntry {
  name: string;
  path: string;
}

export async function listSkillPool(env: NodeJS.ProcessEnv = process.env): Promise<SkillCatalogEntry[]> {
  const pool = join(sessionsStateDir(env), "skills", "pool");
  try {
    const entries = await readdir(pool, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, path: join(pool, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}
