import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { explainSession, resolveSessionId } from "../src/app/explain-session.js";
import type { ManagedSession, SessionsRegistry } from "../src/core/types.js";
import type { SessionObservation } from "../src/app/session-observation.js";

function session(id: string, overrides: Partial<ManagedSession> = {}): ManagedSession {
  return {
    id,
    title: id,
    cwd: `/tmp/${id}`,
    group: "default",
    tmuxSession: `pi-agent-hub-${id}`,
    status: "waiting",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test("session lookup prefers exact ids and accepts only unique prefixes", () => {
  const sessions = [session("abc"), session("abc-long"), session("def")];
  assert.equal(resolveSessionId(sessions, "abc").id, "abc");
  assert.equal(resolveSessionId(sessions, "d").id, "def");
  assert.throws(() => resolveSessionId(sessions, "missing"), /Session not found/);
  assert.throws(() => resolveSessionId(sessions, "ab"), /Ambiguous session prefix/);
});

test("ambiguous prefix output is bounded", () => {
  const sessions = Array.from({ length: 7 }, (_, index) => session(`same-${index}`));
  assert.throws(() => resolveSessionId(sessions, "same"), (error: unknown) => {
    assert.match(String(error), /same-0/);
    assert.match(String(error), /same-4/);
    assert.doesNotMatch(String(error), /same-5/);
    assert.match(String(error), /\+2 more/);
    return true;
  });
});

test("live explanation observes the full fleet and names the deterministic active descendant", async () => {
  const now = 100_000;
  const parent = session("parent", { title: "Parent" });
  const first = session("first", { kind: "subagent", parentId: parent.id, agentName: "first" });
  const second = session("second", { kind: "subagent", parentId: parent.id, agentName: "second" });
  const registry: SessionsRegistry = { version: 1, sessions: [parent, first, second] };
  let observed = 0;
  const observations = new Map<string, SessionObservation>(registry.sessions.map((item) => [item.id, {
    tmuxSession: item.tmuxSession,
    observedUpdatedAt: item.updatedAt,
    presence: "present",
    heartbeat: {
      managedSessionId: item.id,
      cwd: item.cwd,
      state: item.kind === "subagent" ? "running" : "waiting",
      stateSince: now - 1_000,
      updatedAt: now,
    },
  }]));

  const output = await explainSession("par", {
    load: async () => registry,
    observe: async (sessions) => { observed += 1; assert.equal(sessions.length, 3); return observations; },
    now: () => now,
  });

  assert.equal(observed, 1);
  assert.match(output, /^parent\tParent/m);
  assert.match(output, /tmux\s+✓ tmux session present/);
  assert.match(output, /result\s+→ waiting · ACTIVE · fresh heartbeat reports an unread result; first is running/);
});

test("unknown tmux observation is not described as a missing session", async () => {
  const item = session("unknown");
  const output = await explainSession(item.id, {
    load: async () => ({ version: 1, sessions: [item] }),
    observe: async () => new Map([[item.id, {
      tmuxSession: item.tmuxSession,
      observedUpdatedAt: item.updatedAt,
      presence: "unknown",
      error: "tmux command timed out",
    }]]),
    now: () => 100,
  });

  assert.match(output, /tmux\s+× tmux did not answer · tmux command timed out/);
  assert.doesNotMatch(output, /tmux session missing/);
});

test("compiled CLI explanation is read-only", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-hub-explain-"));
  try {
    await mkdir(root, { recursive: true });
    const path = join(root, "registry.json");
    const registry: SessionsRegistry = { version: 1, sessions: [session("explain-test-unique", { status: "stopped", title: "Stopped session" })] };
    await writeFile(path, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    const before = await readFile(path, "utf8");
    const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
    const result = spawnSync(process.execPath, [cliPath, "explain", "explain-test"], {
      encoding: "utf8",
      env: { ...process.env, PI_AGENT_HUB_DIR: root },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /explain-test-unique\tStopped session/);
    assert.match(result.stdout, /result\s+→ stopped · QUIET/);
    assert.equal(await readFile(path, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
