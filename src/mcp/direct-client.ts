import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig } from "./config.js";

export interface DirectMcpClient {
  listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>>;
  callTool(name: string, args: unknown): Promise<unknown>;
  close(): Promise<void>;
}

export async function createDirectMcpClient(serverId: string, config: McpServerConfig): Promise<DirectMcpClient> {
  const transport = createTransport(config);
  const client = new Client({ name: `pi-sessions-${serverId}`, version: "0.1.0" });
  await client.connect(transport);
  return {
    async listTools() {
      const result = await client.listTools();
      return result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
    },
    async callTool(name: string, args: unknown) {
      return client.callTool({ name, arguments: isRecord(args) ? args : {} });
    },
    async close() {
      await client.close();
    },
  };
}

function createTransport(config: McpServerConfig): Transport {
  if (config.type === "stdio") {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      stderr: "pipe",
    });
  }
  return new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: config.headers },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
