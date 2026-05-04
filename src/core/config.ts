import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { readJsonOr } from "./atomic-json.js";
import { sessionsStateDir } from "./paths.js";

export interface SessionsConfig {
  version: 1;
  skills?: {
    poolDirs?: string[];
  };
  mcp?: {
    catalogPath?: string;
  };
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(sessionsStateDir(env), "config.json");
}

export async function loadSessionsConfig(env: NodeJS.ProcessEnv = process.env): Promise<SessionsConfig> {
  const config = await readJsonOr<SessionsConfig>(configPath(env), { version: 1 });
  validateConfig(config);
  return config;
}

export async function effectiveSkillPoolDirs(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const config = await loadSessionsConfig(env);
  const dirs = config.skills?.poolDirs?.filter((dir) => dir.trim());
  return (dirs?.length ? dirs : [join(sessionsStateDir(env), "skills", "pool")]).map((dir) => expandPath(dir));
}

export async function effectiveMcpCatalogPath(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const config = await loadSessionsConfig(env);
  return expandPath(config.mcp?.catalogPath || join(sessionsStateDir(env), "mcp.json"));
}

function validateConfig(config: SessionsConfig): void {
  if (config.version !== 1) throw new Error("Invalid pi-sessions config version");
  if (config.skills?.poolDirs && !Array.isArray(config.skills.poolDirs)) throw new Error("Invalid skills.poolDirs in pi-sessions config");
  if (config.skills?.poolDirs?.some((dir) => typeof dir !== "string")) throw new Error("Invalid skills.poolDirs in pi-sessions config");
  if (config.mcp?.catalogPath !== undefined && typeof config.mcp.catalogPath !== "string") throw new Error("Invalid mcp.catalogPath in pi-sessions config");
}

function expandPath(path: string): string {
  const expanded = path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  return isAbsolute(expanded) ? expanded : resolve(expanded);
}
