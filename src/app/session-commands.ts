import { loadRegistry } from "../core/registry.js";
import { isSubagentSession } from "../core/session-tree.js";
import { configureManagedSessionStatusBar, sendTextToSession, sessionExists } from "../core/tmux.js";
import { loadManagedSessionTheme } from "../tui/theme.js";
import { assertManagedSessionReady } from "./session-lifecycle.js";

export {
  managedPiCommand,
} from "./session-lifecycle.js";
export type { ForkInput, SessionInput } from "./session-lifecycle.js";

export async function renameManagedSession(id: string, title: string): Promise<void> {
  const session = await assertManagedSessionReady(id);
  const name = title.trim();
  if (isSubagentSession(session)) throw new Error("subagent rows cannot be renamed");
  if (session.status === "stopped" || session.status === "error") throw new Error("restart the Pi session before renaming");
  if (!name || /[\r\n]/.test(name)) throw new Error("name must be one nonblank line");
  await sendTextToSession(session.tmuxSession, `/name ${name}`);
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
