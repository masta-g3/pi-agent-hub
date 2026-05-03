import test from "node:test";
import assert from "node:assert/strict";
import { attachPlan, restartConfirmMessage } from "../src/app/actions.js";
import type { CenterSession } from "../src/core/types.js";

const session: CenterSession = {
  id: "s1",
  title: "api",
  cwd: "/tmp/api",
  group: "default",
  tmuxSession: "pi-center-s1",
  status: "idle",
  createdAt: 1,
  updatedAt: 1,
};

test("attach outside tmux uses tmux attach-session", () => {
  assert.deepEqual(attachPlan(session, {}), { type: "attach", command: "tmux", args: ["attach-session", "-t", "pi-center-s1"] });
});

test("attach inside tmux gives switch-client instruction", () => {
  const plan = attachPlan(session, { TMUX: "/tmp/tmux" });
  assert.deepEqual(plan, {
    type: "inside-tmux",
    command: "tmux switch-client -t pi-center-s1",
    message: "inside tmux: tmux switch-client -t pi-center-s1",
  });
});

test("restart confirmation copy is explicit", () => {
  assert.equal(restartConfirmMessage("api"), "press r again to restart api");
});
