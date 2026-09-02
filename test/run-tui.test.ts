import test from "node:test";
import assert from "node:assert/strict";
import { applyDashboardAction, attentionExternalMessage, buildNewFormContext, createRegistryMutator, createViewStateWriter, dashboardOwnsTmuxSession, deliverAttentionBatch, normalizeSessionsViewState, persistDashboardThemeSelection, processDashboardAction, restartAllTargets, startDashboardActionLoop } from "../src/app/run-tui.js";
import { completeAttentionTrip, COCKPIT_RELEASE_CUE, normalizeCockpitOnboarding, releaseCueVisible, startAttentionTrip } from "../src/tui/cockpit-onboarding.js";
import type { AttentionDeliveryEntry } from "../src/app/attention-delivery.js";
import type { TmuxClient } from "../src/core/tmux.js";
import type { ManagedSession } from "../src/core/types.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

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

function attention(sessionId: string, kind: AttentionDeliveryEntry["kind"] = "question"): AttentionDeliveryEntry {
  return {
    key: `${sessionId}\0req-${sessionId}`, sessionId, tmuxSession: `pi-agent-hub-${sessionId}`,
    requestId: `req-${sessionId}`, kind, text: `Choose ${sessionId} release`, title: sessionId.toUpperCase(),
    announcedAt: 100, expiresAt: 6_100,
  };
}

function client(name: string, sessionName: string, paneId: string): TmuxClient {
  return { name, tty: `/dev/${name}`, session: sessionName, paneId, flags: ["attached"] };
}

test("external attention delivery is owned only by the managed dashboard tmux session", async () => {
  let inspected = 0;
  assert.equal(await dashboardOwnsTmuxSession(undefined, async () => { inspected += 1; return "pi-agent-hub"; }), false);
  assert.equal(inspected, 0);
  assert.equal(await dashboardOwnsTmuxSession("set", async () => "shell"), false);
  assert.equal(await dashboardOwnsTmuxSession("set", async () => "pi-agent-hub"), true);
  assert.equal(await dashboardOwnsTmuxSession("set", async () => { throw new Error("tmux failed"); }), false);
});

test("attention external message is bounded to newest identity plus aggregate count", () => {
  assert.equal(attentionExternalMessage([attention("api")]), "? QUESTION · API · Choose api release");
  assert.equal(attentionExternalMessage([attention("api", "blocked"), attention("web")]), "! 2 NEW · API · Choose api release · +1 more");
});

test("attention delivery sends per eligible client and conservatively gates BEL", async () => {
  const sent: string[] = [];
  let bells = 0;
  await deliverAttentionBatch([attention("api"), attention("web")], {
    dashboardSession: "pi-agent-hub-dashboard", dashboardPaneId: "%1", pins: [], bellEnabled: true,
    listClients: async () => [
      client("api", "pi-agent-hub-api", "%7"),
      client("hub", "pi-agent-hub-dashboard", "%1"),
      client("other", "shell", "%9"),
    ],
    display: async (target, message) => { sent.push(`${target}:${message}`); },
    ring: () => { bells += 1; },
  });
  assert.deepEqual(sent, [
    "api:? QUESTION · WEB · Choose web release",
    "other:? 2 NEW · API · Choose api release · +1 more",
  ]);
  assert.equal(bells, 0);
});

test("attention delivery isolates client failures and rings once when all locations are eligible", async () => {
  const sent: string[] = [];
  let bells = 0;
  await deliverAttentionBatch([attention("api")], {
    dashboardSession: "hub", pins: [], bellEnabled: true,
    listClients: async () => [client("broken", "shell", "%8"), client("good", "other", "%9")],
    display: async (target) => { if (target === "broken") throw new Error("gone"); sent.push(target); },
    ring: () => { bells += 1; },
  });
  assert.deepEqual(sent, ["good"]);
  assert.equal(bells, 1);

  await assert.doesNotReject(() => deliverAttentionBatch([attention("api")], {
    dashboardSession: "hub", pins: [], bellEnabled: true,
    listClients: async () => [client("good", "shell", "%9")],
    display: async () => {},
    ring: () => { throw new Error("terminal closed"); },
  }));

  await assert.doesNotReject(() => deliverAttentionBatch([attention("api")], {
    dashboardSession: "hub", pins: [], bellEnabled: true,
    listClients: async () => { throw new Error("no server"); },
    display: async () => { throw new Error("must not run"); },
    ring: () => { throw new Error("must not ring"); },
  }));
});

