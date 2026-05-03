import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { currentTmuxClient, currentTmuxSession, restoreSwitchReturnBinding, switchClientWithReturn, type TmuxExec } from "../src/core/tmux.js";
import type { CommandResult } from "../src/core/types.js";

interface Call {
  command: string;
  args: string[];
}

function fakeTmux(handler: (call: Call) => CommandResult | Promise<CommandResult>): TmuxExec & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async exec(command, args) {
      const call = { command, args };
      calls.push(call);
      return handler(call);
    },
  };
}

test("currentTmuxSession reads and trims the current tmux session", async () => {
  const exec = fakeTmux(() => ({ stdout: "control\n", stderr: "" }));

  await assert.equal(await currentTmuxSession(exec), "control");
  assert.deepEqual(exec.calls, [{ command: "tmux", args: ["display-message", "-p", "#{session_name}"] }]);
});

test("currentTmuxClient reads and trims the current tmux client", async () => {
  const exec = fakeTmux(() => ({ stdout: "/dev/ttys011\n", stderr: "" }));

  await assert.equal(await currentTmuxClient(exec), "/dev/ttys011");
  assert.deepEqual(exec.calls, [{ command: "tmux", args: ["display-message", "-p", "#{client_name}"] }]);
});

test("switchClientWithReturn installs return binding then switches client", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-center-return-"));
  const exec = fakeTmux((call) => {
    const subcommand = call.args[0];
    if (subcommand === "display-message" && call.args[2] === "#{session_name}") return { stdout: "control\n", stderr: "" };
    if (subcommand === "display-message" && call.args[2] === "#{client_name}") return { stdout: "/dev/ttys011\n", stderr: "" };
    if (subcommand === "list-keys") return { stdout: "bind-key -T root C-q send-prefix\n", stderr: "" };
    return { stdout: "", stderr: "" };
  });

  await switchClientWithReturn({ targetSession: "pi-center-target", stateDir }, exec);

  assert.deepEqual(exec.calls.map((call) => call.args[0] === "bind-key" ? call.args.slice(0, 4) : call.args), [
    ["display-message", "-p", "#{session_name}"],
    ["display-message", "-p", "#{client_name}"],
    ["list-keys", "-T", "root", "C-q"],
    ["bind-key", "-n", "C-q", "run-shell"],
    ["switch-client", "-c", "/dev/ttys011", "-t", "pi-center-target"],
  ]);
  const script = exec.calls.find((call) => call.args[0] === "bind-key")?.args[4] ?? "";
  assert.match(script, /pi-center-\*/);
  assert.doesNotMatch(script, /\*\);/);
  assert.match(script, /control/);
  assert.match(script, /previous\.tmux/);
  assert.match(script, /active\.json/);
  assert.match(script, /source-file/);
  assert.match(script, /unbind-key/);
});

test("switchClientWithReturn handles absent previous binding", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-center-return-"));
  const exec = fakeTmux((call) => {
    if (call.args[0] === "display-message" && call.args[2] === "#{session_name}") return { stdout: "control\n", stderr: "" };
    if (call.args[0] === "display-message" && call.args[2] === "#{client_name}") return { stdout: "/dev/ttys011\n", stderr: "" };
    if (call.args[0] === "list-keys") throw new Error("unknown key: C-q");
    return { stdout: "", stderr: "" };
  });

  await switchClientWithReturn({ targetSession: "pi-center-target", stateDir }, exec);

  assert.equal(exec.calls.some((call) => call.args[0] === "bind-key"), true);
  assert.equal(exec.calls.some((call) => call.args[0] === "switch-client"), true);
});

test("switchClientWithReturn rethrows unexpected list-keys failures", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-center-return-"));
  const exec = fakeTmux((call) => {
    if (call.args[0] === "display-message" && call.args[2] === "#{session_name}") return { stdout: "control\n", stderr: "" };
    if (call.args[0] === "display-message" && call.args[2] === "#{client_name}") return { stdout: "/dev/ttys011\n", stderr: "" };
    if (call.args[0] === "list-keys") throw new Error("tmux server unavailable");
    return { stdout: "", stderr: "" };
  });

  await assert.rejects(() => switchClientWithReturn({ targetSession: "pi-center-target", stateDir }, exec), /tmux server unavailable/);
  assert.equal(exec.calls.some((call) => call.args[0] === "bind-key"), false);
  assert.equal(exec.calls.some((call) => call.args[0] === "switch-client"), false);
});

