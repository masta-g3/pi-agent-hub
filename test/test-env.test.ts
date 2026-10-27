import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";

test("test processes never inherit live Hub or subagent state", () => {
  assert.deepEqual(Object.keys(process.env).filter((key) => /^PI_(AGENT_HUB|TMUX_SUBAGENTS|SUBAGENT)_/.test(key)), []);
  assert.ok(realpathSync(process.env.PI_CODING_AGENT_DIR!).startsWith(realpathSync(tmpdir())));
});
