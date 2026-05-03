import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sessionsStateDir } from "../core/paths.js";
import { HEARTBEAT_INTERVAL_MS } from "../core/status.js";
import { registerMcpTools } from "../mcp/register-tools.js";
import type { Heartbeat } from "../core/types.js";

type PiContext = {
  cwd: string;
  sessionManager?: {
    getSessionFile?: () => string | undefined;
    getSessionId?: () => string | undefined;
  };
};

export default function piSessionsExtension(pi: ExtensionAPI) {
  let currentState: Heartbeat["state"] = "starting";
  let stateSince = Date.now();
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let mcpCleanup: (() => Promise<void>) | undefined;

  async function heartbeat(state: Heartbeat["state"], ctx: PiContext, message?: string) {
    const id = process.env.PI_SESSIONS_SESSION_ID;
    if (!id) return;
    if (state !== currentState) {
      currentState = state;
      stateSince = Date.now();
    }
    const file = join(process.env.PI_SESSIONS_DIR ?? sessionsStateDir(), "heartbeats", `${id}.json`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify({
      managedSessionId: id,
      cwd: ctx.cwd,
      piSessionFile: ctx.sessionManager?.getSessionFile?.(),
      piSessionId: ctx.sessionManager?.getSessionId?.(),
      state,
      stateSince,
      message,
      updatedAt: Date.now(),
    } satisfies Heartbeat, null, 2)}\n`, "utf8");
  }

  pi.on("session_start", async (_event, ctx) => {
    await heartbeat("waiting", ctx as PiContext);
    heartbeatTimer = setInterval(() => void heartbeat(currentState, ctx as PiContext), HEARTBEAT_INTERVAL_MS);
    mcpCleanup = await registerMcpTools(pi, (ctx as PiContext).cwd);
  });

  pi.on("agent_start", async (_event, ctx) => heartbeat("running", ctx as PiContext));
  pi.on("agent_end", async (_event, ctx) => heartbeat("waiting", ctx as PiContext));
  pi.on("session_shutdown", async (_event, ctx) => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await mcpCleanup?.();
    await heartbeat("shutdown", ctx as PiContext);
  });
}
