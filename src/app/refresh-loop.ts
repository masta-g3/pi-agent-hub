import type { SessionsController } from "./controller.js";

export interface RefreshLoopHandle {
  refresh(): Promise<void>;
  stop(): Promise<void>;
}

export function startRefreshLoop(
  controller: SessionsController,
  tui: { requestRender(): void },
  afterRefresh?: (snapshot: ReturnType<SessionsController["snapshot"]>) => void | Promise<void>,
): RefreshLoopHandle {
  let inFlight: Promise<void> | undefined;

  const tick = async () => {
    await controller.refresh();
    await afterRefresh?.(controller.snapshot());
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

export interface RegistryMutatorDeps {
  pause(): Promise<void>;
  resume(): void;
  refresh(): Promise<void>;
  render(): void;
}

export function createRegistryMutator(deps: RegistryMutatorDeps): <T>(action: () => Promise<T>) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(action: () => Promise<T>) => {
    const run = async () => {
      try {
        await deps.pause();
        const result = await action();
        await deps.refresh();
        deps.render();
        return result;
      } finally {
        deps.resume();
      }
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  };
}