test("view state ignores retired density and Backlog collapse values", () => {
  assert.deepEqual(normalizeSessionsViewState({
    grouping: "stage",
    density: "all-cards",
    collapsedSections: ["backlog", "archived", "archived"],
  }), { grouping: "stage", collapsedSections: ["archived"] });
  assert.deepEqual(normalizeSessionsViewState({ grouping: "unknown", density: "compact" }), { grouping: "project" });
});

test("view state classifies only a missing empty dashboard as a new cohort", () => {
  assert.deepEqual(normalizeSessionsViewState(undefined, { emptyFleet: true }), {
    grouping: "project",
    cockpitOnboarding: { cohort: "new", phase: "learning" },
  });
  assert.deepEqual(normalizeSessionsViewState(undefined, { emptyFleet: false }), { grouping: "project" });
  assert.deepEqual(normalizeSessionsViewState({}, { emptyFleet: true }), { grouping: "project" });
});

test("view state normalizes bounded onboarding and release cue fields", () => {
  assert.deepEqual(normalizeSessionsViewState({
    grouping: "stage",
    cockpitOnboarding: { cohort: "new", phase: "awaiting-return", sessionId: "api", requestId: "req/1", ignored: true },
    dismissedReleaseCueId: COCKPIT_RELEASE_CUE.id,
  }), {
    grouping: "stage",
    cockpitOnboarding: { cohort: "new", phase: "awaiting-return", sessionId: "api", requestId: "req/1" },
    dismissedReleaseCueId: COCKPIT_RELEASE_CUE.id,
  });
  assert.deepEqual(normalizeSessionsViewState({
    grouping: "project",
    cockpitOnboarding: { cohort: "new", phase: "awaiting-return", sessionId: "api", requestId: "x".repeat(65) },
    dismissedReleaseCueId: 42,
  }), { grouping: "project" });
});

test("cockpit onboarding transitions retain one exact request and one cue id", () => {
  const learning = normalizeCockpitOnboarding({ cohort: "new", phase: "learning" });
  const waiting = startAttentionTrip(learning, { sessionId: "api", requestId: "req/1" });
  assert.deepEqual(waiting, { cohort: "new", phase: "awaiting-return", sessionId: "api", requestId: "req/1" });
  assert.equal(startAttentionTrip(waiting, { sessionId: "web", requestId: "req/2" }), waiting);
  assert.deepEqual(completeAttentionTrip(waiting), { cohort: "new", phase: "complete" });
  assert.equal(releaseCueVisible(undefined, undefined), true);
  assert.equal(releaseCueVisible(undefined, COCKPIT_RELEASE_CUE.id), false);
  assert.equal(releaseCueVisible(learning, undefined), false);
});

test("view state writer preserves invocation order and drains the newest snapshot", async () => {
  const first = deferred();
  const writes: string[] = [];
  const writer = createViewStateWriter(async (state) => {
    writes.push(`start:${state.grouping}`);
    if (state.grouping === "stage") await first.promise;
    writes.push(`end:${state.grouping}`);
  });
  writer.save({ grouping: "stage" });
  writer.save({ grouping: "project", cockpitOnboarding: { cohort: "new", phase: "complete" } });
  await Promise.resolve();
  assert.deepEqual(writes, ["start:stage"]);
  first.resolve();
  await writer.drain();
  assert.deepEqual(writes, ["start:stage", "end:stage", "start:project", "end:project"]);
});

test("view state writer continues after a failed write and reports the failure on drain", async () => {
  const writes: string[] = [];
  const writer = createViewStateWriter(async (state) => {
    writes.push(state.grouping);
    if (state.grouping === "stage") throw new Error("disk failed");
  });
  writer.save({ grouping: "stage" });
  writer.save({ grouping: "project", cockpitOnboarding: { cohort: "new", phase: "complete" } });
  await assert.rejects(() => writer.drain(), /disk failed/);
  assert.deepEqual(writes, ["stage", "project"]);
});

