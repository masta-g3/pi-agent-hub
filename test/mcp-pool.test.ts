import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { startMcpPool } from "../src/mcp/pool-daemon.js";
import { McpPoolClient } from "../src/mcp/pool-client.js";
import type { DirectMcpClient } from "../src/mcp/direct-client.js";

function fakeClient(): DirectMcpClient {
  return {
    async listTools() { return [{ name: "echo" }]; },
    async callTool(name) { return { content: [{ type: "text", text: `${name}-ok` }] }; },
    async close() {},
  };
}

test("MCP pool lists and calls pooled stdio server over Unix socket", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-sessions-pool-"));
  const catalogPath = join(root, "mcp.json");
  const socketPath = join(root, "pool.sock");
  await writeFile(catalogPath, JSON.stringify({ version: 1, servers: { fake: { type: "stdio", command: "fake", pool: true } } }), "utf8");
  const pool = await startMcpPool({ socketPath, catalogPath, createClient: async () => fakeClient() });
  try {
    const client = new McpPoolClient(socketPath);
    assert.deepEqual(await client.listTools("fake"), [{ name: "echo" }]);
    assert.deepEqual(await client.callTool("fake", "echo", {}), { content: [{ type: "text", text: "echo-ok" }] });
  } finally {
    await pool.close();
  }
});

test("MCP pool reports unavailable pooled server", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-sessions-pool-"));
  const catalogPath = join(root, "mcp.json");
  const socketPath = join(root, "pool.sock");
  await writeFile(catalogPath, JSON.stringify({ version: 1, servers: {} }), "utf8");
  const pool = await startMcpPool({ socketPath, catalogPath, createClient: async () => fakeClient() });
  try {
    await assert.rejects(new McpPoolClient(socketPath).listTools("missing"), /unavailable/);
  } finally {
    await pool.close();
  }
});
