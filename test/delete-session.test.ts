import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import { deleteManagedSession, deleteManagedSubagentSessions, removeSessions } from "../src/app/delete-session.js";
import { createSessionRecord, loadRegistry, updateRegistry } from "../src/core/registry.js";
import { heartbeatPath, multiRepoWorkspacePath, registryPath } from "../src/core/paths.js";

const execFileAsync = promisify(execFile);

function seedRegistry(registry: import("../src/core/types.js").SessionsRegistry, path: string): Promise<import("../src/core/types.js").SessionsRegistry> {
  return updateRegistry(() => registry, path);
}

async function tempEnv() {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-delete-"));
  return {
    PI_CODING_AGENT_DIR: join(root, "agent"),
    PI_AGENT_HUB_DIR: join(root, "sessions"),
  };
}

test("removeSessions removes only prepared ids from the latest registry", async () => {
  const env = await tempEnv();
  const path = registryPath(env);
  const parent = createSessionRecord({ cwd: "/tmp/parent", now: 1 });
  const unrelated = createSessionRecord({ cwd: "/tmp/unrelated", now: 1 });
  await seedRegistry({ version: 1, sessions: [parent, unrelated] }, path);
  const lateChild = { ...createSessionRecord({ cwd: "/tmp/child", now: 2 }), kind: "subagent" as const, parentId: parent.id };
  await updateRegistry((latest) => ({
    ...latest,
    sessions: [...latest.sessions.map((item) => item.id === unrelated.id ? { ...item, group: "latest" } : item), lateChild],
  }), path);

  await removeSessions([parent], path, env);

  const remaining = await loadRegistry(path);
  assert.deepEqual(remaining.sessions.map((item) => item.id), [unrelated.id, lateChild.id]);
  assert.equal(remaining.sessions[0]?.group, "latest");
});

test("deleteManagedSession accepts id prefix and removes the full-id heartbeat", async () => {
  const env = await tempEnv();
  const session = createSessionRecord({ cwd: "/tmp/api", now: 1 });
  await seedRegistry({ version: 1, sessions: [session] }, registryPath(env));
  await mkdir(join(env.PI_AGENT_HUB_DIR, "heartbeats"), { recursive: true });
  await writeFile(heartbeatPath(session.id, env), JSON.stringify({ ok: true }), "utf8");

  const deleted = await deleteManagedSession(session.id.slice(0, 8), { env });

  assert.deepEqual(deleted, { id: session.id, title: "New · api" });
  assert.deepEqual(await loadRegistry(registryPath(env)), { version: 1, sessions: [] });
  await assert.rejects(readFile(heartbeatPath(session.id, env), "utf8"), /ENOENT/);
});

test("deleteManagedSession cascades mirrored subagent rows", async () => {
  const env = await tempEnv();
  const parent = createSessionRecord({ cwd: "/tmp/api", now: 1 });
  const child = {
    ...createSessionRecord({ cwd: "/tmp/api", now: 2 }),
    id: "child-session",
    tmuxSession: "pi-agent-hub-child",
    kind: "subagent" as const,
    parentId: parent.id,
    agentName: "smoke",
  };
  await seedRegistry({ version: 1, sessions: [parent, child] }, registryPath(env));
  await mkdir(join(env.PI_AGENT_HUB_DIR, "heartbeats"), { recursive: true });
  await writeFile(heartbeatPath(parent.id, env), JSON.stringify({ ok: true }), "utf8");
  await writeFile(heartbeatPath(child.id, env), JSON.stringify({ ok: true }), "utf8");

  await deleteManagedSession(parent.id, { env });

  assert.deepEqual(await loadRegistry(registryPath(env)), { version: 1, sessions: [] });
  await assert.rejects(readFile(heartbeatPath(parent.id, env), "utf8"), /ENOENT/);
  await assert.rejects(readFile(heartbeatPath(child.id, env), "utf8"), /ENOENT/);
});

