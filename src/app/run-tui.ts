import { spawn } from "node:child_process";
import { ProcessTerminal, TUI } from "@mariozechner/pi-tui";
import { CenterController } from "./controller.js";
import { startRefreshLoop } from "./refresh-loop.js";
import { CenterView } from "../tui/center-view.js";
import { loadCenterTheme } from "../tui/theme.js";
import { loadProjectSkillsState, setProjectSkills } from "../skills/attach.js";
import { listSkillPool } from "../skills/catalog.js";
import { loadMcpCatalog, loadProjectMcpState, setProjectMcpServers } from "../mcp/config.js";
import { restoreSwitchReturnBinding, switchClientWithReturn } from "../core/tmux.js";

export async function runTui(): Promise<void> {
  const theme = await loadCenterTheme({ cwd: process.cwd() });
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal, false);
  const controller = new CenterController();
  const cwd = process.cwd();
  const skillPool = await listSkillPool();
  const skillState = await loadProjectSkillsState(cwd);
  let enabledSkillNames = new Set(skillState.attached.map((skill) => skill.name));
  const mcpCatalog = await loadMcpCatalog();
  let mcpState = await loadProjectMcpState(cwd);
  let stopLoop: (() => void) | undefined;
  const stop = () => {
    stopLoop?.();
    void restoreSwitchReturnBinding({ onlyOwnerPid: process.pid }).catch(() => {});
    tui.stop();
  };
  const view = new CenterView(controller, stop, {
    attachOutsideTmux(tmuxSession) {
      stop();
      spawn("tmux", ["attach-session", "-t", tmuxSession], { stdio: "inherit" });
    },
    switchInsideTmux(tmuxSession) {
      return switchClientWithReturn({ targetSession: tmuxSession });
    },
    restart(sessionId) {
      spawn(process.execPath, [process.argv[1] ?? "", "restart", sessionId], { stdio: "inherit" });
    },
    createSession(input) {
      spawn(process.execPath, [process.argv[1] ?? "", "add", input.cwd, "-g", input.group, "-t", input.title], { stdio: "inherit" });
    },
    forkSession(sourceSessionId, input) {
      spawn(process.execPath, [process.argv[1] ?? "", "fork", sourceSessionId, "-g", input.group, "-t", input.title], { stdio: "inherit" });
    },
    skills() {
      return skillPool.map((skill) => ({ name: skill.name, enabled: enabledSkillNames.has(skill.name) }));
    },
    async applySkills(items) {
      await setProjectSkills(cwd, items.flatMap((item) => {
        const skill = skillPool.find((entry) => entry.name === item.name);
        return skill ? [{ name: item.name, sourcePath: skill.path, enabled: item.enabled }] : [];
      }));
      enabledSkillNames = new Set(items.filter((item) => item.enabled).map((item) => item.name));
    },
    mcpServers() {
      const enabled = new Set(mcpState.enabledServers);
      return Object.keys(mcpCatalog.servers).sort().map((name) => ({ name, enabled: enabled.has(name) }));
    },
    async applyMcpServers(items) {
      mcpState = await setProjectMcpServers(cwd, items.filter((item) => item.enabled).map((item) => item.name));
    },
    copy(text) {
      if (process.platform !== "darwin") return;
      const child = spawn("pbcopy", [], { stdio: ["pipe", "ignore", "ignore"] });
      child.on("error", () => {});
      child.stdin.on("error", () => {});
      child.stdin.end(text);
    },
  }, theme);
  tui.addChild(view);
  tui.setFocus(view);
  tui.start();
  stopLoop = startRefreshLoop(controller, tui);
}
