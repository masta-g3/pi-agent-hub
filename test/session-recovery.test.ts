import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { automaticRecoveryAfterTmuxRestart, automaticRecoveryMessage, observeTmuxServerIdentity, recoverMissingManagedSessions } from "../src/app/session-recovery.js";
import { registryPath } from "../src/core/paths.js";
import { loadRegistry, saveRegistry } from "../src/core/registry.js";
import type { ManagedSession } from "../src/core/types.js";
import type { TmuxServerIdentity } from "../src/core/tmux.js";

function session(id: string, cwd: string, overrides: Partial<ManagedSession> = {}): ManagedSession {
  return {
    id,
    title: id,
    cwd,
    group: "default",
    tmuxSession: `pi-agent-hub-${id}`,
    status: "waiting",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function envFor(root: string): NodeJS.ProcessEnv {
  return { ...process.env, PI_AGENT_HUB_DIR: join(root, "hub") };
}

const serverA: TmuxServerIdentity = { pid: 100, startedAt: 1_000, socketPath: "/tmp/tmux/default" };
const serverB: TmuxServerIdentity = { pid: 200, startedAt: 2_000, socketPath: "/tmp/tmux/default" };

test("recoverMissingManagedSessions restores only missing active parent sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-recovery-"));
  const cwd = join(root, "repo");
  const history = join(root, "saved.jsonl");
  const env = envFor(root);
  await mkdir(cwd);
  await writeFile(history, "{}\n", "utf8");
  await saveRegistry({ version: 1, sessions: [
    session("missing", cwd, { sessionFile: history, error: "tmux session is missing" }),
    session("present", cwd),
    session("stopped", cwd, { status: "stopped" }),
    session("backlog", cwd, { bucket: "backlog" }),
    session("archived", cwd, { bucket: "archived" }),
    session("child", cwd, { kind: "subagent", parentId: "missing" }),
  ] }, registryPath(env));
  const started: string[] = [];

  const report = await recoverMissingManagedSessions({
    env,
    deps: {
      presence: async (name) => name.endsWith("present") ? "present" : "missing",
      start: async (id) => { started.push(id); },
    },
  });

  assert.deepEqual(started, ["missing"]);
  assert.deepEqual(report.recovered, [{ id: "missing", title: "missing" }]);
  assert.deepEqual(report.skipped, [{ id: "present", title: "present", reason: "already running" }]);
  assert.deepEqual(report.failed, []);
  const saved = await loadRegistry(registryPath(env));
  assert.equal(saved.sessions.find((item) => item.id === "missing")?.status, "starting");
  assert.equal(saved.sessions.find((item) => item.id === "missing")?.error, undefined);
  assert.equal(saved.sessions.find((item) => item.id === "stopped")?.status, "stopped");
  assert.equal(saved.sessions.find((item) => item.id === "backlog")?.status, "waiting");
});

test("recovery isolates invalid paths, missing history, and start failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-recovery-failure-"));
  const cwd = join(root, "repo");
  const history = join(root, "saved.jsonl");
  const env = envFor(root);
  await mkdir(cwd);
  await writeFile(history, "{}\n", "utf8");
  await saveRegistry({ version: 1, sessions: [
    session("missing-cwd", join(root, "gone"), { sessionFile: history }),
    session("missing-history", cwd, { sessionFile: join(root, "gone.jsonl") }),
    session("start-fails", cwd, { sessionFile: history }),
    session("healthy", cwd, { sessionFile: history }),
  ] }, registryPath(env));
  const started: string[] = [];

  const report = await recoverMissingManagedSessions({
    env,
    deps: {
      presence: async () => "missing",
      start: async (id) => {
        started.push(id);
        if (id === "start-fails") throw new Error("tmux refused to create the session");
      },
    },
  });

  assert.deepEqual(started, ["start-fails", "healthy"]);
  assert.deepEqual(report.recovered, [{ id: "healthy", title: "healthy" }]);
  assert.equal(report.failed.length, 3);
  assert.match(report.failed.find((item) => item.id === "missing-cwd")?.error ?? "", /cwd is unavailable/);
  assert.match(report.failed.find((item) => item.id === "missing-history")?.error ?? "", /Pi session history is unavailable/);
  assert.match(report.failed.find((item) => item.id === "start-fails")?.error ?? "", /tmux refused/);

  const saved = await loadRegistry(registryPath(env));
  for (const id of ["missing-cwd", "missing-history", "start-fails"]) {
    const failed = saved.sessions.find((item) => item.id === id);
    assert.equal(failed?.status, "error");
    assert.match(failed?.recoveryError ?? "", /^recovery failed:/);
  }
  assert.equal(saved.sessions.find((item) => item.id === "healthy")?.status, "starting");
});

test("observeTmuxServerIdentity changes only when the server epoch changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-server-identity-"));
  const path = join(root, "tmux-server.json");

  assert.deepEqual(await observeTmuxServerIdentity(serverA, path), { previous: undefined, changed: false });
  assert.deepEqual(await observeTmuxServerIdentity(serverA, path), { previous: serverA, changed: false });
  assert.deepEqual(await observeTmuxServerIdentity(serverB, path), { previous: serverA, changed: true });
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { version: 1, identity: serverB });
});

test("automatic recovery establishes a baseline and runs only after tmux restarts", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-auto-recovery-"));
  const cwd = join(root, "repo");
  const history = join(root, "saved.jsonl");
  const env = envFor(root);
  await mkdir(cwd);
  await writeFile(history, "{}\n", "utf8");
  await saveRegistry({ version: 1, sessions: [session("api", cwd, { sessionFile: history })] }, registryPath(env));
  const started: string[] = [];
  const deps = { presence: async () => "missing" as const, start: async (id: string) => { started.push(id); } };

  const baseline = await automaticRecoveryAfterTmuxRestart({ env, identity: async () => serverA, deps });
  const unchanged = await automaticRecoveryAfterTmuxRestart({ env, identity: async () => serverA, deps });
  const restarted = await automaticRecoveryAfterTmuxRestart({ env, identity: async () => serverB, deps });

  assert.equal(baseline.status, "baseline");
  assert.equal(unchanged.status, "unchanged");
  assert.equal(restarted.status, "restarted");
  assert.deepEqual(started, ["api"]);
  assert.equal(automaticRecoveryMessage(restarted), "tmux restarted: recovered 1 session");
});
