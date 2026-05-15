import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
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

test("pi-hub config manages session-prelude", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-cli-config-"));
  const env = { PI_AGENT_HUB_DIR: root };
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
  assert.doesNotMatch(doctor.stdout, /echo setup/);

  const unset = await runCli(["config", "unset", "session-prelude"], env);
  assert.equal(unset.code, 0, unset.stderr);
  assert.match(unset.stdout, /unset session-prelude/);

  const after = await runCli(["doctor"], env);
  assert.equal(after.code, 0, after.stderr);
  assert.match(after.stdout, /session prelude: none/);
});
