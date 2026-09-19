import test from "node:test";
import assert from "node:assert/strict";
import { forkResetReady } from "../src/extension/fork-compact.js";

const attempt = "571b5a3d-55fa-4c90-b5cc-fc2f907785d1";
const entry = (customType: string, data: unknown) => ({ type: "custom", customType, data });
const context = () => entry("pi-agent-hub-context", { version: 1, updatedAt: 1 });
const workflow = () => entry("workflow-runtime", { updatedAt: 1, steps: [{ id: "build", short: "B", label: "Build" }] });
const receipt = (data = {}) => entry("workflow-runtime-reset", { version: 1, id: attempt, status: "ready", ...data });

test("reset readiness requires a matching receipt after both cleared producer snapshots", () => {
  assert.equal(forkResetReady([], attempt), false);
  assert.equal(forkResetReady([context(), workflow()], attempt), false);
  assert.equal(forkResetReady([receipt()], attempt), false);
  assert.equal(forkResetReady([receipt(), context(), workflow()], attempt), false);
  assert.equal(forkResetReady([context(), workflow(), receipt()], attempt), true);
  for (const data of [{ id: "another-attempt" }, { version: 2 }, { status: "pending" }]) {
    assert.equal(forkResetReady([context(), workflow(), receipt(data)], attempt), false);
  }
});

test("reset readiness rejects contradictory or malformed snapshots, including relinking after receipt", () => {
  for (const data of [null, [], {}, { version: 2, updatedAt: 1 }, { version: 1, updatedAt: 1, ticket: { id: "old-001" } }, { version: 1, updatedAt: 1, attention: { kind: "ready" } }]) {
    assert.equal(forkResetReady([entry("pi-agent-hub-context", data), workflow(), receipt()], attempt), false);
    assert.equal(forkResetReady([context(), workflow(), receipt(), entry("pi-agent-hub-context", data)], attempt), false);
  }
  for (const field of ["ticketId", "activeStep", "plan", "execution", "activity", "currentStepComplete", "activeMode"]) {
    const linked = entry("workflow-runtime", { updatedAt: 1, [field]: "old-task" });
    assert.equal(forkResetReady([context(), linked, receipt()], attempt), false);
    assert.equal(forkResetReady([context(), workflow(), receipt(), linked], attempt), false);
  }
  assert.equal(forkResetReady([context(), workflow(), receipt(), context(), workflow()], attempt), true);
});
