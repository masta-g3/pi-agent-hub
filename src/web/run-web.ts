import { SessionsController } from "../app/controller.js";
import { createRegistryMutator, startRefreshLoop, type RefreshLoopHandle } from "../app/refresh-loop.js";
import { buildNewFormContext } from "../app/run-tui.js";
import { loadSessionConversation, loadSessionInteractionState, runSessionShortcut, sendSessionMessage, submitSessionAnswer } from "../app/session-interaction.js";
import { addManagedSession, restartManagedSession } from "../app/session-lifecycle.js";
import { effectiveDashboardShortcuts } from "../core/config.js";
import { CLI_COMMAND } from "../core/names.js";
import { loadRepoHistory, mergeRepoCwds, rankedRepoCwds } from "../core/repo-history.js";
import { sessionWorktrees } from "../core/worktree.js";
import { createPushSender, createRequestNotifier } from "./push.js";
import { createWebServer, webAssetsDir } from "./server.js";

export const DEFAULT_WEB_PORT = 4747;
const NEW_SESSION_REPOS = 20;
const RESUME_SETTLE_MS = 60_000;

/** A headless dashboard: the same refresh and registry bookkeeping as the TUI, serving the phone inbox on loopback. */
export async function runWeb(options: { port?: number } = {}): Promise<void> {
  const port = options.port ?? DEFAULT_WEB_PORT;
  const controller = new SessionsController();
  await controller.refresh();

  const shortcuts = await effectiveDashboardShortcuts();
  /** When each session was last resumed from the phone. */
  const resumed = new Map<string, number>();
  let historyCwds = rankedRepoCwds((await loadRepoHistory()).repos);
  /**
   * The dashboard's known repositories, without any Hub-owned worktree, so the phone starts sessions only in source repos.
   * No launch directory: where the headless server was started says nothing about the user's projects.
   */
  const newSessionOptions = () => {
    const sessions = controller.snapshot().registry.sessions;
    const worktrees = new Set(sessions.flatMap((session) => sessionWorktrees(session).map((worktree) => worktree.path)));
    const repos = buildNewFormContext({ cwd: "", sessions, historyCwds }).knownCwds?.filter((cwd) => !worktrees.has(cwd)).slice(0, NEW_SESSION_REPOS) ?? [];
    const groups = [...new Set(sessions.filter((session) => session.kind !== "subagent").map((session) => session.group))];
    return { repos, groups };
  };

  const push = createPushSender();
  const notifier = createRequestNotifier(controller.snapshot().sessions, (message) => {
    // Push is best effort; a failed delivery must not stop the refresh loop.
    push.notify(message).then(
      (failures) => { for (const failure of failures) console.error(`${CLI_COMMAND} web: push failed: ${failure}`); },
      (error: unknown) => { console.error(`${CLI_COMMAND} web: push failed: ${error instanceof Error ? error.message : String(error)}`); },
    );
  });

  let stopped = false;
  let stopLoop: RefreshLoopHandle | undefined;
  const web = createWebServer({
    staticDir: webAssetsDir(),
    sessions: () => controller.snapshot().sessions,
    loadState: loadSessionInteractionState,
    loadConversation: (target, options) => loadSessionConversation(target, { ...options, limit: 20 }),
    submitAnswer: submitSessionAnswer,
    sendMessage: sendSessionMessage,
    acknowledge: (id, requestId, dismiss, expected) => mutate(async () => { await controller.acknowledgeSession(id, Date.now(), requestId, dismiss, expected); }),
    touch: (id) => mutate(() => controller.touchSession(id)),
    shortcuts,
    runShortcut: runSessionShortcut,
    resume: (id, expected) => lifecycle(async () => {
      // Checked again inside the queue: a second tap must not stop a session the first tap restarted.
      await controller.refresh();
      const row = controller.snapshot().sessions.find((session) => session.id === id);
      if (!row || (row.status !== "stopped" && row.status !== "error") || row.piSessionId !== expected.piSessionId) {
        throw new Error("Session changed; reload the page");
      }
      // The old Pi's heartbeat can read as stopped until the new Pi reports, so a repeat tap could kill the new Pi.
      if (Date.now() - (resumed.get(id) ?? 0) < RESUME_SETTLE_MS) throw new Error("Session is starting; try again in a minute");
      await restartManagedSession(id);
      resumed.set(id, Date.now());
    }),
    newSession: {
      options: newSessionOptions,
      create: (input) => lifecycle(async () => {
        const created = await addManagedSession(input);
        historyCwds = mergeRepoCwds([created.cwd], historyCwds);
        return created.id;
      }),
    },
    // Labels only: tmux and Pi keep running. The terminal dashboard closes a pin when it sees the archive.
    lifecycle: {
      archive: (id, closure, expected) => lifecycle(async () => {
        const target = { piSessionId: expected.piSessionId, strict: true, ...(expected.section ? { section: expected.section } : {}) };
        await (closure ? controller.closeSession(id, closure, target) : controller.moveSessionToBucket(id, "archived", undefined, target));
      }),
      backlog: (id, expected) => lifecycle(async () => {
        await controller.moveSessionToBucket(id, "backlog", undefined, { piSessionId: expected.piSessionId, strict: true, ...(expected.section ? { section: expected.section } : {}) });
      }),
      restore: (id, expected) => lifecycle(async () => {
        if (!expected.bucket) throw new Error("Session changed; reload the page");
        await controller.restoreSessionBucket(id, undefined, { piSessionId: expected.piSessionId, strict: true, bucket: expected.bucket, ...(expected.closure ? { closure: expected.closure } : {}) });
      }),
    },
    usage: () => controller.snapshot().usage,
    push,
  });
  const afterRefresh = () => {
    web.publish();
    notifier.observe(controller.snapshot().sessions);
  };
  const render = { requestRender() {} };
  const mutate = createRegistryMutator({
    async pause() {
      const loop = stopLoop;
      stopLoop = undefined;
      await loop?.stop();
    },
    resume() { if (!stopped) stopLoop = startRefreshLoop(controller, render, afterRefresh); },
    async refresh() { await controller.refresh(); afterRefresh(); },
    render() {},
  });

  /** A lifecycle result stands even when the refresh after it fails: that refresh is bookkeeping, and a false rejection invites a duplicate. */
  function lifecycle<T>(action: () => Promise<T>): Promise<T> {
    let done = false;
    let result: T;
    return mutate(async () => { result = await action(); done = true; return result; })
      .catch((error: unknown) => { if (done) return result; throw error; });
  }

  await new Promise<void>((resolve, reject) => {
    web.server.once("error", reject);
    web.server.listen(port, "127.0.0.1", resolve);
  });
  stopLoop = startRefreshLoop(controller, render, afterRefresh);
  console.log(`${CLI_COMMAND} web: http://127.0.0.1:${port}
Share with your own devices:  tailscale serve --bg ${port}
Stop sharing:                 tailscale serve reset`);

  await new Promise<void>((resolve) => {
    const stop = () => { stopped = true; resolve(); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  await stopLoop?.stop();
  await web.close();
}
