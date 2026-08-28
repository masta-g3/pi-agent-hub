import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionsController } from "../src/app/controller.js";
import { heartbeatPath, multiRepoWorkspacePath } from "../src/core/paths.js";
import { updateRegistry } from "../src/core/registry.js";
import { HEARTBEAT_STALE_MS } from "../src/core/status.js";
import type { ManagedSession } from "../src/core/types.js";
import type { TmuxPresence } from "../src/core/tmux.js";

function session(status: ManagedSession["status"], overrides: Partial<ManagedSession> = {}): ManagedSession {
  const id = overrides.id ?? "s1";
  const title = overrides.title ?? "api";
  return {
    id,
    title,
    cwd: `/tmp/${title}`,
    group: overrides.group ?? "default",
    tmuxSession: `pi-agent-hub-${id}`,
    status,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test("refreshPreview skips sessions with error status", async () => {
  const controller = new SessionsController({ version: 1, sessions: [session("error")] });

  await controller.refreshPreview();

  assert.equal(controller.snapshot().preview, "");
});

test("selection changes clear stale preview and ignore late captures", async () => {
  let resolveCapture!: (preview: string) => void;
  const capture = new Promise<string>((resolve) => { resolveCapture = resolve; });
  let captures = 0;
  const controller = new SessionsController({
    version: 1,
    sessions: [session("idle", { id: "api" }), session("idle", { id: "docs" })],
  }, async () => ++captures === 1 ? "api preview" : capture);

  await controller.refreshPreview();
  assert.equal(controller.snapshot().preview, "api preview");
  const refreshing = controller.refreshPreview();
  controller.move(1);

  assert.equal(controller.snapshot().selectedId, "docs");
  assert.equal(controller.snapshot().preview, "");
  resolveCapture("late api preview");
  await refreshing;
  assert.equal(controller.snapshot().preview, "");
});

test("movement keeps errors ahead of the activity-sorted tier", () => {
  const controller = new SessionsController({
    version: 1,
    sessions: [
      session("idle", { id: "work", title: "work", group: "work" }),
      session("idle", { id: "b", title: "b", group: "default" }),
      session("error", { id: "a", title: "a", group: "default" }),
    ],
  });

  assert.equal(controller.snapshot().selectedId, "a");
  controller.move(1);
  assert.equal(controller.snapshot().selectedId, "b");
  controller.move(1);
  assert.equal(controller.snapshot().selectedId, "work");
  controller.move(-1);
  assert.equal(controller.snapshot().selectedId, "b");
});

test("movement follows stable group order and attention-first rows", () => {
  const controller = new SessionsController({
    version: 1,
    sessions: [
      session("idle", { id: "default", title: "default", group: "default", lastActivityAt: 100 }),
      session("idle", { id: "work-idle", title: "work-idle", group: "work", lastActivityAt: 200 }),
      session("waiting", { id: "work-waiting", title: "work-waiting", group: "work", lastActivityAt: 300 }),
      session("waiting", { id: "z-waiting", title: "z-waiting", group: "z", lastActivityAt: 400 }),
      session("idle", { id: "z-idle", title: "z-idle", group: "z", lastActivityAt: 50 }),
    ],
  });

  assert.equal(controller.snapshot().selectedId, "default");
  controller.move(1);
  assert.equal(controller.snapshot().selectedId, "work-waiting");
  controller.move(1);
  assert.equal(controller.snapshot().selectedId, "work-idle");
  controller.move(1);
  assert.equal(controller.snapshot().selectedId, "z-waiting");
  controller.move(1);
  assert.equal(controller.snapshot().selectedId, "z-idle");
});

test("nested subagent status stays inside its stable group", () => {
  const controller = new SessionsController({
    version: 1,
    sessions: [
      session("idle", { id: "default", title: "default", group: "default" }),
      session("idle", { id: "work", title: "work", group: "work" }),
      session("error", { id: "worker", title: "worker", group: "work", kind: "subagent", parentId: "work" }),
    ],
  });

  assert.equal(controller.snapshot().selectedId, "default");
  controller.move(1);
  assert.equal(controller.snapshot().selectedId, "work");
  controller.move(1);
  assert.equal(controller.snapshot().selectedId, "worker");
});

test("filter matches additional repo basenames", () => {
  const controller = new SessionsController({
    version: 1,
    sessions: [
      session("idle", { id: "api", title: "api", cwd: "/repo/api", additionalCwds: ["/repo/web-client"] }),
      session("idle", { id: "docs", title: "docs", cwd: "/repo/docs" }),
    ],
  });

  controller.setFilter("web-client");

  assert.equal(controller.snapshot().selectedId, "api");
});

test("moveSessionToGroup appends only when changing groups", async () => {
  await withTempSessionsDir(async () => {
    const registry = {
      version: 1 as const,
      sessions: [
        session("idle", { id: "a", title: "a", group: "default", order: 0 }),
        session("idle", { id: "b", title: "b", group: "default", order: 1 }),
        session("idle", { id: "work", title: "work", group: "work", order: 0 }),
      ],
    };
    await updateRegistry(() => registry);
    const controller = new SessionsController(registry);

    await controller.moveSessionToGroup("a", "default");
    assert.deepEqual(controller.snapshot().registry.sessions.find((item) => item.id === "a")?.order, 0);
    assert.equal(controller.snapshot().registry.sessions.find((item) => item.id === "a")?.updatedAt, 1);

    await controller.moveSessionToGroup("a", "work");
    assert.deepEqual(controller.snapshot().registry.sessions.find((item) => item.id === "a")?.order, 1);
  });
});

test("reorderSelected swaps selected session within its group and clamps at borders", async () => {
  await withTempSessionsDir(async () => {
    const registry = {
      version: 1 as const,
      sessions: [
        session("idle", { id: "a", title: "a", order: 0 }),
        session("idle", { id: "b", title: "b", order: 1 }),
        session("idle", { id: "c", title: "c", order: 2 }),
        session("idle", { id: "work", title: "work", group: "work", order: 0 }),
      ],
    };
    await updateRegistry(() => registry);
    const controller = new SessionsController(registry);

    controller.move(1);
    assert.equal(controller.snapshot().selectedId, "b");

    await controller.reorderSelected(-1);
    assert.deepEqual(controller.snapshot().registry.sessions.filter((item) => item.group === "default").map((item) => [item.id, item.order]), [["a", 1], ["b", 0], ["c", 2]]);
    assert.equal(controller.snapshot().selectedId, "b");

    await controller.reorderSelected(-1);
    assert.deepEqual(controller.snapshot().registry.sessions.filter((item) => item.group === "default").map((item) => [item.id, item.order]), [["a", 1], ["b", 0], ["c", 2]]);

    await controller.reorderSelected(1);
    await controller.reorderSelected(1);
    assert.deepEqual(controller.snapshot().registry.sessions.filter((item) => item.group === "default").map((item) => [item.id, item.order]), [["a", 0], ["b", 2], ["c", 1]]);
    assert.deepEqual(controller.snapshot().registry.sessions.filter((item) => item.group === "work").map((item) => [item.id, item.order]), [["work", 0]]);
  });
});

test("reorderSession keeps its explicit target when selection changes", async () => {
  await withTempSessionsDir(async () => {
    const registry = {
      version: 1 as const,
      sessions: [
        session("idle", { id: "a", title: "a", order: 0 }),
        session("idle", { id: "b", title: "b", order: 1 }),
        session("idle", { id: "c", title: "c", order: 2 }),
      ],
    };
    await updateRegistry(() => registry);
    const controller = new SessionsController(registry);
    controller.selectSession("b");

    await controller.reorderSession("a", 1);

    assert.equal(controller.snapshot().selectedId, "b");
    assert.deepEqual(controller.snapshot().registry.sessions.map((item) => [item.id, item.order]), [["a", 1], ["b", 0], ["c", 2]]);
  });
});

test("reorderSelected stays within the selected priority and activity tie", async () => {
  await withTempSessionsDir(async () => {
    const registry = {
      version: 1 as const,
      sessions: [
        session("error", { id: "error", title: "error", order: 0 }),
        session("idle", { id: "idle-a", title: "idle-a", order: 1, lastActivityAt: 200 }),
        session("waiting", { id: "idle-b", title: "idle-b", order: 2, lastActivityAt: 100, acknowledgedAt: 50 }),
      ],
    };
    await updateRegistry(() => registry);
    const controller = new SessionsController(registry);

    controller.move(1);
    assert.equal(controller.snapshot().selectedId, "idle-a");
    await controller.reorderSelected(-1);
    await controller.reorderSelected(1);
    assert.deepEqual(controller.snapshot().registry.sessions.map((item) => [item.id, item.order]), [["error", 0], ["idle-a", 1], ["idle-b", 2]]);
  });
});

test("reorderSelected ignores archived sessions", async () => {
  await withTempSessionsDir(async () => {
    const controller = new SessionsController({
      version: 1,
      sessions: [
        session("idle", { id: "new", title: "new", bucket: "archived", bucketChangedAt: 200, order: 1 }),
        session("idle", { id: "old", title: "old", bucket: "archived", bucketChangedAt: 100, order: 0 }),
      ],
    });

    await controller.reorderSelected(1);

    assert.deepEqual(controller.snapshot().registry.sessions.map((item) => [item.id, item.order]), [["new", 1], ["old", 0]]);
  });
});

async function withTempSessionsDir(fn: () => Promise<void>): Promise<void> {
  const oldDir = process.env.PI_AGENT_HUB_DIR;
  process.env.PI_AGENT_HUB_DIR = await mkdtemp(join(tmpdir(), "pi-agent-hub-controller-"));
  try {
    await fn();
  } finally {
    if (oldDir === undefined) delete process.env.PI_AGENT_HUB_DIR;
    else process.env.PI_AGENT_HUB_DIR = oldDir;
  }
}

async function assertPathMissing(path: string): Promise<void> {
  await assert.rejects(() => access(path), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT");
}

test("removeSession removes child rows with their parent", () => {
  const controller = new SessionsController({
    version: 1,
    sessions: [
      session("idle", { id: "parent", title: "parent", order: 0 }),
      session("running", { id: "child", title: "child", kind: "subagent", parentId: "parent", agentName: "scout" }),
      session("idle", { id: "sibling", title: "sibling", order: 1 }),
    ],
  });

  controller.removeSession("parent");

  assert.deepEqual(controller.snapshot().registry.sessions.map((item) => item.id), ["sibling"]);
  assert.equal(controller.snapshot().selectedId, "sibling");
});

test("runtime status evidence is transient and follows causal session changes", async () => {
  await withTempSessionsDir(async () => {
    const registry = { version: 1 as const, sessions: [session("running", { id: "api" })] };
    await updateRegistry(() => registry);
    const controller = new SessionsController(registry, async () => "", async () => "present");

    await controller.refresh(100);
    assert.equal(controller.snapshot().sessions[0]?.statusEvidence?.reason, "fallback-waiting");
    const persisted = await readFile(join(process.env.PI_AGENT_HUB_DIR!, "registry.json"), "utf8");
    assert.doesNotMatch(persisted, /statusEvidence|observedAt/);

    await controller.moveSessionToGroup("api", "work", 101);
    assert.equal(controller.snapshot().sessions[0]?.statusEvidence?.reason, "fallback-waiting");

    await controller.acknowledgeSession("api", 102);
    assert.equal(controller.snapshot().sessions[0]?.status, "idle");
    assert.equal(controller.snapshot().sessions[0]?.statusEvidence, undefined);

    await controller.refresh(103);
    assert.equal(controller.snapshot().sessions[0]?.statusEvidence?.reason, "fallback-idle");
  });
});

test("refresh preserves unknown tmux failures as errors instead of stopped", async () => {
  await withTempSessionsDir(async () => {
    const registry = { version: 1 as const, sessions: [session("running", { id: "api" })] };
    await updateRegistry(() => registry);
    const controller = new SessionsController(registry, async () => "", async () => "unknown");
    await controller.refresh(10);
    assert.equal(controller.snapshot().registry.sessions[0]?.status, "error");
    assert.match(controller.snapshot().registry.sessions[0]?.error ?? "", /presence was not observed|tmux session is missing/);
  });
});

test("refresh prunes subagent rows whose tmux sessions are gone", async () => {
  await withTempSessionsDir(async () => {
    const registry = {
      version: 1 as const,
      sessions: [
        session("idle", { id: "parent", title: "parent", order: 0 }),
        session("waiting", { id: "child", title: "child", kind: "subagent" as const, parentId: "parent", agentName: "scout" }),
      ],
    };
    await updateRegistry(() => registry);
    const controller = new SessionsController(registry);

    await controller.refresh(10);

    assert.deepEqual(controller.snapshot().registry.sessions.map((item) => item.id), ["parent"]);
  });
});

test("stable refreshes do not rewrite the registry", async () => {
  await withTempSessionsDir(async () => {
    const registry = { version: 1 as const, sessions: [session("running", { id: "api" })] };
    await updateRegistry(() => registry);
    const controller = new SessionsController(registry, async () => "", async () => "present");

    await controller.refresh(100);
    const path = join(process.env.PI_AGENT_HUB_DIR!, "registry.json");
    const first = await stat(path, { bigint: true });
    await controller.refresh(100);
    const second = await stat(path, { bigint: true });

    assert.equal(second.ino, first.ino);
    assert.equal(second.mtimeNs, first.mtimeNs);
  });
});

test("refresh rejects mismatched heartbeat identity and falls back to tmux", async () => {
  await withTempSessionsDir(async () => {
    const now = 1_000;
    const registry = { version: 1 as const, sessions: [session("running", { id: "api" })] };
    await updateRegistry(() => registry);
    await mkdir(join(process.env.PI_AGENT_HUB_DIR!, "heartbeats"), { recursive: true });
    await writeFile(heartbeatPath("api"), `${JSON.stringify({
      managedSessionId: "other", cwd: "/tmp/api", state: "error", stateSince: now, updatedAt: now,
      message: "must not reach status",
    })}\n`, "utf8");
    const controller = new SessionsController(registry, async () => "", async () => "present");

    await controller.refresh(now);

    assert.equal(controller.snapshot().registry.sessions[0]?.status, "waiting");
    assert.equal(controller.snapshot().registry.sessions[0]?.error, undefined);
  });
});

test("refresh keeps live status while dropping malformed optional metadata", async () => {
  await withTempSessionsDir(async () => {
    const now = 1_000;
    const registry = { version: 1 as const, sessions: [session("running", { id: "api" })] };
    await updateRegistry(() => registry);
    await mkdir(join(process.env.PI_AGENT_HUB_DIR!, "heartbeats"), { recursive: true });
    await writeFile(heartbeatPath("api"), `${JSON.stringify({
      managedSessionId: "api", cwd: "/tmp/api", state: "waiting", stateSince: now - 10, updatedAt: now,
      piSessionName: 42,
      context: { version: 2, updatedAt: now },
      workflow: { steps: [], activeIndex: 0, updatedAt: now },
      activeTheme: { name: 1, tokens: { unknown: "ignored" } },
    })}\n`, "utf8");
    const controller = new SessionsController(registry, async () => "", async () => "present");

    await controller.refresh(now);

    const snapshot = controller.snapshot();
    assert.equal(snapshot.registry.sessions[0]?.status, "waiting");
    assert.equal(snapshot.registry.sessions[0]?.lastActivityAt, now - 10);
    assert.equal(snapshot.registry.sessions[0]?.activeTheme, undefined);
    assert.equal(snapshot.registry.sessions[0]?.workflow, undefined);
    assert.equal(snapshot.sessions[0]?.context, undefined);
  });
});

test("refresh projects active workflow mode only from a fresh heartbeat with confirmed tmux presence", async () => {
  await withTempSessionsDir(async () => {
    const now = 1_000_000;
    const workflow = {
      steps: [{ id: "plan-md", short: "PL", label: "Plan" }, { id: "execute", short: "EX", label: "Execute" }],
      activeIndex: 1,
      ticketId: "workflow-board-002",
      updatedAt: now,
    };
    const activeMode = { id: "focus", short: "FOC", label: "Focus", detail: "turn 4" };
    const registry = { version: 1 as const, sessions: [session("running", { id: "api" })] };
    await updateRegistry(() => registry);
    await mkdir(join(process.env.PI_AGENT_HUB_DIR!, "heartbeats"), { recursive: true });
    let presence: TmuxPresence = "present";
    const controller = new SessionsController(registry, async () => "", async () => presence);
    const writeHeartbeat = async (overrides: Record<string, unknown> = {}) => {
      await writeFile(heartbeatPath("api"), `${JSON.stringify({
        managedSessionId: "api",
        cwd: "/tmp/api",
        state: "waiting",
        stateSince: now - 1_000,
        updatedAt: now,
        workflow: { ...workflow, activeMode },
        ...overrides,
      })}\n`, "utf8");
    };

    await writeHeartbeat();
    await controller.refresh(now);
    assert.deepEqual(controller.snapshot().sessions[0]?.workflow?.activeMode, activeMode);
    assert.deepEqual(controller.snapshot().registry.sessions[0]?.workflow, workflow);
    const persisted = JSON.parse(await readFile(join(process.env.PI_AGENT_HUB_DIR!, "registry.json"), "utf8"));
    assert.equal(persisted.sessions[0].workflow.activeMode, undefined);

    await writeHeartbeat({ state: "error", message: "provider paused" });
    await controller.refresh(now);
    assert.deepEqual(controller.snapshot().sessions[0]?.workflow?.activeMode, activeMode);

    await writeHeartbeat({ workflow });
    await controller.refresh(now + 1);
    assert.equal(controller.snapshot().sessions[0]?.workflow?.activeMode, undefined);

    await writeHeartbeat({ updatedAt: now - HEARTBEAT_STALE_MS - 1 });
    await controller.refresh(now);
    assert.equal(controller.snapshot().sessions[0]?.workflow?.activeMode, undefined);

    await writeHeartbeat({ state: "shutdown" });
    await controller.refresh(now);
    assert.equal(controller.snapshot().sessions[0]?.workflow?.activeMode, undefined);

    for (presence of ["missing", "unknown"] as const) {
      await writeHeartbeat();
      await controller.refresh(now);
      assert.equal(controller.snapshot().sessions[0]?.workflow?.activeMode, undefined, presence);
    }
  });
});

test("refresh caches the native Pi name and projects generic context without persisting it", async () => {
  await withTempSessionsDir(async () => {
    const now = 1_000_000;
    const registry = { version: 1 as const, sessions: [session("running", { id: "api", title: "api" })] };
    await updateRegistry(() => registry);
    await mkdir(join(process.env.PI_AGENT_HUB_DIR!, "heartbeats"), { recursive: true });
    await writeFile(heartbeatPath("api"), `${JSON.stringify({
      managedSessionId: "api", cwd: "/tmp/api", state: "waiting", stateSince: now, updatedAt: now,
      piSessionName: "Canonical Name",
      context: { version: 1, updatedAt: now, ticket: { id: "metadata-redesign-001", subtitle: "Simplify session context" } },
    })}\n`, "utf8");
    const controller = new SessionsController(registry, async () => "", async () => "present");
    await controller.refresh(now);
    assert.equal(controller.snapshot().registry.sessions[0]?.title, "Canonical Name");
    assert.equal(controller.snapshot().sessions[0]?.context?.ticket?.subtitle, "Simplify session context");
    assert.equal("context" in (controller.snapshot().registry.sessions[0] ?? {}), false);

    await updateRegistry((latest) => ({ ...latest, sessions: latest.sessions.map((item) => ({ ...item, title: "Manual Recovery", updatedAt: now + 1 })) }));
    await writeFile(heartbeatPath("api"), `${JSON.stringify({
      managedSessionId: "api", cwd: "/tmp/api", state: "waiting", stateSince: now, updatedAt: now - HEARTBEAT_STALE_MS - 1,
      piSessionName: "Stale Name",
    })}\n`, "utf8");
    await controller.refresh(now);
    assert.equal(controller.snapshot().registry.sessions[0]?.title, "Manual Recovery");

    await writeFile(heartbeatPath("api"), `${JSON.stringify({
      managedSessionId: "api", cwd: "/tmp/api", state: "shutdown", stateSince: now, updatedAt: now,
      piSessionName: "Shutdown Name",
    })}\n`, "utf8");
    await controller.refresh(now);
    assert.equal(controller.snapshot().registry.sessions[0]?.title, "Manual Recovery");
  });
});

test("refresh advances the row version when only the Pi name changes", async () => {
  await withTempSessionsDir(async () => {
    const now = 1_000;
    const registry = { version: 1 as const, sessions: [session("waiting", { id: "api", updatedAt: 100, lastActivityAt: 1 })] };
    await updateRegistry(() => registry);
    await mkdir(join(process.env.PI_AGENT_HUB_DIR!, "heartbeats"), { recursive: true });
    await writeFile(heartbeatPath("api"), `${JSON.stringify({
      managedSessionId: "api", cwd: "/tmp/api", state: "waiting", stateSince: 1, updatedAt: now,
      piSessionName: "Canonical Name",
    })}\n`, "utf8");
    const controller = new SessionsController(registry, async () => "", async () => "present");

    await controller.refresh(now);
    assert.equal(controller.snapshot().registry.sessions[0]?.title, "Canonical Name");
    assert.equal(controller.snapshot().registry.sessions[0]?.updatedAt, 1_000);

    await controller.refresh(now);
    assert.equal(controller.snapshot().registry.sessions[0]?.updatedAt, 1_000);
  });
});

test("refresh preserves runtime metadata on same-target conflicts and clears it on retarget", async () => {
  await withTempSessionsDir(async () => {
    const now = 1_000_000;
    const workflow = { steps: [{ id: "execute", short: "EX" }], activeIndex: 0, updatedAt: now };
    const firstMode = { id: "focus", short: "FOC" };
    const secondMode = { id: "review", short: "REV" };
    const registry = { version: 1 as const, sessions: [session("running", { id: "api" })] };
    await updateRegistry(() => registry);
    await mkdir(join(process.env.PI_AGENT_HUB_DIR!, "heartbeats"), { recursive: true });
    const writeRuntime = async (subtitle: string, activeMode: typeof firstMode) => {
      await writeFile(heartbeatPath("api"), `${JSON.stringify({
        managedSessionId: "api", cwd: "/tmp/api", state: "waiting", stateSince: now, updatedAt: now,
        context: { version: 1, updatedAt: now, ticket: { id: "cleanup-009", subtitle } },
        workflow: { ...workflow, activeMode },
      })}\n`, "utf8");
    };
    let duringPresence: (() => Promise<void>) | undefined;
    const controller = new SessionsController(registry, async () => "", async () => {
      await duringPresence?.();
      duringPresence = undefined;
      return "present";
    });

    await writeRuntime("first", firstMode);
    await controller.refresh(now);
    assert.equal(controller.snapshot().sessions[0]?.context?.ticket?.subtitle, "first");
    assert.deepEqual(controller.snapshot().sessions[0]?.workflow?.activeMode, firstMode);

    await writeRuntime("second", secondMode);
    duringPresence = async () => {
      await updateRegistry((latest) => ({
        ...latest,
        sessions: latest.sessions.map((item) => item.id === "api" ? { ...item, title: "manual", updatedAt: item.updatedAt + 1 } : item),
      }));
    };
    await controller.refresh(now + 1);
    assert.equal(controller.snapshot().sessions[0]?.context?.ticket?.subtitle, "first");
    assert.deepEqual(controller.snapshot().sessions[0]?.workflow?.activeMode, firstMode);

    await controller.refresh(now + 2);
    assert.equal(controller.snapshot().sessions[0]?.context?.ticket?.subtitle, "second");
    assert.deepEqual(controller.snapshot().sessions[0]?.workflow?.activeMode, secondMode);

    duringPresence = async () => {
      await updateRegistry((latest) => ({
        ...latest,
        sessions: latest.sessions.map((item) => item.id === "api" ? { ...item, tmuxSession: "new-target", updatedAt: item.updatedAt + 1 } : item),
      }));
    };
    await controller.refresh(now + 3);
    assert.equal(controller.snapshot().sessions[0]?.context, undefined);
    assert.equal(controller.snapshot().sessions[0]?.workflow?.activeMode, undefined);
  });
});

test("pruning clears cached runtime metadata", async () => {
  await withTempSessionsDir(async () => {
    const now = 1_000_000;
    const parent = session("running", { id: "parent" });
    const child = session("running", { id: "child", kind: "subagent", parentId: "parent", tmuxSession: "child-target" });
    const registry = { version: 1 as const, sessions: [parent, child] };
    await updateRegistry(() => registry);
    await mkdir(join(process.env.PI_AGENT_HUB_DIR!, "heartbeats"), { recursive: true });
    await writeFile(heartbeatPath("child"), `${JSON.stringify({
      managedSessionId: "child", cwd: "/tmp/child", state: "waiting", stateSince: now, updatedAt: now,
      context: { version: 1, updatedAt: now, ticket: { id: "cleanup-009" } },
      workflow: { steps: [{ id: "execute", short: "EX" }], activeIndex: 0, updatedAt: now, activeMode: { id: "focus", short: "FOC" } },
    })}\n`, "utf8");
    let childPresence: TmuxPresence = "present";
    const controller = new SessionsController(registry, async () => "", async (name) => name === "child-target" ? childPresence : "present");

    await controller.refresh(now);
    childPresence = "missing";
    await controller.refresh(now + 1);

    const caches = controller as unknown as { sessionContexts: Map<string, unknown>; workflowModes: Map<string, unknown> };
    assert.equal(caches.sessionContexts.has("child"), false);
    assert.equal(caches.workflowModes.has("child"), false);
  });
});

test("moving parent bucket moves child rows too", async () => {
  await withTempSessionsDir(async () => {
    const registry = {
      version: 1 as const,
      sessions: [
        session("idle", { id: "parent", title: "parent", order: 0 }),
        session("running", { id: "child", title: "child", kind: "subagent", parentId: "parent", agentName: "scout" }),
      ],
    };
    await updateRegistry(() => registry);
    const controller = new SessionsController(registry);

    await controller.moveSessionToBucket("parent", "archived", 100);

    assert.equal(controller.snapshot().registry.sessions.find((item) => item.id === "parent")?.bucket, "archived");
    assert.equal(controller.snapshot().registry.sessions.find((item) => item.id === "parent")?.bucketChangedAt, 100);
    assert.equal(controller.snapshot().registry.sessions.find((item) => item.id === "child")?.bucket, "archived");

    await controller.restoreSessionBucket("parent", 200);

    assert.equal(controller.snapshot().registry.sessions.find((item) => item.id === "parent")?.bucket, undefined);
    assert.equal(controller.snapshot().registry.sessions.find((item) => item.id === "parent")?.bucketChangedAt, undefined);
    assert.equal(controller.snapshot().registry.sessions.find((item) => item.id === "child")?.bucket, undefined);
  });
});

test("archiving selected row keeps selection in non-archived rows above its old position", async () => {
  await withTempSessionsDir(async () => {
    const registry = {
      version: 1 as const,
      sessions: [
        session("idle", { id: "a", title: "a", order: 0 }),
        session("idle", { id: "b", title: "b", order: 1 }),
        session("idle", { id: "c", title: "c", order: 2 }),
      ],
    };
    await updateRegistry(() => registry);
    const controller = new SessionsController(registry);
    controller.move(1);

    await controller.moveSessionToBucket("b", "archived", 100);

    assert.equal(controller.snapshot().selectedId, "a");
  });
});

test("archive pruning removes expired archived rows only when tmux is missing", async () => {
  await withTempSessionsDir(async () => {
    const registry = {
      version: 1 as const,
      sessions: [
        session("idle", { id: "active", title: "active" }),
        session("idle", { id: "backlog", title: "backlog", bucket: "backlog", bucketChangedAt: 1 }),
        session("idle", { id: "archived", title: "archived", bucket: "archived", bucketChangedAt: 1, workspaceCwd: multiRepoWorkspacePath("archived") }),
      ],
    };
    await updateRegistry(() => registry);
    await mkdir(multiRepoWorkspacePath("archived"), { recursive: true });
    await mkdir(join(process.env.PI_AGENT_HUB_DIR!, "heartbeats"), { recursive: true });
    await writeFile(heartbeatPath("archived"), `${JSON.stringify({ state: "shutdown", updatedAt: 1, stateSince: 1 })}\n`, "utf8");
    const controller = new SessionsController(registry);

    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    await controller.refresh(1 + sevenDays - 1);
    assert.deepEqual(controller.snapshot().registry.sessions.map((item) => item.id), ["active", "backlog", "archived"]);

    await controller.refresh(1 + sevenDays);

    assert.deepEqual(controller.snapshot().registry.sessions.map((item) => item.id), ["active", "backlog"]);
    await assertPathMissing(multiRepoWorkspacePath("archived"));
    await assertPathMissing(heartbeatPath("archived"));
  });
});

test("refresh reuses the main presence snapshot for expired archive pruning", async () => {
  await withTempSessionsDir(async () => {
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const registry = {
      version: 1 as const,
      sessions: [
        session("idle", { id: "active", title: "active" }),
        session("idle", { id: "archived-present", title: "present", bucket: "archived", bucketChangedAt: 1 }),
        session("idle", { id: "child-present", title: "present child", kind: "subagent", parentId: "archived-present", bucket: "archived", bucketChangedAt: 1 }),
        session("idle", { id: "archived-missing", title: "missing", bucket: "archived", bucketChangedAt: 1 }),
        session("idle", { id: "child-missing", title: "missing child", kind: "subagent", parentId: "archived-missing", bucket: "archived", bucketChangedAt: 1 }),
      ],
    };
    await updateRegistry(() => registry);
    let calls = 0;
    const controller = new SessionsController(registry, async () => "", async (tmuxSession) => {
      calls += 1;
      return tmuxSession.includes("present") ? "present" : "missing";
    });

    await controller.refresh(1 + sevenDays);

    assert.deepEqual(controller.snapshot().registry.sessions.map((item) => item.id), ["active", "archived-present", "child-present"]);
    assert.equal(calls, 5);
  });
});

test("moving parent group moves direct child rows too", async () => {
  await withTempSessionsDir(async () => {
    const registry = {
      version: 1 as const,
      sessions: [
        session("idle", { id: "parent", title: "parent", group: "default", order: 0 }),
        session("running", { id: "child", title: "child", group: "default", kind: "subagent", parentId: "parent", agentName: "scout" }),
      ],
    };
    await updateRegistry(() => registry);
    const controller = new SessionsController(registry);

    await controller.moveSessionToGroup("parent", "work");

    assert.equal(controller.snapshot().registry.sessions.find((item) => item.id === "parent")?.group, "work");
    assert.equal(controller.snapshot().registry.sessions.find((item) => item.id === "child")?.group, "work");
  });
});

test("reorderSelected ignores subagent rows", async () => {
  await withTempSessionsDir(async () => {
    const controller = new SessionsController({
      version: 1,
      sessions: [
        session("idle", { id: "parent", title: "parent", order: 0 }),
        session("running", { id: "child", title: "child", kind: "subagent", parentId: "parent", agentName: "scout" }),
        session("idle", { id: "sibling", title: "sibling", order: 1 }),
      ],
    });

    controller.move(1);
    assert.equal(controller.snapshot().selectedId, "child");
    await controller.reorderSelected(1);

    assert.deepEqual(controller.snapshot().registry.sessions.filter((item) => item.kind !== "subagent").map((item) => [item.id, item.order]), [["parent", 0], ["sibling", 1]]);
  });
});

test("syncPiName renames a session from latest Pi session_info", async () => {
  await withTempSessionsDir(async () => {
    const file = join(process.env.PI_AGENT_HUB_DIR!, "session.jsonl");
    await writeFile(file, `${JSON.stringify({ type: "session_info", name: " Old " })}\n${JSON.stringify({ type: "session_info", name: "Pi Name" })}\n`, "utf8");
    const registry = { version: 1 as const, sessions: [session("idle", { id: "api", title: "hub", sessionFile: file })] };
    await updateRegistry(() => registry);
    const controller = new SessionsController(registry);
    await updateRegistry((latest) => ({
      ...latest,
      sessions: latest.sessions.map((item) => ({ ...item, status: "running" as const, group: "latest" })),
    }));

    const result = await controller.syncPiName("api");

    assert.deepEqual(result, { status: "synced", name: "Pi Name" });
    assert.equal(controller.snapshot().registry.sessions[0]?.title, "Pi Name");
    assert.equal(controller.snapshot().registry.sessions[0]?.status, "running");
    assert.equal(controller.snapshot().registry.sessions[0]?.group, "latest");
    const updatedAt = controller.snapshot().registry.sessions[0]?.updatedAt;
    await controller.syncPiName("api");
    assert.equal(controller.snapshot().registry.sessions[0]?.updatedAt, updatedAt);
  });
});

test("acknowledge reorder and group rename transform the latest registry", async () => {
  await withTempSessionsDir(async () => {
    const a = session("waiting", { id: "a", title: "a", group: "default", order: 0 });
    const b = session("idle", { id: "b", title: "b", group: "default", order: 1 });
    await updateRegistry(() => ({ version: 1, sessions: [a, b] }));
    const controller = new SessionsController({ version: 1, sessions: [a, b] });
    const late = session("idle", { id: "late", title: "late", group: "default", order: 2 });
    await updateRegistry((latest) => ({
      ...latest,
      sessions: [...latest.sessions.map((item) => item.id === "a" ? { ...item, title: "latest a" } : item), late],
    }));

    await controller.acknowledgeSession("a", 50);
    await controller.reorderSelected(1);
    await controller.renameGroup("default", "work");

    const latest = controller.snapshot().registry.sessions;
    assert.equal(latest.find((item) => item.id === "a")?.title, "latest a");
    assert.equal(latest.find((item) => item.id === "a")?.status, "idle");
    assert.equal(latest.find((item) => item.id === "a")?.order, 1);
    assert.equal(latest.find((item) => item.id === "b")?.order, 0);
    assert.deepEqual(latest.map((item) => item.group), ["work", "work", "work"]);
  });
});

test("group and bucket mutations derive ordering and cascades from latest rows", async () => {
  await withTempSessionsDir(async () => {
    const parent = session("idle", { id: "parent", title: "parent", group: "default", order: 0 });
    await updateRegistry(() => ({ version: 1, sessions: [parent] }));
    const controller = new SessionsController({ version: 1, sessions: [parent] });
    const existing = session("idle", { id: "existing", title: "existing", group: "work", order: 5 });
    const child = session("running", { id: "child", title: "child", kind: "subagent", parentId: "parent", group: "default" });
    await updateRegistry((latest) => ({ ...latest, sessions: [...latest.sessions, existing, child] }));

    await controller.moveSessionToGroup("parent", "work", 50);
    await controller.moveSessionToBucket("parent", "backlog", 60);

    const latest = controller.snapshot().registry.sessions;
    assert.equal(latest.find((item) => item.id === "parent")?.order, 6);
    assert.equal(latest.find((item) => item.id === "parent")?.bucket, "backlog");
    assert.equal(latest.find((item) => item.id === "child")?.group, "work");
    assert.equal(latest.find((item) => item.id === "child")?.bucket, "backlog");
    assert.equal(latest.find((item) => item.id === "existing")?.group, "work");

    const grandchild = session("running", { id: "grandchild", title: "grandchild", kind: "subagent", parentId: "child", bucket: "backlog" });
    await updateRegistry((current) => ({ ...current, sessions: [...current.sessions, grandchild] }));
    await controller.restoreSessionBucket("parent", 70);
    assert.deepEqual(controller.snapshot().registry.sessions.filter((item) => ["parent", "child", "grandchild"].includes(item.id)).map((item) => item.bucket), [undefined, undefined, undefined]);
  });
});

test("refresh merges observations into latest rows and leaves new rows untouched", async () => {
  await withTempSessionsDir(async () => {
    const original = session("idle", { id: "api", title: "api", group: "default" });
    await updateRegistry(() => ({ version: 1, sessions: [original] }));
    const external = session("stopped", { id: "external", title: "external" });
    let changed = false;
    const controller = new SessionsController({ version: 1, sessions: [original] }, async () => "", async () => {
      if (!changed) {
        changed = true;
        await updateRegistry((latest) => ({
          ...latest,
          sessions: [...latest.sessions.map((item) => item.id === "api" ? { ...item, title: "latest", group: "work", acknowledgedAt: 99 } : item), external],
        }));
      }
      return "present";
    });

    await controller.refresh(100);

    const [api, added] = controller.snapshot().registry.sessions;
    assert.equal(api?.title, "latest");
    assert.equal(api?.group, "work");
    assert.equal(api?.status, "idle");
    assert.deepEqual(added, external);
  });
});

test("refresh pruning uses latest bucket and cascade state", async () => {
  await withTempSessionsDir(async () => {
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const archived = session("idle", { id: "archived", title: "archived", bucket: "archived", bucketChangedAt: 1 });
    await updateRegistry(() => ({ version: 1, sessions: [archived] }));
    const lateChild = session("running", { id: "late-child", title: "late-child", kind: "subagent", parentId: "archived", bucket: "archived", bucketChangedAt: 1 });
    let changed = false;
    const controller = new SessionsController({ version: 1, sessions: [archived] }, async () => "", async () => {
      if (!changed) {
        changed = true;
        await updateRegistry((latest) => ({
          ...latest,
          sessions: [...latest.sessions.map((item) => item.id === "archived" ? { ...item, bucket: undefined, bucketChangedAt: undefined } : item), lateChild],
        }));
      }
      return "missing";
    });

    await controller.refresh(1 + sevenDays);

    assert.deepEqual(controller.snapshot().registry.sessions.map((item) => item.id), ["archived", "late-child"]);
    assert.equal(controller.snapshot().registry.sessions[0]?.bucket, undefined);
  });
});

test("refresh ignores observations when the tmux target changed", async () => {
  await withTempSessionsDir(async () => {
    const original = session("waiting", { id: "child", kind: "subagent", parentId: "parent", tmuxSession: "old-target" });
    await updateRegistry(() => ({ version: 1, sessions: [original] }));
    const controller = new SessionsController({ version: 1, sessions: [original] }, async () => "", async () => {
      await updateRegistry((latest) => ({
        ...latest,
        sessions: latest.sessions.map((item) => item.id === "child" ? { ...item, tmuxSession: "new-target", status: "running" as const } : item),
      }));
      return "missing";
    });

    await controller.refresh(100);

    assert.equal(controller.snapshot().registry.sessions[0]?.tmuxSession, "new-target");
    assert.equal(controller.snapshot().registry.sessions[0]?.status, "running");
  });
});

test("refresh ignores an observation after the row version changes", async () => {
  await withTempSessionsDir(async () => {
    const now = 1_000;
    const registry = { version: 1 as const, sessions: [session("running", { id: "api", sessionFile: "new-session.json" })] };
    await updateRegistry(() => registry);
    await mkdir(join(process.env.PI_AGENT_HUB_DIR!, "heartbeats"), { recursive: true });
    await writeFile(heartbeatPath("api"), `${JSON.stringify({
      managedSessionId: "api", cwd: "/tmp/api", state: "waiting", stateSince: now, updatedAt: now,
      piSessionFile: "old-session.json",
    })}\n`, "utf8");
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const controller = new SessionsController(registry, async () => "", async () => {
      entered();
      await blocked;
      return "present";
    });

    const refreshing = controller.refresh(now);
    await started;
    await updateRegistry((latest) => ({
      ...latest,
      sessions: latest.sessions.map((item) => item.id === "api" ? { ...item, sessionFile: "newer-session.json", status: "idle", acknowledgedAt: now + 1, updatedAt: now + 1 } : item),
    }));
    release();
    await refreshing;

    assert.equal(controller.snapshot().registry.sessions[0]?.sessionFile, "newer-session.json");
    assert.equal(controller.snapshot().sessions[0]?.status, "idle");
    assert.equal(controller.snapshot().sessions[0]?.statusEvidence, undefined);
  });
});

test("syncPiName reports unavailable and unnamed sessions without renaming", async () => {
  await withTempSessionsDir(async () => {
    const file = join(process.env.PI_AGENT_HUB_DIR!, "session.jsonl");
    await writeFile(file, `${JSON.stringify({ type: "session_info", name: "" })}\n`, "utf8");
    const controller = new SessionsController({
      version: 1,
      sessions: [
        session("idle", { id: "missing", title: "missing" }),
        session("idle", { id: "unnamed", title: "unnamed", sessionFile: file }),
      ],
    });

    assert.deepEqual(await controller.syncPiName("missing"), { status: "unavailable" });
    assert.deepEqual(await controller.syncPiName("unnamed"), { status: "unnamed" });
    assert.deepEqual(controller.snapshot().registry.sessions.map((item) => item.title), ["missing", "unnamed"]);
  });
});
