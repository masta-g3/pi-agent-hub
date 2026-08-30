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
  const controller = { refresh: () => refresh.promise, snapshot: () => ({ selectedId: undefined }) };
  const tui = { requestRender: () => {} };

  const loop = startRefreshLoop(controller as never, tui as never);
  const stopping = loop.stop().then(() => { stopResolved = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopResolved, false);

  refresh.resolve();
  await stopping;
  assert.equal(stopResolved, true);
});

test("refresh requests share the in-flight loop tick", async () => {
  const refresh = deferred();
  let refreshes = 0;
  const controller = { refresh: () => { refreshes += 1; return refresh.promise; }, snapshot: () => ({ selectedId: undefined }) };
  const tui = { requestRender: () => {} };

  const loop = startRefreshLoop(controller as never, tui as never);
  const requested = loop.refresh();
  assert.equal(refreshes, 1);
  refresh.resolve();
  await requested;
  await loop.stop();
});

test("explicit refresh requests surface observation failures", async () => {
  const controller = { refresh: async () => { throw new Error("registry temporarily unavailable"); }, snapshot: () => ({ selectedId: undefined }) };
  const tui = { requestRender: () => {} };

  const loop = startRefreshLoop(controller as never, tui as never);
  await assert.rejects(() => loop.refresh(), /registry temporarily unavailable/);
  await assert.doesNotReject(() => loop.stop());
});

test("refresh observer runs only after a successful refresh and before render", async () => {
  const events: string[] = [];
  const controller = {
    refresh: async () => { events.push("refresh"); },
    snapshot: () => ({ selectedId: "api" }),
  };
  const tui = { requestRender: () => { events.push("render"); } };
  const loop = startRefreshLoop(controller as never, tui as never, async (snapshot) => { events.push(`observe:${snapshot.selectedId}`); });
  await loop.refresh();
  await loop.stop();
  assert.deepEqual(events, ["refresh", "observe:api", "render"]);

  events.length = 0;
  const failing = startRefreshLoop({ refresh: async () => { events.push("refresh"); throw new Error("failed"); }, snapshot: controller.snapshot } as never, tui as never, async () => { events.push("observe"); });
  await assert.rejects(() => failing.refresh(), /failed/);
  await failing.stop();
  assert.deepEqual(events, ["refresh", "render"]);
});

test("refresh loop never captures raw pane output", async () => {
  let captures = 0;
  const controller = {
    refresh: async () => {},
    snapshot: () => ({ selectedId: "missing" }),
    refreshPreview: async () => { captures += 1; },
  };
  const tui = { requestRender: () => {} };

  const loop = startRefreshLoop(controller as never, tui as never);
  await new Promise((resolve) => setImmediate(resolve));
  await loop.stop();
  assert.equal(captures, 0);
});

test("refresh loop keeps running when registry refresh fails", async () => {
  const controller = { refresh: async () => { throw new Error("registry temporarily unavailable"); }, snapshot: () => ({ selectedId: undefined }) };
  let renderRequests = 0;
  const tui = { requestRender: () => { renderRequests += 1; } };

  const loop = startRefreshLoop(controller as never, tui as never);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.doesNotReject(() => loop.stop());
  assert.equal(renderRequests, 1);
});
