import test from "node:test";
import assert from "node:assert/strict";
import { CenterController } from "../src/app/controller.js";
import type { CenterSession } from "../src/core/types.js";

function session(status: CenterSession["status"]): CenterSession {
  return {
    id: "s1",
    title: "api",
    cwd: "/tmp/api",
    group: "default",
    tmuxSession: "pi-center-missing",
    status,
    createdAt: 1,
    updatedAt: 1,
  };
}

test("refreshPreview skips sessions with error status", async () => {
  const controller = new CenterController({ version: 1, sessions: [session("error")] });

  await controller.refreshPreview();

  assert.equal(controller.snapshot().preview, "");
});
