import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { readJsonOr, writeJsonAtomic } from "./atomic-json.js";
import { sessionsStateDir } from "./paths.js";

export interface SessionsConfig {
  version: 1;
  skills?: {
    poolDirs?: string[];
  };
  mcp?: {
    catalogPath?: string;
  };
  session?: {
    prelude?: string;
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

export async function effectiveSessionPrelude(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const prelude = (await loadSessionsConfig(env)).session?.prelude?.trim();
  return prelude || undefined;
}

export async function setSessionPrelude(prelude: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const trimmed = prelude.trim();
  if (!trimmed) throw new Error("session-prelude cannot be blank");
  const config = await loadSessionsConfig(env);
  await writeJsonAtomic(configPath(env), { ...config, session: { ...config.session, prelude: trimmed } });
}

export async function unsetSessionPrelude(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = await loadSessionsConfig(env);
  const next: SessionsConfig = { ...config, session: config.session ? { ...config.session } : undefined };
  if (next.session) {
    delete next.session.prelude;
    if (!Object.keys(next.session).length) delete next.session;
  }
  await writeJsonAtomic(configPath(env), next);
}

function validateConfig(config: SessionsConfig): void {
  if (config.version !== 1) throw new Error("Invalid pi-agent-hub config version");
  if (config.skills?.poolDirs && !Array.isArray(config.skills.poolDirs)) throw new Error("Invalid skills.poolDirs in pi-agent-hub config");
  if (config.skills?.poolDirs?.some((dir) => typeof dir !== "string")) throw new Error("Invalid skills.poolDirs in pi-agent-hub config");
  if (config.mcp?.catalogPath !== undefined && typeof config.mcp.catalogPath !== "string") throw new Error("Invalid mcp.catalogPath in pi-agent-hub config");
  if (config.session !== undefined && !isPlainObject(config.session)) throw new Error("Invalid session config in pi-agent-hub config");
  if (config.session?.prelude !== undefined && typeof config.session.prelude !== "string") throw new Error("Invalid session.prelude in pi-agent-hub config");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expandPath(path: string): string {
  const expanded = path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  return isAbsolute(expanded) ? expanded : resolve(expanded);
}
