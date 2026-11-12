import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname } from "node:path";
import { interactionSocketPath, requestSessionInteraction, type InteractionRequest } from "../src/core/session-interaction.js";

test("client rejects malformed state, history and acceptance payloads before they reach the view", async () => {
  const dir = await mkdtemp("/tmp/hc13.");
  const env = { PI_AGENT_HUB_DIR: dir };
  const path = interactionSocketPath("managed", env);
  await mkdir(dirname(path));
  let result: unknown;
  const server = createServer((socket) => socket.once("data", (data) => {
    const request = JSON.parse(data.toString());
    socket.end(JSON.stringify({ ...request, ok: true, result }) + "\n");
  }));
  await new Promise<void>((resolve) => server.listen(path, resolve));
  const request = (kind: InteractionRequest["kind"]) => requestSessionInteraction({ version: 1, id: "request", managedId: "managed", piSessionId: "pi", instanceId: "instance", kind } as InteractionRequest, env);
  try {
    for (const value of [{}, { pending: [], questionProtocol: "yes" }, { questionProtocol: false, pending: [], questionUnavailableReason: 42 }, { questionProtocol: true, pending: [{ toolCallId: "call", params: { questions: [{ header: "h", question: "Q?", options: [] }] } }] }]) {
      result = value;
      await assert.rejects(request("state"), /Invalid interaction response/);
    }
    result = { branchId: "b", revision: "r", items: [{ id: "i", role: "tool", text: "private output" }] };
    await assert.rejects(request("read"), /Invalid interaction response/);
    result = { branchId: "b", revision: "r", items: [{ id: "i", role: "assistant", text: null }] };
    await assert.rejects(request("read"), /Invalid interaction response/);
    result = { branchId: "b", revision: "r", items: [{ id: "i", role: "assistant", text: "Hi", at: "14:02" }] };
    await assert.rejects(request("read"), /Invalid interaction response/);
    result = { branchId: "b", revision: "r", items: [{ id: "i", role: "assistant", text: "Hi", at: Number.MAX_VALUE * 2 }] };
    await assert.rejects(request("read"), /Invalid interaction response/);
    // An extension from before message times sends none; a current one sends epoch milliseconds.
    result = { branchId: "b", revision: "r", items: [{ id: "i", role: "assistant", text: "Hi" }, { id: "j", role: "user", text: "Yo", at: 1_700_000_000_000 }] };
    assert.deepEqual(await request("read"), result);
    result = { accepted: false };
    await assert.rejects(request("submit-answer"), /Invalid interaction response/);
    result = { accepted: true };
    assert.deepEqual(await request("submit-answer"), result);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
