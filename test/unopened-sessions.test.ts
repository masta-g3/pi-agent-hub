import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionsController } from "../src/app/controller.js";
import { heartbeatPath } from "../src/core/paths.js";
import { createSessionRecord, loadRegistry, updateRegistry } from "../src/core/registry.js";
import { applyComputedStatus, markInteracted } from "../src/core/status.js";
import type { RuntimeSession } from "../src/core/types.js";
import { buildRenderModel, type RenderModel } from "../src/tui/render-model.js";
import { renderSessions } from "../src/tui/layout.js";
import { darkTheme, stripAnsi } from "../src/tui/theme.js";
import { cockpitFleet, COCKPIT_NOW } from "./fixtures/cockpit.js";

const HOUR = 60 * 60_000;

function unopened(id: string, title: string, overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    id, title, cwd: `/tmp/${id}`, group: "Hub", tmuxSession: `pi-agent-hub-${id}`,
    status: "idle", createdAt: COCKPIT_NOW - 3 * HOUR, updatedAt: COCKPIT_NOW - 3 * HOUR,
    lastActivityAt: COCKPIT_NOW - 2 * HOUR, unopened: true, ...overrides,
  };
}

function tierOf(model: RenderModel, id: string): string | undefined {
  return model.sections.find((section) => section.groups.some((group) => group.sessions.some((row) => row.id === id)))?.key;
}

function titleLine(model: RenderModel, id: string): string {
  const layout = renderSessions(model, darkTheme);
  const index = layout.rowTargets.findIndex((target) => target?.kind === "session" && target.id === id);
  assert.ok(index >= 0, id);
  return stripAnsi(layout.lines[index]!);
}

async function withTempSessionsDir(fn: () => Promise<void>): Promise<void> {
  const oldDir = process.env.PI_AGENT_HUB_DIR;
  process.env.PI_AGENT_HUB_DIR = await mkdtemp(join(tmpdir(), "pi-agent-hub-unopened-"));
  try {
    await fn();
  } finally {
    if (oldDir === undefined) delete process.env.PI_AGENT_HUB_DIR;
    else process.env.PI_AGENT_HUB_DIR = oldDir;
  }
}

test("created records start unopened and only user interaction clears the flag", () => {
  const record = createSessionRecord({ cwd: "/tmp/api", now: 1_000 });
  assert.equal(record.unopened, true);

  const heartbeat = { managedSessionId: record.id, cwd: record.cwd, state: "waiting" as const, stateSince: 5_000, updatedAt: 5_000 };
  const refreshed = applyComputedStatus(record, { status: "waiting" }, 5_000, heartbeat);
  assert.equal(refreshed.lastActivityAt, 5_000);
  assert.equal(refreshed.unopened, true);

  const opened = markInteracted(refreshed, 4_000);
  assert.equal(opened.unopened, undefined);
  assert.equal(opened.lastActivityAt, 5_000);
  assert.ok(opened.updatedAt > refreshed.updatedAt);
  assert.equal(JSON.stringify(opened).includes("unopened"), false);
});

test("an unopened session survives heartbeat refresh and reload, then leaves NEW when touched", async () => {
  await withTempSessionsDir(async () => {
    const now = 1_000_000;
    const record = { ...createSessionRecord({ cwd: "/tmp/api", now: now - 10_000 }), status: "running" as const };
    await updateRegistry((registry) => ({ ...registry, sessions: [record] }));
    await mkdir(join(process.env.PI_AGENT_HUB_DIR!, "heartbeats"), { recursive: true });
    await writeFile(heartbeatPath(record.id), `${JSON.stringify({
      managedSessionId: record.id, cwd: record.cwd, state: "waiting", stateSince: now - 10, updatedAt: now,
    })}\n`, "utf8");

    const first = new SessionsController(await loadRegistry(), async () => "present");
    await first.refresh(now);
    assert.equal(first.snapshot().sessions[0]?.status, "waiting");

    const reloaded = new SessionsController(await loadRegistry(), async () => "present");
    await reloaded.refresh(now);
    assert.equal(tierOf(buildRenderModel({ sessions: reloaded.snapshot().sessions, width: 100, now }), record.id), "new");

    await reloaded.touchSession(record.id, now + 1);
    const persisted = (await loadRegistry()).sessions[0]!;
    assert.equal(persisted.unopened, undefined);
    assert.equal(tierOf(buildRenderModel({ sessions: reloaded.snapshot().sessions, width: 100, now }), record.id), "quiet");
  });
});

