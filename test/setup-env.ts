import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests often run inside managed Pi sessions or subagents. Inherited routing
// variables would switch the extension into child mode or reach live Hub state.
for (const key of Object.keys(process.env)) {
  if (/^PI_(AGENT_HUB|TMUX_SUBAGENTS|SUBAGENT)_/.test(key)) delete process.env[key];
}
const agentDir = mkdtempSync(join(tmpdir(), "pi-agent-hub-test-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
process.on("exit", () => rmSync(agentDir, { recursive: true, force: true }));
