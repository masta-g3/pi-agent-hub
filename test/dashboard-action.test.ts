import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consumeDashboardAction, dashboardActionPath } from "../src/app/dashboard-action.js";

test("dashboardActionPath stores return actions under return-key state", () => {
  assert.equal(dashboardActionPath("/tmp/hub-state"), "/tmp/hub-state/return-key/dashboard-action.json");
});

test("consumeDashboardAction returns undefined when no action file exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-action-"));

  assert.equal(await consumeDashboardAction(join(root, "missing.json")), undefined);
});

test("consumeDashboardAction consumes a valid rename action", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-action-"));
  const path = join(root, "dashboard-action.json");
  await writeFile(path, JSON.stringify({ action: "rename", tmuxSession: "pi-agent-hub-session" }), "utf8");

  assert.deepEqual(await consumeDashboardAction(path), { action: "rename", tmuxSession: "pi-agent-hub-session" });
  await assert.rejects(() => readFile(path, "utf8"), /ENOENT/);
});

test("consumeDashboardAction consumes a valid Alt+Q return receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-action-"));
  const path = join(root, "dashboard-action.json");
  await writeFile(path, JSON.stringify({ action: "return", key: "alt-q" }), "utf8");

  assert.deepEqual(await consumeDashboardAction(path), { action: "return", key: "alt-q" });
  await assert.rejects(() => readFile(path, "utf8"), /ENOENT/);
});

test("consumeDashboardAction consumes invalid actions without executing them", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-action-"));
  const path = join(root, "dashboard-action.json");
  await writeFile(path, JSON.stringify({ action: "return", key: "ctrl-q" }), "utf8");

  assert.equal(await consumeDashboardAction(path), undefined);
  await assert.rejects(() => readFile(path, "utf8"), /ENOENT/);
});
