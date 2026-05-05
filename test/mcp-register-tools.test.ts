import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { projectMcpStatePath } from "../src/core/paths.js";
import { registerMcpTools, type PiToolApi } from "../src/mcp/register-tools.js";
import type { DirectMcpClient } from "../src/mcp/direct-client.js";

function fakeClient(): DirectMcpClient {
  return {
    async listTools() {
      return [{ name: "echo", description: "Echo", inputSchema: { type: "object", properties: {} } }];
    },
    async callTool() {
      return { content: [{ type: "text", text: "ok" }] };
    },
    async close() {},
  };
}

test("registerMcpTools registers enabled project tools and cleanup closes clients", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-sessions-mcp-register-"));
  const project = join(root, "project");
  const catalogPath = join(root, "mcp.json");
  await writeFile(catalogPath, JSON.stringify({ version: 1, servers: { fake: { type: "stdio", command: "fake" } } }), "utf8");
  await mkdir(dirname(projectMcpStatePath(project)), { recursive: true });
  await writeFile(projectMcpStatePath(project), JSON.stringify({ version: 1, enabledServers: ["fake"] }), "utf8");

  const tools: Parameters<PiToolApi["registerTool"]>[0][] = [];
  let closed = false;
  const cleanup = await registerMcpTools({ registerTool: (tool) => tools.push(tool) }, project, {
    catalogPath,
    createClient: async () => ({ ...fakeClient(), close: async () => { closed = true; } }),
  });

  assert.equal(tools[0]?.name, "mcp_fake_echo");
  assert.deepEqual(await tools[0]?.execute("id", {}, undefined), {
    content: [{ type: "text", text: "ok" }],
    details: { content: [{ type: "text", text: "ok" }] },
  });
  await cleanup();
  assert.equal(closed, true);
});

test("registerMcpTools resolves project MCP state through workspace .pi symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-sessions-mcp-register-"));
  const primary = join(root, "api");
  const workspace = join(root, "workspace");
  const catalogPath = join(root, "mcp.json");
  await writeFile(catalogPath, JSON.stringify({ version: 1, servers: { fake: { type: "stdio", command: "fake" } } }), "utf8");
  await mkdir(dirname(projectMcpStatePath(primary)), { recursive: true });
  await writeFile(projectMcpStatePath(primary), JSON.stringify({ version: 1, enabledServers: ["fake"] }), "utf8");
  await mkdir(workspace, { recursive: true });
  await symlink(join(primary, ".pi"), join(workspace, ".pi"), "dir");

  const tools: Parameters<PiToolApi["registerTool"]>[0][] = [];
  await registerMcpTools({ registerTool: (tool) => tools.push(tool) }, workspace, {
    catalogPath,
    createClient: async () => fakeClient(),
  });

  assert.equal(tools[0]?.name, "mcp_fake_echo");
});

test("registerMcpTools errors clearly when enabled server is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-sessions-mcp-register-"));
  const project = join(root, "project");
  const catalogPath = join(root, "mcp.json");
  await writeFile(catalogPath, JSON.stringify({ version: 1, servers: {} }), "utf8");
  await mkdir(dirname(projectMcpStatePath(project)), { recursive: true });
  await writeFile(projectMcpStatePath(project), JSON.stringify({ version: 1, enabledServers: ["missing"] }), "utf8");

  await assert.rejects(
    registerMcpTools({ registerTool: () => {} }, project, { catalogPath, createClient: async () => fakeClient() }),
    /enabled but missing/,
  );
});

test("registerMcpTools registers pooled tools through pool client", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-sessions-mcp-register-"));
  const project = join(root, "project");
  const catalogPath = join(root, "mcp.json");
  await writeFile(catalogPath, JSON.stringify({ version: 1, servers: { fake: { type: "stdio", command: "fake", pool: true } } }), "utf8");
  await mkdir(dirname(projectMcpStatePath(project)), { recursive: true });
  await writeFile(projectMcpStatePath(project), JSON.stringify({ version: 1, enabledServers: ["fake"] }), "utf8");

  const tools: Parameters<PiToolApi["registerTool"]>[0][] = [];
  await registerMcpTools({ registerTool: (tool) => tools.push(tool) }, project, {
    catalogPath,
    createPoolClient: () => ({
      async listTools() { return [{ name: "echo", inputSchema: { type: "object", properties: {} } }]; },
      async callTool() { return { content: [{ type: "text", text: "pooled-ok" }] }; },
    }),
  });

  assert.equal(tools[0]?.name, "mcp_fake_echo");
  assert.equal((await tools[0]?.execute("id", {}, undefined))?.content[0]?.text, "pooled-ok");
});
