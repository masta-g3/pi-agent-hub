import { readJsonOr, writeJsonAtomic } from "../core/atomic-json.js";
import { effectiveMcpCatalogPath } from "../core/config.js";
import { sessionsStateDir, projectMcpStatePath } from "../core/paths.js";
import { join } from "node:path";

export interface McpCatalog {
  version: 1;
  servers: Record<string, McpServerConfig>;
}

export type McpServerConfig =
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string>; pool?: boolean }
  | { type: "http"; url: string; headers?: Record<string, string>; pool?: false };

export interface ProjectMcpState {
  version: 1;
  enabledServers: string[];
}

export function mcpCatalogPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(sessionsStateDir(env), "mcp.json");
}

export async function loadMcpCatalog(path?: string, env: NodeJS.ProcessEnv = process.env): Promise<McpCatalog> {
  const catalog = await readJsonOr<McpCatalog>(path ?? await effectiveMcpCatalogPath(env), { version: 1, servers: {} });
  validateMcpCatalog(catalog);
  return catalog;
}

export function validateMcpCatalog(catalog: McpCatalog): void {
  if (catalog.version !== 1 || typeof catalog.servers !== "object" || catalog.servers === null) {
    throw new Error("Invalid MCP catalog");
  }
  for (const [id, server] of Object.entries(catalog.servers)) {
    if (!id.trim()) throw new Error("MCP server id cannot be empty");
    if (server.type === "stdio") {
      if (!server.command) throw new Error(`MCP stdio server ${id} is missing command`);
    } else if (server.type === "http") {
      if (!server.url) throw new Error(`MCP HTTP server ${id} is missing url`);
      if (server.pool) throw new Error(`MCP HTTP server ${id} cannot use pool: true`);
    } else {
      throw new Error(`Unknown MCP server type for ${id}`);
    }
  }
}

export async function loadProjectMcpState(projectCwd: string): Promise<ProjectMcpState> {
  return readJsonOr<ProjectMcpState>(projectMcpStatePath(projectCwd), { version: 1, enabledServers: [] });
}

export async function setProjectMcpServer(projectCwd: string, serverId: string, enabled: boolean): Promise<ProjectMcpState> {
  const state = await loadProjectMcpState(projectCwd);
  const enabledServers = new Set(state.enabledServers);
  if (enabled) enabledServers.add(serverId);
  else enabledServers.delete(serverId);
  return setProjectMcpServers(projectCwd, [...enabledServers]);
}

export async function setProjectMcpServers(projectCwd: string, enabledServers: string[]): Promise<ProjectMcpState> {
  const next: ProjectMcpState = { version: 1, enabledServers: [...new Set(enabledServers)].sort() };
  await writeJsonAtomic(projectMcpStatePath(projectCwd), next);
  return next;
}
