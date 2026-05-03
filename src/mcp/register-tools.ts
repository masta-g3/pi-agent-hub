import { sessionsStateDir } from "../core/paths.js";
import { mcpResultToText, normalizeMcpInputSchema } from "./adapter.js";
import { loadMcpCatalog, loadProjectMcpState } from "./config.js";
import { createDirectMcpClient, type DirectMcpClient } from "./direct-client.js";
import { McpPoolClient } from "./pool-client.js";
import { toPiToolName } from "./tool-names.js";

export interface PiToolApi {
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    parameters: Record<string, unknown>;
    execute(_toolCallId: string, params: unknown, signal?: AbortSignal): Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }>;
  }): void;
}

export interface RegisterMcpToolsOptions {
  catalogPath?: string;
  poolSocketPath?: string;
  createClient?: typeof createDirectMcpClient;
  createPoolClient?: (socketPath: string) => Pick<McpPoolClient, "listTools" | "callTool">;
}

export async function registerMcpTools(pi: PiToolApi, cwd: string, options: RegisterMcpToolsOptions = {}): Promise<() => Promise<void>> {
  const catalog = await loadMcpCatalog(options.catalogPath);
  const project = await loadProjectMcpState(cwd);
  const createClient = options.createClient ?? createDirectMcpClient;
  const createPoolClient = options.createPoolClient ?? ((socketPath) => new McpPoolClient(socketPath));
  const clients: DirectMcpClient[] = [];
  const usedNames = new Set<string>();

  for (const serverId of project.enabledServers) {
    const server = catalog.servers[serverId];
    if (!server) throw new Error(`MCP server ${serverId} is enabled but missing from catalog`);
    const client = server.type === "stdio" && server.pool
      ? pooledClient(serverId, createPoolClient(options.poolSocketPath ?? `${sessionsStateDir()}/pool/pool.sock`))
      : await createClient(serverId, server);
    clients.push(client);
    const tools = await client.listTools();
    for (const tool of tools) {
      const name = toPiToolName(serverId, tool.name, usedNames);
      usedNames.add(name);
      pi.registerTool({
        name,
        label: `${serverId}:${tool.name}`,
        description: tool.description ?? `Call MCP tool ${tool.name} on ${serverId}`,
        parameters: normalizeMcpInputSchema(tool.inputSchema),
        async execute(_toolCallId, params) {
          const result = await client.callTool(tool.name, params);
          return { content: [{ type: "text", text: mcpResultToText(result as Parameters<typeof mcpResultToText>[0]) }], details: result };
        },
      });
    }
  }

  return async () => {
    await Promise.all(clients.map((client) => client.close()));
  };
}

function pooledClient(serverId: string, client: Pick<McpPoolClient, "listTools" | "callTool">): DirectMcpClient {
  return {
    async listTools() {
      const result = await client.listTools(serverId);
      if (!Array.isArray(result)) throw new Error(`Pooled MCP server ${serverId} returned invalid tools list`);
      return result as Awaited<ReturnType<DirectMcpClient["listTools"]>>;
    },
    async callTool(name, args) {
      return client.callTool(serverId, name, args);
    },
    async close() {},
  };
}
