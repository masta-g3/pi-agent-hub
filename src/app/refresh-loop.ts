import type { TUI } from "@mariozechner/pi-tui";
import type { SessionsController } from "./controller.js";

export interface RefreshLoopHandle {
  stop(): Promise<void>;
}

export function startRefreshLoop(controller: SessionsController, tui: TUI): RefreshLoopHandle {
  let lastPreviewId: string | undefined;
  let lastPreviewAt = 0;
  let inFlight: Promise<void> | undefined;

  const tick = async () => {
    await controller.refresh();
    const selectedId = controller.snapshot().selectedId;
    const now = Date.now();
    if (selectedId !== lastPreviewId || now - lastPreviewAt > 2_000) {
      await controller.refreshPreview();
      lastPreviewId = selectedId;
      lastPreviewAt = now;
    }
    tui.requestRender();
  };

  const runTick = () => {
    if (inFlight) return;
    inFlight = tick().finally(() => { inFlight = undefined; });
  };

  const timer = setInterval(runTick, 1_000);
  runTick();
  return {
    async stop() {
      clearInterval(timer);
      await inFlight;
    },
  };
}
