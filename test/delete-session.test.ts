import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import { deleteManagedSession } from "../src/app/delete-session.js";
import { createSessionRecord, loadRegistry, saveRegistry } from "../src/core/registry.js";
import { heartbeatPath, registryPath } from "../src/core/paths.js";

const execFileAsync = promisify(execFile);

async function tempEnv() {
  const root = await mkdtemp(join(tmpdir(), "pi-sessions-delete-"));
  return {
    PI_CODING_AGENT_DIR: join(root, "agent"),
    PI_SESSIONS_DIR: join(root, "sessions"),
  };
}

test("deleteManagedSession accepts id prefix and removes full-id heartbeat", async () => {
  const env = await tempEnv();
  const session = createSessionRecord({ cwd: "/tmp/api", title: "api", now: 1 });
  await saveRegistry({ version: 1, sessions: [session] }, registryPath(env));
  await mkdir(join(env.PI_SESSIONS_DIR, "heartbeats"), { recursive: true });
  await writeFile(heartbeatPath(session.id, env), JSON.stringify({ ok: true }), "utf8");

  const deleted = await deleteManagedSession(session.id.slice(0, 8), { env });

  assert.deepEqual(deleted, { id: session.id, title: "api" });
  assert.deepEqual(await loadRegistry(registryPath(env)), { version: 1, sessions: [] });
  await assert.rejects(readFile(heartbeatPath(session.id, env), "utf8"), /ENOENT/);
});

test("pi-sessions delete removes registry row and heartbeat file", async () => {
  const env = await tempEnv();
  const session = createSessionRecord({ cwd: "/tmp/api", title: "api", now: 1 });
  await saveRegistry({ version: 1, sessions: [session] }, registryPath(env));
  await mkdir(join(env.PI_SESSIONS_DIR, "heartbeats"), { recursive: true });
  await writeFile(heartbeatPath(session.id, env), JSON.stringify({ ok: true }), "utf8");

  const result = await execFileAsync(process.execPath, ["dist/cli.js", "delete", session.id.slice(0, 8)], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });

  assert.match(result.stdout, new RegExp(`deleted ${session.id}\\tapi`));
  assert.deepEqual(await loadRegistry(registryPath(env)), { version: 1, sessions: [] });
  await assert.rejects(readFile(heartbeatPath(session.id, env), "utf8"), /ENOENT/);
});
