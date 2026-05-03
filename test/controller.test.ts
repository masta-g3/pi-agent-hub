import test from "node:test";
import assert from "node:assert/strict";
import { SessionsController } from "../src/app/controller.js";
import type { ManagedSession } from "../src/core/types.js";

function session(status: ManagedSession["status"]): ManagedSession {
  return {
    id: "s1",
    title: "api",
    cwd: "/tmp/api",
    group: "default",
    tmuxSession: "pi-sessions-missing",
    status,
    createdAt: 1,
    updatedAt: 1,
  };
}

test("refreshPreview skips sessions with error status", async () => {
  const controller = new SessionsController({ version: 1, sessions: [session("error")] });

  await controller.refreshPreview();

  assert.equal(controller.snapshot().preview, "");
});