test("switchClientWithReturn restores binding when switch fails after bind", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-center-return-"));
  const exec = fakeTmux((call) => {
    if (call.args[0] === "display-message" && call.args[2] === "#{session_name}") return { stdout: "control\n", stderr: "" };
    if (call.args[0] === "display-message" && call.args[2] === "#{client_name}") return { stdout: "/dev/ttys011\n", stderr: "" };
    if (call.args[0] === "list-keys") return { stdout: "bind-key -T root C-q send-prefix\n", stderr: "" };
    if (call.args[0] === "switch-client") throw new Error("switch failed");
    return { stdout: "", stderr: "" };
  });

  await assert.rejects(() => switchClientWithReturn({ targetSession: "pi-center-target", stateDir }, exec), /switch failed/);

  const switchIndex = exec.calls.findIndex((call) => call.args[0] === "switch-client");
  const unbindIndex = exec.calls.findIndex((call, index) => index > switchIndex && call.args[0] === "unbind-key");
  const sourceIndex = exec.calls.findIndex((call, index) => index > switchIndex && call.args[0] === "source-file");
  assert.notEqual(unbindIndex, -1);
  assert.notEqual(sourceIndex, -1);
});

test("restoreSwitchReturnBinding restores active binding without rebinding", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-center-return-"));
  const previousPath = join(stateDir, "previous.tmux");
  await writeFile(previousPath, "bind-key -T root C-q send-prefix\n");
  await writeFile(join(stateDir, "active.json"), JSON.stringify({
    ownerPid: process.pid,
    controlSession: "old-control",
    targetSession: "pi-center-old",
    returnKey: "C-q",
    restorePath: previousPath,
  }));
  const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));

  await restoreSwitchReturnBinding({ stateDir }, exec);

  assert.deepEqual(exec.calls.map((call) => call.args), [
    ["unbind-key", "-T", "root", "C-q"],
    ["source-file", previousPath],
  ]);
});

test("switchClientWithReturn refuses to replace a live foreign return binding", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-center-return-"));
  const previousPath = join(stateDir, "previous.tmux");
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
  try {
    assert.ok(child.pid);
    await writeFile(previousPath, "", "utf8");
    await writeFile(join(stateDir, "active.json"), JSON.stringify({
      ownerPid: child.pid,
      controlSession: "other-control",
      targetSession: "pi-center-other",
      returnKey: "C-q",
      restorePath: previousPath,
    }));
    const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));

    await assert.rejects(() => switchClientWithReturn({ targetSession: "pi-center-target", stateDir }, exec), /already active/);
    assert.deepEqual(exec.calls, []);
  } finally {
    child.kill();
  }
});

test("switchClientWithReturn restores stale active binding before rebinding", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-center-return-"));
  const previousPath = join(stateDir, "previous.tmux");
  await writeFile(previousPath, "bind-key -T root C-q send-prefix\n");
  await writeFile(join(stateDir, "active.json"), JSON.stringify({
    ownerPid: 999999999,
    controlSession: "old-control",
    targetSession: "pi-center-old",
    returnKey: "C-q",
    restorePath: previousPath,
  }));
  const exec = fakeTmux((call) => {
    if (call.args[0] === "display-message" && call.args[2] === "#{session_name}") return { stdout: "control\n", stderr: "" };
    if (call.args[0] === "display-message" && call.args[2] === "#{client_name}") return { stdout: "/dev/ttys011\n", stderr: "" };
    if (call.args[0] === "list-keys") return { stdout: "", stderr: "" };
    return { stdout: "", stderr: "" };
  });

  await switchClientWithReturn({ targetSession: "pi-center-target", stateDir }, exec);

  assert.deepEqual(exec.calls.slice(0, 2).map((call) => call.args[0]), ["unbind-key", "source-file"]);
  const active = JSON.parse(await readFile(join(stateDir, "active.json"), "utf8")) as { targetSession: string };
  assert.equal(active.targetSession, "pi-center-target");
});
