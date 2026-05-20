import test from "node:test";
import assert from "node:assert/strict";
import { buildNewFormContext, loadDashboardTheme, resolveDashboardThemeSessionId } from "../src/app/run-tui.js";
import type { ManagedSession } from "../src/core/types.js";

function session(id: string, cwd: string, group: string, additionalCwds?: string[]): ManagedSession {
  return {
    id,
    title: id,
    cwd,
    group,
    ...(additionalCwds?.length ? { additionalCwds } : {}),
    tmuxSession: `pi-agent-hub-${id}`,
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
  };
}

test("resolveDashboardThemeSessionId prefers persisted existing session", () => {
  const first = session("first", "/repo/first", "one");
  const second = session("second", "/repo/second", "two");

  assert.equal(resolveDashboardThemeSessionId([first, second], "second", "first"), "second");
  assert.equal(resolveDashboardThemeSessionId([first, second], "missing", "first"), "first");
});

test("loadDashboardTheme follows the pinned session instead of selection movement", async () => {
  const first = { ...session("first", "/repo/first", "one"), activeTheme: { tokens: { accent: "#111111" } } };
  const second = { ...session("second", "/repo/second", "two"), activeTheme: { tokens: { accent: "#222222" } } };

  const theme = await loadDashboardTheme("/dashboard", [first, second], "first");

  assert.equal(theme.accent, "#111111");
});

test("buildNewFormContext defaults to selected session cwd, group, and additional repos", () => {
  const selected = session("api", "/repo/api", "backend", ["/repo/web", "/repo/shared", "/repo/docs"]);
  const context = buildNewFormContext({
    cwd: "/dashboard",
    sessions: [session("docs", "/repo/docs", "docs"), selected],
    selected,
  });

  assert.deepEqual(context, {
    cwd: "/repo/api",
    group: "backend",
    knownCwds: ["/repo/api", "/dashboard", "/repo/web", "/repo/shared", "/repo/docs"],
    additionalCwds: ["/repo/web", "/repo/shared", "/repo/docs"],
  });
});

test("buildNewFormContext falls back to dashboard cwd without selection", () => {
  const context = buildNewFormContext({
    cwd: "/dashboard",
    sessions: [session("api", "/repo/api", "backend")],
  });

  assert.deepEqual(context, {
    cwd: "/dashboard",
    group: undefined,
    knownCwds: ["/dashboard", "/repo/api"],
  });
});

test("buildNewFormContext includes history paths without sessions", () => {
  const context = buildNewFormContext({
    cwd: "/dashboard",
    sessions: [],
    historyCwds: ["/repo/api", "/repo/web"],
  });

  assert.deepEqual(context.knownCwds, ["/dashboard", "/repo/api", "/repo/web"]);
});

test("buildNewFormContext dedupes selected registry and history paths by rank", () => {
  const selected = session("api", "/repo/api", "backend", ["/repo/web"]);
  const context = buildNewFormContext({
    cwd: "/dashboard",
    sessions: [selected, session("docs", "/repo/docs", "docs")],
    selected,
    historyCwds: ["/repo/docs", "/repo/api", "/repo/cli"],
  });

  assert.deepEqual(context.knownCwds, ["/repo/api", "/dashboard", "/repo/web", "/repo/docs", "/repo/cli"]);
});