test("deleteManagedSubagentSessions removes child rows without deleting parent", async () => {
  const env = await tempEnv();
  const parent = createSessionRecord({ cwd: "/tmp/api", now: 1 });
  const child = {
    ...createSessionRecord({ cwd: "/tmp/api", now: 2 }),
    id: "child-session",
    tmuxSession: "pi-agent-hub-child",
    kind: "subagent" as const,
    parentId: parent.id,
    agentName: "smoke",
  };
  await seedRegistry({ version: 1, sessions: [parent, child] }, registryPath(env));
  await mkdir(join(env.PI_AGENT_HUB_DIR, "heartbeats"), { recursive: true });
  await writeFile(heartbeatPath(parent.id, env), JSON.stringify({ ok: true }), "utf8");
  await writeFile(heartbeatPath(child.id, env), JSON.stringify({ ok: true }), "utf8");

  const deleted = await deleteManagedSubagentSessions(parent.id, { env });

  assert.deepEqual(deleted, { id: parent.id, title: "New · api", count: 1 });
  assert.deepEqual(await loadRegistry(registryPath(env)), { version: 1, sessions: [parent] });
  assert.equal(await readFile(heartbeatPath(parent.id, env), "utf8"), JSON.stringify({ ok: true }));
  await assert.rejects(readFile(heartbeatPath(child.id, env), "utf8"), /ENOENT/);
});

test("deleteManagedSession keeps hub-owned worktree directories", async () => {
  const env = await tempEnv();
  const worktreePath = join(env.PI_AGENT_HUB_DIR, "worktrees", "api", "session-feature");
  const session = {
    ...createSessionRecord({ cwd: worktreePath, now: 1 }),
    worktreePath,
    worktreeRepoRoot: "/repo/api",
    worktreeBranch: "feature/api",
    worktreeBaseBranch: "main",
    worktreeOwnedByHub: true,
  };
  await seedRegistry({ version: 1, sessions: [session] }, registryPath(env));
  await mkdir(worktreePath, { recursive: true });

  await deleteManagedSession(session.id, { env });

  assert.deepEqual(await loadRegistry(registryPath(env)), { version: 1, sessions: [] });
  assert.equal((await lstat(worktreePath)).isDirectory(), true);
});

test("deleteManagedSession removes owned multi-repo workspace", async () => {
  const env = await tempEnv();
  const workspaceCwd = multiRepoWorkspacePath("multi-session", env);
  const session = {
    ...createSessionRecord({ cwd: "/tmp/api", now: 1 }),
    id: "multi-session",
    tmuxSession: "pi-agent-hub-multi",
    additionalCwds: ["/tmp/web"],
    workspaceCwd,
  };
  await seedRegistry({ version: 1, sessions: [session] }, registryPath(env));
  await mkdir(workspaceCwd, { recursive: true });

  await deleteManagedSession(session.id, { env });

  assert.deepEqual(await loadRegistry(registryPath(env)), { version: 1, sessions: [] });
  await assert.rejects(lstat(workspaceCwd), /ENOENT/);
});

test("pi-agent-hub delete removes registry row and heartbeat file", async () => {
  const env = await tempEnv();
  const session = createSessionRecord({ cwd: "/tmp/api", now: 1 });
  await seedRegistry({ version: 1, sessions: [session] }, registryPath(env));
  await mkdir(join(env.PI_AGENT_HUB_DIR, "heartbeats"), { recursive: true });
  await writeFile(heartbeatPath(session.id, env), JSON.stringify({ ok: true }), "utf8");

  const result = await execFileAsync(process.execPath, ["dist/cli.js", "delete", session.id.slice(0, 8)], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });

  assert.match(result.stdout, new RegExp(`deleted ${session.id}\\tNew · api`));
  assert.deepEqual(await loadRegistry(registryPath(env)), { version: 1, sessions: [] });
  await assert.rejects(readFile(heartbeatPath(session.id, env), "utf8"), /ENOENT/);
});