test("NEW holds unopened Active parents below HEALTH whatever their runtime status", () => {
  const sessions = [
    ...cockpitFleet(),
    unopened("fresh-idle", "Fresh idle"),
    unopened("fresh-waiting", "Fresh waiting", { status: "waiting" }),
    unopened("fresh-running", "Fresh running", { status: "running" }),
    unopened("fresh-child", "child", { kind: "subagent", parentId: "fresh-idle", status: "running" }),
    unopened("fresh-request", "Fresh request", { status: "waiting", context: { version: 1, updatedAt: COCKPIT_NOW, attention: { kind: "question", text: "Which?" } } }),
    unopened("fresh-error", "Fresh error", { status: "error", error: "boom" }),
    unopened("fresh-archived", "Fresh archived", { bucket: "archived", bucketChangedAt: COCKPIT_NOW - HOUR }),
    unopened("fresh-backlog", "Fresh backlog", { bucket: "backlog", bucketChangedAt: COCKPIT_NOW - HOUR }),
    unopened("opened", "Opened", { unopened: undefined }),
  ];
  const model = buildRenderModel({ sessions, width: 100, now: COCKPIT_NOW, expandedProjectParentIds: new Set(["fresh-idle"]) });

  assert.deepEqual(model.sections.map((section) => section.key), ["needs-you", "health", "new", "active", "quiet", "archived"]);
  for (const id of ["fresh-idle", "fresh-waiting", "fresh-running", "fresh-child"]) assert.equal(tierOf(model, id), "new", id);
  assert.equal(model.sections.find((section) => section.key === "new")?.sessionsTotal, 3);
  assert.equal(tierOf(model, "fresh-request"), "needs-you");
  assert.equal(tierOf(model, "fresh-error"), "health");
  assert.equal(tierOf(model, "fresh-archived"), "archived");
  assert.equal(tierOf(model, "fresh-backlog"), "quiet");
  assert.equal(tierOf(model, "opened"), "quiet");

  const row = model.sections.flatMap((section) => section.groups.flatMap((group) => group.sessions)).find((candidate) => candidate.id === "fresh-idle");
  assert.equal(row?.cockpitPlacement.kind, "unopened");
  assert.equal(row?.status, "idle");
  assert.equal(row?.needsAttention, false);
});

test("NEW is always expanded and has no collapse target", () => {
  const sessions = [...cockpitFleet(), unopened("fresh", "Fresh")];
  const model = buildRenderModel({
    sessions, width: 100, now: COCKPIT_NOW,
    collapsedSections: new Set(["health", "active", "quiet", "archived"]),
  });
  const section = model.sections.find((candidate) => candidate.key === "new");
  assert.equal(section?.collapsed, false);
  assert.equal(section?.collapsible, false);
  assert.equal(tierOf(model, "fresh"), "new");
});

test("the new badge marks unopened parents outside the NEW heading with no expiry", () => {
  const fresh = unopened("fresh", "Fresh fork");
  const requested = unopened("asks", "Fresh asks", { status: "waiting", context: { version: 1, updatedAt: COCKPIT_NOW, attention: { kind: "question", text: "Which?" } } });
  const opened = unopened("opened", "Just opened", { unopened: undefined, createdAt: COCKPIT_NOW - 1_000 });
  const sessions = [fresh, requested, opened];
  const width = 100;

  const status = buildRenderModel({ sessions, width, now: COCKPIT_NOW });
  assert.doesNotMatch(titleLine(status, "fresh"), / new\b/);
  assert.match(titleLine(status, "asks"), / new\b/);
  assert.doesNotMatch(titleLine(status, "opened"), / new\b/);

  assert.match(titleLine(buildRenderModel({ sessions, width, now: COCKPIT_NOW, fleetGrouping: "repo" }), "fresh"), / new\b/);
  assert.match(titleLine(buildRenderModel({ sessions, width, now: COCKPIT_NOW, grouping: "stage" }), "fresh"), / new\b/);
  assert.match(titleLine(buildRenderModel({ sessions, width, now: COCKPIT_NOW, pinSlots: ["opened"] }), "fresh"), / new\b/);
  assert.doesNotMatch(titleLine(buildRenderModel({ sessions, width, now: COCKPIT_NOW, pinSlots: ["opened"], pinsHidden: true }), "fresh"), / new\b/);
});
