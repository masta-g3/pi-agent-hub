import test from "node:test";
import assert from "node:assert/strict";
import { SessionsController } from "../src/app/controller.js";
import type { ManagedSession } from "../src/core/types.js";

function session(status: ManagedSession["status"], overrides: Partial<ManagedSession> = {}): ManagedSession {
  const id = overrides.id ?? "s1";
  const title = overrides.title ?? "api";
  return {
    id,
    title,
    cwd: `/tmp/${title}`,
    group: overrides.group ?? "default",
    tmuxSession: `pi-sessions-${id}`,
    status,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test("refreshPreview skips sessions with error status", async () => {
  const controller = new SessionsController({ version: 1, sessions: [session("error")] });

  await controller.refreshPreview();

  assert.equal(controller.snapshot().preview, "");
});

test("movement follows rendered group status title order, not registry order", () => {
  const controller = new SessionsController({
    version: 1,
    sessions: [
      session("idle", { id: "work", title: "work", group: "work" }),
      session("idle", { id: "b", title: "b", group: "default" }),
      session("idle", { id: "a", title: "a", group: "default" }),
    ],
  });

  assert.equal(controller.snapshot().selectedId, "a");
  controller.move(1);
  assert.equal(controller.snapshot().selectedId, "b");
  controller.move(1);
  assert.equal(controller.snapshot().selectedId, "work");
  controller.move(-1);
  assert.equal(controller.snapshot().selectedId, "b");
});
