import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { mcpResultToText, normalizeMcpInputSchema } from "../src/mcp/adapter.js";
import { setProjectMcpServer, setProjectMcpServers, validateMcpCatalog } from "../src/mcp/config.js";
import { toPiToolName } from "../src/mcp/tool-names.js";

test("catalog validation accepts stdio and HTTP direct servers", () => {
  assert.doesNotThrow(() => validateMcpCatalog({ version: 1, servers: {
    fs: { type: "stdio", command: "mcp-filesystem" },
    docs: { type: "http", url: "https://example.test/mcp" },
  } }));
});

test("catalog validation rejects pool true on HTTP servers", () => {
  assert.throws(() => validateMcpCatalog({ version: 1, servers: {
    docs: { type: "http", url: "https://example.test/mcp", pool: true as false },
  } }), /cannot use pool/);
});

test("project enable disable persists sorted state", async () => {
  const project = await mkdtemp(join(tmpdir(), "pi-sessions-mcp-"));
  await setProjectMcpServer(project, "z", true);
  const state = await setProjectMcpServer(project, "a", true);
  assert.deepEqual(state.enabledServers, ["a", "z"]);
  const disabled = await setProjectMcpServer(project, "z", false);
  assert.deepEqual(disabled.enabledServers, ["a"]);
});

test("project bulk enable writes final sorted state once", async () => {
  const project = await mkdtemp(join(tmpdir(), "pi-sessions-mcp-"));
  const state = await setProjectMcpServers(project, ["z", "a", "a"]);
  assert.deepEqual(state.enabledServers, ["a", "z"]);
  const next = await setProjectMcpServers(project, ["docs"]);
  assert.deepEqual(next.enabledServers, ["docs"]);
});

test("tool name sanitizer handles collisions", () => {
  const used = new Set(["mcp_fs_read_file"]);
  assert.equal(toPiToolName("fs", "read file"), "mcp_fs_read_file");
  assert.match(toPiToolName("fs", "read file", used), /^mcp_fs_read_file_[a-z0-9]+$/);
});

test("MCP schema adapter keeps object schemas and empties unknown schemas", () => {
  const objectSchema = { type: "object", properties: { path: { type: "string" } } };
  assert.equal(normalizeMcpInputSchema(objectSchema), objectSchema);
  assert.deepEqual(normalizeMcpInputSchema({ type: "string" }), { type: "object", properties: {} });
});

test("MCP result adapter maps text and errors", () => {
  assert.equal(mcpResultToText({ content: [{ type: "text", text: "ok" }] }), "ok");
  assert.throws(() => mcpResultToText({ isError: true, content: [{ type: "text", text: "bad" }] }), /bad/);
});
