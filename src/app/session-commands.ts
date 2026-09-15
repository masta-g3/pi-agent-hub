import { loadRegistry } from "../core/registry.js";
import { isSubagentSession } from "../core/session-tree.js";
import { configureManagedSessionStatusBar, sessionExists } from "../core/tmux.js";
import { readHeartbeat } from "../core/heartbeat.js";
import { isFreshHeartbeat } from "../core/status.js";
import { NAME_COMMAND_TIMEOUT_MS, publishNameCommand } from "../core/name-command.js";
import { loadManagedSessionTheme } from "../tui/theme.js";
import { resolveSession } from "./delete-session.js";

export {
  managedPiCommand,
} from "./session-lifecycle.js";
export type { ForkInput, SessionInput } from "./session-lifecycle.js";

export async function renameManagedSession(id: string, title: string): Promise<void> {
  const registry = await loadRegistry();
  const session = resolveSession(registry, id);
  const name = title.trim();
  if (isSubagentSession(session)) throw new Error("subagent rows cannot be renamed");
  if (session.status === "stopped" || session.status === "error") throw new Error("restart the Pi session before renaming");
  if (!name || /[\r\n]/.test(name)) throw new Error("name must be one nonblank line");
  const heartbeat = await readHeartbeat(session.id);
  if (!isFreshHeartbeat(heartbeat, Date.now()) || !heartbeat?.piSessionId) {
    throw new Error("Pi is not responding; open the session and retry renaming");
  }
  if (heartbeat.piSessionName === name) return;
  if (heartbeat.context?.ticket) throw new Error("linked ticket owns the session name");
  const command = await publishNameCommand(session.id, heartbeat.piSessionId, name);
  while (Date.now() - command.updatedAt < NAME_COMMAND_TIMEOUT_MS) {
    const latest = await readHeartbeat(session.id);
    if (latest?.context?.ticket) throw new Error("linked ticket owns the session name");
    if (latest?.piSessionId !== command.piSessionId || latest.state === "shutdown") {
      throw new Error("Pi session changed while renaming; retry");
    }
    if (latest.updatedAt >= command.updatedAt && latest.piSessionName === name) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Rename was not confirmed; reload the Hub extension in Pi and retry");
}

export async function syncManagedSessionStatusBars(hiddenSessions: ReadonlySet<string> = new Set()): Promise<void> {
  const registry = await loadRegistry();
  for (const session of registry.sessions) {
    if (await sessionExists(session.tmuxSession)) {
      await configureManagedSessionStatusBar({
        name: session.tmuxSession,
        title: session.title,
        cwd: session.cwd,
        theme: await loadManagedSessionTheme(session),
        visible: !hiddenSessions.has(session.tmuxSession),
      });
    }
  }
}
