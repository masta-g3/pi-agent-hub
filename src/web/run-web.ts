import { SessionsController } from "../app/controller.js";
import { createRegistryMutator, startRefreshLoop, type RefreshLoopHandle } from "../app/refresh-loop.js";
import { loadSessionConversation, loadSessionInteractionState, sendSessionMessage, submitSessionAnswer } from "../app/session-interaction.js";
import { CLI_COMMAND } from "../core/names.js";
import { createPushSender, createRequestNotifier } from "./push.js";
import { createWebServer, webAssetsDir } from "./server.js";

export const DEFAULT_WEB_PORT = 4747;

/** A headless dashboard: the same refresh and registry bookkeeping as the TUI, serving the phone inbox on loopback. */
export async function runWeb(options: { port?: number } = {}): Promise<void> {
  const port = options.port ?? DEFAULT_WEB_PORT;
  const controller = new SessionsController();
  await controller.refresh();

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
    loadConversation: (target) => loadSessionConversation(target, { limit: 20 }),
    submitAnswer: submitSessionAnswer,
    sendMessage: sendSessionMessage,
    acknowledge: (id, requestId, dismiss, expected) => mutate(async () => { await controller.acknowledgeSession(id, Date.now(), requestId, dismiss, expected); }),
    touch: (id) => mutate(() => controller.touchSession(id)),
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
