import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const child = spawn(process.execPath, ["dist/cli.js", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  return { stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), code };
}

test("pi-hub config manages worktree-default", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-cli-config-"));
  const env = { PI_AGENT_HUB_DIR: root };

  const set = await runCli(["config", "set", "worktree-default", "true"], env);
  assert.equal(set.code, 0, set.stderr);
  assert.match(set.stdout, /enabled worktree-default/);

  const get = await runCli(["config", "get"], env);
  assert.equal(get.code, 0, get.stderr);
  assert.equal(JSON.parse(get.stdout).session.worktreeDefault, true);

  const unset = await runCli(["config", "unset", "worktree-default"], env);
  assert.equal(unset.code, 0, unset.stderr);
  assert.match(unset.stdout, /unset worktree-default/);
});

test("pi-hub config manages session-prelude", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-cli-config-"));
  const env = { PI_AGENT_HUB_DIR: root, PI_CODING_AGENT_DIR: join(root, "agent") };
  const prelude = "echo setup && echo done";

  const set = await runCli(["config", "set", "session-prelude", prelude], env);
  assert.equal(set.code, 0, set.stderr);
  assert.match(set.stdout, /updated session-prelude/);

  const get = await runCli(["config", "get"], env);
  assert.equal(get.code, 0, get.stderr);
  assert.equal(JSON.parse(get.stdout).session.prelude, prelude);

  const doctor = await runCli(["doctor"], env);
  assert.equal(doctor.code, 0, doctor.stderr);
  assert.match(doctor.stdout, /session prelude: configured/);
  assert.match(doctor.stdout, /cli package: pi-package-missing/);
  assert.doesNotMatch(doctor.stdout, /echo setup/);

  const unset = await runCli(["config", "unset", "session-prelude"], env);
  assert.equal(unset.code, 0, unset.stderr);
  assert.match(unset.stdout, /unset session-prelude/);

  const after = await runCli(["doctor"], env);
  assert.equal(after.code, 0, after.stderr);
  assert.match(after.stdout, /session prelude: none/);
});


test("pi-hub doctor reports sidebar return binding state", async () => {
  const state = await mkdtemp(join(tmpdir(), "pi-agent-hub-cli-sidebar-return-"));
  const sidebarReturn = join(state, "sidebar-return");
  await mkdir(sidebarReturn, { recursive: true });
  await writeFile(join(sidebarReturn, "active.json"), JSON.stringify({
    ownerPid: process.pid,
    dashboardSession: "pi-agent-hub",
    sidebarPane: "%1",
    returnKey: "C-q",
    restorePath: join(sidebarReturn, "previous.tmux"),
  }));

  const doctor = await runCli(["doctor"], { PI_AGENT_HUB_DIR: state });

  assert.equal(doctor.code, 0, doctor.stderr);
  assert.match(doctor.stdout, /sidebar return: active C-q -> %1/);
});

test("pi-hub doctor reports Pi package CLI drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-cli-install-"));
  const agent = join(root, "agent");
  const state = join(root, "state");
  const piPackage = join(agent, "npm", "node_modules", "pi-agent-hub");
  await mkdir(piPackage, { recursive: true });
  await writeFile(join(piPackage, "package.json"), JSON.stringify({ name: "pi-agent-hub", version: "999.0.0" }));

  const doctor = await runCli(["doctor"], { PI_CODING_AGENT_DIR: agent, PI_AGENT_HUB_DIR: state });

  assert.equal(doctor.code, 0, doctor.stderr);
  assert.match(doctor.stdout, /cli package: version-mismatch/);
  assert.match(doctor.stdout, /pi package: .*999\.0\.0/);
  assert.match(doctor.stdout, /cli warning: PATH may resolve a stale global dashboard CLI/);
});