test("dashboard action loop stop drains the active producer", async () => {
  const active = deferred();
  let started = false;
  const stop = startDashboardActionLoop(async () => {
    started = true;
    await active.promise;
  }, 60_000);
  await Promise.resolve();
  assert.equal(started, true);
  let stopped = false;
  const draining = stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  active.resolve();
  await draining;
  assert.equal(stopped, true);
});

test("dashboard Ctrl+Q return completion survives refresh failure while rename still refreshes first", async () => {
  const events: string[] = [];
  const view = {
    openRenameForTmuxSession: (tmuxSession: string) => { events.push(`rename:${tmuxSession}`); return true; },
    completeFullScreenReturn: (key: "ctrl-q") => { events.push(`return:${key}`); },
  };
  await assert.rejects(() => processDashboardAction(view, { action: "return", key: "ctrl-q" }, async () => {
    events.push("refresh");
    throw new Error("refresh failed");
  }), /refresh failed/);
  assert.deepEqual(events, ["return:ctrl-q", "refresh"]);

  events.length = 0;
  await processDashboardAction(view, { action: "rename", tmuxSession: "pi-agent-hub-api" }, async () => { events.push("refresh"); });
  assert.deepEqual(events, ["refresh", "rename:pi-agent-hub-api"]);
});

test("dashboard actions route Ctrl+Q completion separately from rename", () => {
  const events: string[] = [];
  const view = {
    openRenameForTmuxSession: (tmuxSession: string) => { events.push(`rename:${tmuxSession}`); return true; },
    completeFullScreenReturn: (key: "ctrl-q") => { events.push(`return:${key}`); },
  };
  applyDashboardAction(view, { action: "rename", tmuxSession: "pi-agent-hub-api" });
  applyDashboardAction(view, { action: "return", key: "ctrl-q" });
  assert.deepEqual(events, ["rename:pi-agent-hub-api", "return:ctrl-q"]);
});

test("restartAllTargets includes only active parent sessions", () => {
  const active = session("active", "/repo/active", "one");
  const backlog = { ...session("backlog", "/repo/backlog", "one"), bucket: "backlog" as const };
  const archived = { ...session("archived", "/repo/archived", "one"), bucket: "archived" as const };
  const subagent = { ...session("subagent", "/repo/active", "one"), kind: "subagent" as const, parentId: active.id };

  assert.deepEqual(restartAllTargets([active, backlog, archived, subagent]), [active]);
});

test("persistDashboardThemeSelection saves Pi before Hub and publishes only while synced", async () => {
  const events: string[] = [];
  await persistDashboardThemeSelection("light/dark", true, {
    savePi: async () => { events.push("pi"); },
    savePreference: async (preference) => { events.push(`hub:${preference.syncPi}`); },
    publish: async () => { events.push("publish"); },
  });
  assert.deepEqual(events, ["pi", "hub:true", "publish"]);

  events.length = 0;
  await persistDashboardThemeSelection("dark", false, {
    savePi: async () => { events.push("pi"); },
    savePreference: async (preference) => { events.push(`hub:${preference.syncPi}:${preference.theme}`); },
    publish: async () => { events.push("publish"); },
  });
  assert.deepEqual(events, ["hub:false:dark"]);
});

test("persistDashboardThemeSelection does not publish after Pi or Hub write failures", async () => {
  let published = false;
  await assert.rejects(() => persistDashboardThemeSelection("light", true, {
    savePi: async () => { throw new Error("pi failed"); },
    savePreference: async () => {},
    publish: async () => { published = true; },
  }), /pi failed/);
  assert.equal(published, false);

  await assert.rejects(() => persistDashboardThemeSelection("light", true, {
    savePi: async () => {},
    savePreference: async () => { throw new Error("hub failed"); },
    publish: async () => { published = true; },
  }), /Pi default changed; Hub preference not saved: hub failed/);
  assert.equal(published, false);
});

test("registry mutator pauses runs refreshes renders and resumes in order", async () => {
  const events: string[] = [];
  const mutate = createRegistryMutator({
    pause: async () => { events.push("pause"); },
    resume: () => { events.push("resume"); },
    refresh: async () => { events.push("refresh"); },
    render: () => { events.push("render"); },
  });

  await mutate(async () => { events.push("action"); });

  assert.deepEqual(events, ["pause", "action", "refresh", "render", "resume"]);
});

