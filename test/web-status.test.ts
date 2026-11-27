import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveUntilShutdown } from "../src/web/run-web.js";
import { clearWebStatus, readWebStatuses, webStatusDir, writeWebStatus, type WebStatus } from "../src/core/web-status.js";

async function withState(fn: (env: NodeJS.ProcessEnv) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-hub-web-status-"));
  try { await fn({ PI_AGENT_HUB_DIR: dir }); } finally { await rm(dir, { recursive: true, force: true }); }
}

const status = (pid: number, port: number, instanceId = `i-${pid}`): WebStatus => ({ pid, port, instanceId, startedAt: 1 });

test("reads back verified records, one per server, ordered by port", async () => {
  await withState(async (env) => {
    await writeWebStatus(status(20, 4800), env);
    await writeWebStatus(status(10, 4747), env);
    const probed: number[] = [];
    const read = await readWebStatuses(env, { alive: () => true, probe: async (port) => { probed.push(port); return port === 4747 ? "i-10" : "i-20"; } });
    assert.deepEqual(read, [status(10, 4747), status(20, 4800)]);
    assert.deepEqual(probed.sort(), [4747, 4800]);
  });
});

test("a dead pid, a foreign listener and a malformed record all read as not running", async () => {
  await withState(async (env) => {
    await writeWebStatus(status(1, 4747), env);
    await writeWebStatus(status(2, 4748), env);
    await writeWebStatus(status(3, 4749), env);
    await writeFile(join(webStatusDir(env), "4.json"), "{not json");
    await writeFile(join(webStatusDir(env), "5.json"), JSON.stringify({ version: 1, pid: 5, port: "x", instanceId: "i-5", startedAt: 1 }));
    const read = await readWebStatuses(env, {
      alive: (pid) => pid !== 1,
      // pid 2's port answers with another instance (pid reuse); pid 3's port does not answer.
      probe: async (port) => port === 4748 ? "someone-else" : undefined,
    });
    assert.deepEqual(read, []);
    // Only the dead pid's record is removed; a live pid may still be starting or belong to a busy server.
    assert.deepEqual((await readdir(webStatusDir(env))).sort(), ["2.json", "3.json", "4.json", "5.json"]);
  });
});

test("records with a non-positive pid, a pid naming another file, or a bad port are ignored and never pruned", async () => {
  await withState(async (env) => {
    const write = (name: string, value: unknown) => writeFile(join(webStatusDir(env), name), JSON.stringify({ version: 1, ...(value as object) }));
    await writeWebStatus(status(7, 4747), env);
    await write("0.json", status(0, 4748));
    await write("8.json", status(-1, 4749));
    // Claims pid 7: reading it must not delete or report 7's real record.
    await write("9.json", status(7, 4750, "i-7"));
    await write("10.json", status(10, 70_000));
    const checked: number[] = [];
    const read = await readWebStatuses(env, { alive: (pid) => { checked.push(pid); return false; }, probe: async () => assert.fail("no probe") });
    assert.deepEqual(read, []);
    // Only pid 7's own record was checked, and only it was pruned as dead.
    assert.deepEqual(checked, [7]);
    assert.deepEqual((await readdir(webStatusDir(env))).sort(), ["0.json", "10.json", "8.json", "9.json"]);
  });
});

test("a missing state directory reads as not running", async () => {
  await withState(async (env) => {
    assert.deepEqual(await readWebStatuses(env, { alive: () => true, probe: async () => "x" }), []);
  });
});

test("clearing removes only the given pid's record", async () => {
  await withState(async (env) => {
    await writeWebStatus(status(1, 4747), env);
    await writeWebStatus(status(2, 4748), env);
    await clearWebStatus(1, env);
    assert.deepEqual(await readdir(webStatusDir(env)), ["2.json"]);
    await clearWebStatus(1, env);
  });
});

function steps(order: string[], overrides: Partial<Parameters<typeof serveUntilShutdown>[0]> = {}) {
  const shutdown = new AbortController();
  return {
    shutdown,
    steps: {
      signal: shutdown.signal,
      listen: async () => { order.push("listen"); },
      publish: async () => { order.push("publish"); },
      started: () => { order.push("started"); },
      cleanup: async () => { order.push("cleanup"); },
      ...overrides,
    },
  };
}

test("a failed publication closes the listener and rethrows", async () => {
  const order: string[] = [];
  const { steps: run } = steps(order, { publish: async () => { order.push("publish"); throw new Error("disk full"); } });
  await assert.rejects(serveUntilShutdown(run), /disk full/u);
  assert.deepEqual(order, ["listen", "publish", "cleanup"]);
});

test("a shutdown request during startup waits for publication, then cleans up without serving", async () => {
  const order: string[] = [];
  let finishPublish!: () => void;
  const { shutdown, steps: run } = steps(order, { publish: () => new Promise<void>((done) => { order.push("publish"); finishPublish = done; }) });
  const served = serveUntilShutdown(run);
  await new Promise((done) => setImmediate(done));
  shutdown.abort();
  finishPublish();
  await served;
  assert.deepEqual(order, ["listen", "publish", "cleanup"]);
});

test("a failed listen still runs cleanup", async () => {
  const order: string[] = [];
  const { steps: run } = steps(order, { listen: async () => { order.push("listen"); throw new Error("EADDRINUSE"); } });
  await assert.rejects(serveUntilShutdown(run), /EADDRINUSE/u);
  assert.deepEqual(order, ["listen", "cleanup"]);
});

test("serves until the shutdown signal, then cleans up once", async () => {
  const order: string[] = [];
  const { shutdown, steps: run } = steps(order);
  const served = serveUntilShutdown(run);
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(order, ["listen", "publish", "started"]);
  shutdown.abort();
  await served;
  assert.deepEqual(order, ["listen", "publish", "started", "cleanup"]);
});

test("the instance probe does not follow a redirect to another server", async () => {
  const { createServer } = await import("node:http");
  const target = createServer((_req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ instanceId: "i-1" })); });
  await new Promise<void>((done) => target.listen(0, "127.0.0.1", done));
  const targetPort = (target.address() as { port: number }).port;
  const redirect = createServer((_req, res) => { res.writeHead(302, { Location: `http://127.0.0.1:${targetPort}/api/instance` }); res.end(); });
  await new Promise<void>((done) => redirect.listen(0, "127.0.0.1", done));
  const redirectPort = (redirect.address() as { port: number }).port;
  try {
    await withState(async (env) => {
      await writeWebStatus(status(1, redirectPort), env);
      await writeWebStatus({ ...status(2, targetPort), instanceId: "i-1" }, env);
      // Only the server that answers directly is verified.
      assert.deepEqual((await readWebStatuses(env, { alive: () => true })).map((s) => s.pid), [2]);
    });
  } finally {
    target.close(); redirect.close();
  }
});
