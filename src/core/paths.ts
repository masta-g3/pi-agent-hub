import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function agentDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"));
}

export function sessionDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.PI_CODING_AGENT_SESSION_DIR ?? join(agentDir(env), "sessions"));
}

export function sessionsStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.PI_SESSIONS_DIR ?? join(agentDir(env), "pi-sessions"));
}

export function registryPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(sessionsStateDir(env), "registry.json");
}

export function heartbeatDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(sessionsStateDir(env), "heartbeats");
}

export function heartbeatPath(sessionId: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(heartbeatDir(env), `${sessionId}.json`);
}

export function projectSessionsDir(cwd: string): string {
  return join(resolve(cwd), ".pi", "sessions");
}

export function projectSkillsStatePath(cwd: string): string {
  return join(projectSessionsDir(cwd), "skills.json");
}

export function projectMcpStatePath(cwd: string): string {
  return join(projectSessionsDir(cwd), "mcp.json");
}