test("registry mutator serializes overlapping mutations", async () => {
  const firstAction = deferred();
  const events: string[] = [];
  const mutate = createRegistryMutator({
    pause: async () => { events.push("pause"); },
    resume: () => { events.push("resume"); },
    refresh: async () => { events.push("refresh"); },
    render: () => { events.push("render"); },
  });

  const first = mutate(async () => {
    events.push("first-action");
    await firstAction.promise;
  });
  const second = mutate(async () => { events.push("second-action"); });
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(events, ["pause", "first-action"]);
  firstAction.resolve();
  await Promise.all([first, second]);

  assert.deepEqual(events, [
    "pause", "first-action", "refresh", "render", "resume",
    "pause", "second-action", "refresh", "render", "resume",
  ]);
});

test("registry mutator resumes and propagates action failures", async () => {
  const events: string[] = [];
  const mutate = createRegistryMutator({
    pause: async () => { events.push("pause"); },
    resume: () => { events.push("resume"); },
    refresh: async () => { events.push("refresh"); },
    render: () => { events.push("render"); },
  });

  await assert.rejects(() => mutate(async () => {
    events.push("action");
    throw new Error("boom");
  }), /boom/);

  assert.deepEqual(events, ["pause", "action", "resume"]);
});

test("registry mutator queue survives rejections", async () => {
  const events: string[] = [];
  const mutate = createRegistryMutator({
    pause: async () => { events.push("pause"); },
    resume: () => { events.push("resume"); },
    refresh: async () => { events.push("refresh"); },
    render: () => { events.push("render"); },
  });

  await assert.rejects(() => mutate(async () => { throw new Error("boom"); }), /boom/);
  await mutate(async () => { events.push("action"); });

  assert.deepEqual(events, ["pause", "resume", "pause", "action", "refresh", "render", "resume"]);
});

test("buildNewFormContext defaults to selected session cwd, group, and additional repos", () => {
  const selected = session("api", "/repo/api", "backend", ["/repo/web", "/repo/shared", "/repo/docs"]);
  const context = buildNewFormContext({
    cwd: "/dashboard",
    sessions: [session("docs", "/repo/docs", "docs"), selected],
    selected,
    worktreeDefault: true,
  });

  assert.deepEqual(context, {
    cwd: "/repo/api",
    group: "backend",
    worktreeDefault: true,
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

test("buildNewFormContext excludes hub-owned worktree paths from cwd suggestions", () => {
  const worktree = {
    ...session("feature", "/hub/worktrees/api/feature-api", "backend"),
    worktreePath: "/hub/worktrees/api/feature-api",
    worktreeRepoRoot: "/repo/api",
    worktreeBranch: "feature/api",
    worktreeBaseBranch: "main",
    worktreeOwnedByHub: true,
  };
  const context = buildNewFormContext({
    cwd: "/dashboard",
    sessions: [worktree, session("docs", "/repo/docs", "docs")],
    selected: worktree,
    historyCwds: ["/hub/worktrees/api/feature-api", "/repo/web"],
  });

  assert.deepEqual(context, {
    cwd: "/repo/api",
    group: "backend",
    knownCwds: ["/repo/api", "/dashboard", "/repo/docs", "/repo/web"],
  });
});

test("buildNewFormContext uses source roots for multi-repo worktree sessions", () => {
  const worktree = {
    ...session("feature", "/hub/worktrees/api/feature-api", "backend", ["/hub/worktrees/web/feature-api"]),
    worktreeOwnedByHub: true,
    worktrees: [
      { path: "/hub/worktrees/api/feature-api", repoRoot: "/repo/api", branch: "feature/api", baseBranch: "main", role: "primary" as const },
      { path: "/hub/worktrees/web/feature-api", repoRoot: "/repo/web", branch: "feature/api", baseBranch: "main", role: "additional" as const },
    ],
  };
  const context = buildNewFormContext({
    cwd: "/dashboard",
    sessions: [worktree, session("docs", "/repo/docs", "docs")],
    selected: worktree,
    historyCwds: ["/hub/worktrees/web/feature-api", "/repo/cli"],
  });

  assert.deepEqual(context, {
    cwd: "/repo/api",
    group: "backend",
    knownCwds: ["/repo/api", "/dashboard", "/repo/web", "/repo/docs", "/repo/cli"],
    additionalCwds: ["/repo/web"],
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
