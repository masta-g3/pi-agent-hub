import test from "node:test";
import assert from "node:assert/strict";
import { cliTuiCommand } from "../src/core/cli-command.js";

test("dashboard tui command uses current node and CLI file", () => {
  const command = cliTuiCommand({ nodePath: "/opt/node bin/node", cliPath: "/pkg/pi-agent-hub/dist/cli's.js" });

  assert.equal(command, "'/opt/node bin/node' '/pkg/pi-agent-hub/dist/cli'\"'\"'s.js' tui");
  assert.doesNotMatch(command, /^pi-hub tui$/);
});
