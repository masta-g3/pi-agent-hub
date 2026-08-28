import type { TUI } from "@earendil-works/pi-tui";
import type { SessionsController } from "./controller.js";

export interface RefreshLoopHandle {
  refresh(): Promise<void>;
  stop(): Promise<void>;
}

export function startRefreshLoop(controller: SessionsController, tui: TUI): RefreshLoopHandle {
  let inFlight: Promise<void> | undefined;

  const tick = async () => {
    await controller.refresh();
    tui.requestRender();
  };

  const runTick = (): Promise<void> => {
    if (inFlight) return inFlight;
    inFlight = tick().finally(() => { inFlight = undefined; });
    return inFlight;
  };
  const runPeriodicTick = () => { void runTick().catch(() => { tui.requestRender(); }); };

  const timer = setInterval(runPeriodicTick, 1_000);
  runPeriodicTick();
  return {
    refresh: runTick,
    async stop() {
      clearInterval(timer);
      await inFlight?.catch(() => {});
    },
  };
}
