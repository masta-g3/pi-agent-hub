import test from "node:test";
import assert from "node:assert/strict";
import { startThemeRefreshLoop } from "../src/app/run-tui.js";
import { darkTheme, type SessionsTheme } from "../src/tui/theme.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition: () => boolean, timeoutMs = 200): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) await wait(5);
}

test("theme refresh loop applies changed themes and skips load errors", async () => {
  const changed: SessionsTheme = { ...darkTheme, accent: "#010203" };
  const applied: SessionsTheme[] = [];
  let calls = 0;
  const stop = startThemeRefreshLoop({
    initialTheme: darkTheme,
    intervalMs: 5,
    load: async () => {
      calls += 1;
      if (calls === 1) throw new Error("mid-write");
      return changed;
    },
    apply: (theme) => { applied.push(theme); },
  });

  try {
    await waitFor(() => applied.length === 1);
  } finally {
    stop();
  }

  assert.ok(calls >= 2);
  assert.deepEqual(applied, [changed]);
});

test("theme refresh loop ignores unchanged tokens", async () => {
  const applied: SessionsTheme[] = [];
  const stop = startThemeRefreshLoop({
    initialTheme: darkTheme,
    intervalMs: 5,
    load: async () => ({ ...darkTheme }),
    apply: (theme) => { applied.push(theme); },
  });

  try {
    await wait(20);
  } finally {
    stop();
  }

  assert.deepEqual(applied, []);
});

test("theme refresh loop does not apply in-flight themes after stop", async () => {
  const applied: SessionsTheme[] = [];
  let release: (() => void) | undefined;
  let stop = () => {};
  const loadStarted = new Promise<void>((resolve) => {
    stop = startThemeRefreshLoop({
      initialTheme: darkTheme,
      intervalMs: 1,
      load: async () => {
        resolve();
        await new Promise<void>((done) => { release = done; });
        return { ...darkTheme, accent: "#010203" };
      },
      apply: (theme) => { applied.push(theme); },
    });
  });

  await loadStarted;
  stop();
  release?.();
  await wait(5);

  assert.deepEqual(applied, []);
});
