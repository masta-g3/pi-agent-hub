import test from "node:test";
import assert from "node:assert/strict";
import { startRefreshLoop } from "../src/app/refresh-loop.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("refresh loop stop waits for in-flight tick", async () => {
  const refresh = deferred();
  let stopResolved = false;
  const controller = {
    refresh: () => refresh.promise,
    snapshot: () => ({ selectedId: undefined }),
    refreshPreview: async () => {},
  };
  const tui = { requestRender: () => {} };

  const loop = startRefreshLoop(controller as never, tui as never);
  const stopping = loop.stop().then(() => { stopResolved = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopResolved, false);

  refresh.resolve();
  await stopping;
  assert.equal(stopResolved, true);
});

test("refresh loop keeps running when preview refresh fails", async () => {
  const controller = {
    refresh: async () => {},
    snapshot: () => ({ selectedId: "missing" }),
    refreshPreview: async () => { throw new Error("capture failed"); },
  };
  const tui = { requestRender: () => {} };

  const loop = startRefreshLoop(controller as never, tui as never);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.doesNotReject(() => loop.stop());
});

test("refresh loop keeps running when registry refresh fails", async () => {
  const controller = {
    refresh: async () => { throw new Error("registry temporarily unavailable"); },
    snapshot: () => ({ selectedId: undefined }),
    refreshPreview: async () => {},
  };
  let renderRequests = 0;
  const tui = { requestRender: () => { renderRequests += 1; } };

  const loop = startRefreshLoop(controller as never, tui as never);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.doesNotReject(() => loop.stop());
  assert.equal(renderRequests, 1);
});
