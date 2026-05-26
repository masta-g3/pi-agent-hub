import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionsController } from "../src/app/controller.js";
import type { ManagedSession } from "../src/core/types.js";

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

test("movement follows stable registry order within groups", () => {
  const controller = new SessionsController({
    version: 1,
    sessions: [
      session("idle", { id: "work", title: "work", group: "work" }),
      session("idle", { id: "b", title: "b", group: "default" }),
      session("error", { id: "a", title: "a", group: "default" }),
    ],
  });

  assert.equal(controller.snapshot().selectedId, "b");
  controller.move(1);
  assert.equal(controller.snapshot().selectedId, "a");
  controller.move(1);
  assert.equal(controller.snapshot().selectedId, "work");
  controller.move(-1);
  assert.equal(controller.snapshot().selectedId, "a");
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
    const controller = new SessionsController({
      version: 1,
      sessions: [
        session("idle", { id: "a", title: "a", group: "default", order: 0 }),
        session("idle", { id: "b", title: "b", group: "default", order: 1 }),
        session("idle", { id: "work", title: "work", group: "work", order: 0 }),
      ],
    });

    await controller.moveSessionToGroup("a", "default");
    assert.deepEqual(controller.snapshot().registry.sessions.find((item) => item.id === "a")?.order, 0);

    await controller.moveSessionToGroup("a", "work");
    assert.deepEqual(controller.snapshot().registry.sessions.find((item) => item.id === "a")?.order, 1);
  });
});

test("reorderSelected swaps selected session within its group and clamps at borders", async () => {
  await withTempSessionsDir(async () => {
    const controller = new SessionsController({
      version: 1,
      sessions: [
        session("idle", { id: "a", title: "a", order: 0 }),
        session("idle", { id: "b", title: "b", order: 1 }),
        session("idle", { id: "c", title: "c", order: 2 }),
        session("idle", { id: "work", title: "work", group: "work", order: 0 }),
      ],
    });

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

test("refresh prunes subagent rows whose tmux sessions are gone", async () => {
  await withTempSessionsDir(async () => {
    const registry = {
      version: 1 as const,
      sessions: [
        session("idle", { id: "parent", title: "parent", order: 0 }),
        session("waiting", { id: "child", title: "child", kind: "subagent" as const, parentId: "parent", agentName: "scout" }),
      ],
    };
    await writeFile(join(process.env.PI_AGENT_HUB_DIR!, "registry.json"), `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    const controller = new SessionsController(registry);

    await controller.refresh(10);

    assert.deepEqual(controller.snapshot().registry.sessions.map((item) => item.id), ["parent"]);
  });
});

test("moving parent group moves direct child rows too", async () => {
  await withTempSessionsDir(async () => {
    const controller = new SessionsController({
      version: 1,
      sessions: [
        session("idle", { id: "parent", title: "parent", group: "default", order: 0 }),
        session("running", { id: "child", title: "child", group: "default", kind: "subagent", parentId: "parent", agentName: "scout" }),
      ],
    });

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
    const controller = new SessionsController({ version: 1, sessions: [session("idle", { id: "api", title: "hub", sessionFile: file })] });

    const result = await controller.syncPiName("api");

    assert.deepEqual(result, { status: "synced", name: "Pi Name" });
    assert.equal(controller.snapshot().registry.sessions[0]?.title, "Pi Name");
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
