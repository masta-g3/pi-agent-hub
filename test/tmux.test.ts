import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { capturePane, configureDashboardStatusBar, configureManagedSessionStatusBar, currentTmuxClient, currentTmuxSession, inspectSwitchReturnBinding, restoreSwitchReturnBinding, sendTextToSession, sessionPresence, switchClientWithReturn, type TmuxExec } from "../src/core/tmux.js";
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

test("sessionPresence distinguishes missing sessions from unknown tmux failures", async () => {
  assert.equal(await sessionPresence("api", fakeTmux(() => ({ stdout: "", stderr: "" }))), "present");
  assert.equal(await sessionPresence("api", fakeTmux(() => { throw new Error("tmux has-session -t api failed: can't find session: api"); })), "missing");
  assert.equal(await sessionPresence("api", fakeTmux(() => { throw new Error("tmux has-session -t api failed: no server running on /tmp/tmux"); })), "missing");
  assert.equal(await sessionPresence("api", fakeTmux(() => { throw new Error("tmux has-session -t api failed: failed to connect to server"); })), "unknown");
  assert.equal(await sessionPresence("api", fakeTmux(() => { throw new Error("tmux has-session -t api failed: permission denied"); })), "unknown");
});

test("configureManagedSessionStatusBar sets a Pi-native right footer", async () => {
  const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));

  await configureManagedSessionStatusBar({ name: "pi-agent-hub-api", title: "package", cwd: "/repo/example-service" }, exec);

  assert.deepEqual(exec.calls.map((call) => call.args), [[
    "set-option", "-t", "pi-agent-hub-api", "status", "on",
    ";", "set-option", "-t", "pi-agent-hub-api", "status-style", "bg=#1a1b26,fg=#a9b1d6",
    ";", "set-option", "-t", "pi-agent-hub-api", "status-right", "#[fg=#565f89]ctrl+q return · alt+r rename#[default] │ 📁 package | example-service ",
    ";", "set-option", "-t", "pi-agent-hub-api", "status-right-length", "100",
    ";", "set-option", "-t", "pi-agent-hub-api", "status-left", "",
    ";", "set-option", "-t", "pi-agent-hub-api", "status-left-length", "120",
    ";", "set-option", "-t", "pi-agent-hub-api", "window-status-style", "fg=#a9b1d6,bg=#1a1b26",
    ";", "set-option", "-t", "pi-agent-hub-api", "window-status-current-style", "fg=#a9b1d6,bg=#1a1b26",
    ";", "set-option", "-t", "pi-agent-hub-api", "window-status-format", " #I:#W#F ",
    ";", "set-option", "-t", "pi-agent-hub-api", "window-status-current-format", " #I:#W#F ",
  ]]);
});

test("configureManagedSessionStatusBar applies theme-derived chrome", async () => {
  const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));

  await configureManagedSessionStatusBar({
    name: "pi-agent-hub-api",
    title: "package",
    cwd: "/repo/example-service",
    theme: { accent: "#010203", border: 240, dim: "445566" },
  }, exec);

  const args = exec.calls[0]?.args.join("\n") ?? "";
  assert.match(args, /status-style\nbg=colour240,fg=#010203/);
  assert.match(args, /#\[fg=#445566\]ctrl\+q return · alt\+r rename#\[default\]/);
  assert.match(args, /window-status-style\nfg=#010203,bg=colour240/);
});

test("configureManagedSessionStatusBar escapes tmux format markers in labels", async () => {
  const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));

  await configureManagedSessionStatusBar({ name: "pi-agent-hub-api", title: "api #1", cwd: "/repo/proj#ect" }, exec);

  assert.match(exec.calls[0]?.args.join("\n"), /api ##1 \| proj##ect/);
});

test("configureDashboardStatusBar overrides inherited colored window formats", async () => {
  const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));

  await configureDashboardStatusBar({ name: "pi-agent-hub-dashboard", cwd: "/repo/example-service" }, exec);

  assert.deepEqual(exec.calls.map((call) => call.args), [[
    "set-option", "-t", "pi-agent-hub-dashboard", "status", "on",
    ";", "set-option", "-t", "pi-agent-hub-dashboard", "status-style", "bg=#1a1b26,fg=#a9b1d6",
    ";", "set-option", "-t", "pi-agent-hub-dashboard", "status-left", "",
    ";", "set-option", "-t", "pi-agent-hub-dashboard", "status-right", "#[fg=#565f89]dashboard#[default] │ 📁 example-service ",
    ";", "set-option", "-t", "pi-agent-hub-dashboard", "status-right-length", "100",
    ";", "set-option", "-t", "pi-agent-hub-dashboard", "window-status-style", "fg=#a9b1d6,bg=#1a1b26",
    ";", "set-option", "-t", "pi-agent-hub-dashboard", "window-status-current-style", "fg=#a9b1d6,bg=#1a1b26",
    ";", "set-option", "-t", "pi-agent-hub-dashboard", "window-status-format", " #I:#W#F ",
    ";", "set-option", "-t", "pi-agent-hub-dashboard", "window-status-current-format", " #I:#W#F ",
  ]]);
});

test("configureDashboardStatusBar applies theme-derived chrome", async () => {
  const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));

  await configureDashboardStatusBar({ name: "pi-agent-hub-dashboard", cwd: "/repo/example-service", theme: { text: "#111111", accent: "#222222", border: "#333333", dim: 244 } }, exec);

  assert.match(exec.calls[0]?.args.join("\n"), /status-style\nbg=#333333,fg=#111111/);
  assert.match(exec.calls[0]?.args.join("\n"), /#\[fg=colour244\]dashboard#\[default\]/);
  assert.match(exec.calls[0]?.args.join("\n"), /window-status-current-style\nfg=#111111,bg=#333333/);
});

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

test("capturePane captures plain text by default", async () => {
  const exec = fakeTmux(() => ({ stdout: "plain\n", stderr: "" }));

  assert.equal(await capturePane("pi-agent-hub-api", 80, exec), "plain\n");
  assert.deepEqual(exec.calls, [{ command: "tmux", args: ["capture-pane", "-p", "-t", "pi-agent-hub-api", "-S", "-80"] }]);
});

test("capturePane can preserve pane styles", async () => {
  const exec = fakeTmux(() => ({ stdout: "\u001b[1mheading\u001b[0m\n", stderr: "" }));

  assert.equal(await capturePane("pi-agent-hub-api", 80, { preserveStyles: true }, exec), "\u001b[1mheading\u001b[0m\n");
  assert.deepEqual(exec.calls, [{ command: "tmux", args: ["capture-pane", "-p", "-e", "-t", "pi-agent-hub-api", "-S", "-80"] }]);
});

test("sendTextToSession pastes text into target and submits", async () => {
  const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));

  await sendTextToSession("pi-agent-hub-api", "-fix quotes 'and' unicode ✓", exec);

  assert.deepEqual(exec.calls, [
    { command: "tmux", args: ["set-buffer", "-b", `pi-agent-hub-send-${process.pid}`, "--", "-fix quotes 'and' unicode ✓"] },
    { command: "tmux", args: ["paste-buffer", "-d", "-b", `pi-agent-hub-send-${process.pid}`, "-t", "pi-agent-hub-api"] },
    { command: "tmux", args: ["send-keys", "-t", "pi-agent-hub-api", "Enter"] },
  ]);
});

test("sendTextToSession surfaces tmux errors", async () => {
  const exec = fakeTmux((call) => {
    if (call.args[0] === "paste-buffer") throw new Error("paste failed");
    return { stdout: "", stderr: "" };
  });

  await assert.rejects(() => sendTextToSession("pi-agent-hub-api", "hello", exec), /paste failed/);
});

test("switchClientWithReturn installs return binding then switches client", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-return-"));
  const exec = fakeTmux((call) => {
    const subcommand = call.args[0];
    if (subcommand === "display-message" && call.args[2] === "#{session_name}") return { stdout: "control\n", stderr: "" };
    if (subcommand === "display-message" && call.args[2] === "#{client_name}") return { stdout: "/dev/ttys011\n", stderr: "" };
    if (subcommand === "list-keys") return { stdout: "bind-key -T root C-q send-prefix\n", stderr: "" };
    return { stdout: "", stderr: "" };
  });

  await switchClientWithReturn({ targetSession: "pi-agent-hub-target", stateDir }, exec);

  assert.deepEqual(exec.calls.map((call) => call.args[0] === "bind-key" ? call.args.slice(0, 4) : call.args), [
    ["display-message", "-p", "#{session_name}"],
    ["display-message", "-p", "#{client_name}"],
    ["list-keys", "-T", "root", "C-q"],
    ["bind-key", "-n", "C-q", "run-shell"],
    ["switch-client", "-c", "/dev/ttys011", "-t", "pi-agent-hub-target"],
  ]);
  const script = exec.calls.find((call) => call.args[0] === "bind-key")?.args[4] ?? "";
  assert.match(script, /pi-agent-hub-\*/);
  assert.doesNotMatch(script, /\*\);/);
  assert.match(script, /control/);
  assert.match(script, /previous\.tmux/);
  assert.match(script, /active\.json/);
  assert.match(script, /source-file/);
  assert.match(script, /unbind-key/);
});

test("switchClientWithReturn installs rename action binding when requested", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-return-"));
  const exec = fakeTmux((call) => {
    const subcommand = call.args[0];
    if (subcommand === "display-message" && call.args[2] === "#{session_name}") return { stdout: "control\n", stderr: "" };
    if (subcommand === "display-message" && call.args[2] === "#{client_name}") return { stdout: "/dev/ttys011\n", stderr: "" };
    if (subcommand === "list-keys") return { stdout: "", stderr: "" };
    return { stdout: "", stderr: "" };
  });

  await switchClientWithReturn({ targetSession: "pi-agent-hub-target", stateDir, renameKey: "M-r" }, exec);

  const bindCalls = exec.calls.filter((call) => call.args[0] === "bind-key");
  assert.deepEqual(bindCalls.map((call) => call.args.slice(0, 4)), [
    ["bind-key", "-n", "C-q", "run-shell"],
    ["bind-key", "-n", "M-r", "run-shell"],
  ]);
  const renameScript = bindCalls.find((call) => call.args[2] === "M-r")?.args[4] ?? "";
  assert.match(renameScript, /\"action\":\"rename\"/);
  assert.match(renameScript, /\"tmuxSession\":\"pi-agent-hub-target\"/);
  assert.match(renameScript, /dashboard-action\.json/);
  assert.match(renameScript, /tmux switch-client -t 'control'/);
  assert.match(renameScript, /unbind-key -T root 'C-q'/);
  assert.match(renameScript, /unbind-key -T root 'M-r'/);
});

test("switchClientWithReturn can self-heal a missing return session before cleanup", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-return-"));
  const exec = fakeTmux((call) => {
    if (call.args[0] === "display-message" && call.args[2] === "#{session_name}") return { stdout: "pi-agent-hub-dashboard\n", stderr: "" };
    if (call.args[0] === "display-message" && call.args[2] === "#{client_name}") return { stdout: "/dev/ttys011\n", stderr: "" };
    if (call.args[0] === "list-keys") return { stdout: "", stderr: "" };
    return { stdout: "", stderr: "" };
  });

  await switchClientWithReturn({
    targetSession: "pi-agent-hub-target",
    stateDir,
    returnSession: {
      name: "pi-agent-hub-dashboard",
      cwd: "/repo/example-service",
      command: "pi-agent-hub tui",
      env: { PI_CODING_AGENT_DIR: "/tmp/pi agent", PI_AGENT_HUB_DIR: "/tmp/pi-agent-hub" },
    },
  }, exec);

  const script = exec.calls.find((call) => call.args[0] === "bind-key")?.args[4] ?? "";
  assert.match(script, /tmux has-session -t 'pi-agent-hub-dashboard'/);
  assert.match(script, /tmux new-session -d -s 'pi-agent-hub-dashboard' -c '\/repo\/example-service'/);
  assert.match(script, /PI_CODING_AGENT_DIR=.*\/tmp\/pi agent/);
  assert.match(script, /PI_AGENT_HUB_DIR=.*\/tmp\/pi-agent-hub/);
  assert.match(script, /if tmux switch-client -t 'pi-agent-hub-dashboard'/);
  assert.match(script, /then tmux unbind-key/);
  assert.match(script, /then .*rm -f .*previous\.tmux.*active\.json.*; fi/);
});

test("switchClientWithReturn handles absent previous binding", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-return-"));
  const exec = fakeTmux((call) => {
    if (call.args[0] === "display-message" && call.args[2] === "#{session_name}") return { stdout: "control\n", stderr: "" };
    if (call.args[0] === "display-message" && call.args[2] === "#{client_name}") return { stdout: "/dev/ttys011\n", stderr: "" };
    if (call.args[0] === "list-keys") throw new Error("unknown key: C-q");
    return { stdout: "", stderr: "" };
  });

  await switchClientWithReturn({ targetSession: "pi-agent-hub-target", stateDir }, exec);

  assert.equal(exec.calls.some((call) => call.args[0] === "bind-key"), true);
  assert.equal(exec.calls.some((call) => call.args[0] === "switch-client"), true);
});

test("switchClientWithReturn rethrows unexpected list-keys failures", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-return-"));
  const exec = fakeTmux((call) => {
    if (call.args[0] === "display-message" && call.args[2] === "#{session_name}") return { stdout: "control\n", stderr: "" };
    if (call.args[0] === "display-message" && call.args[2] === "#{client_name}") return { stdout: "/dev/ttys011\n", stderr: "" };
    if (call.args[0] === "list-keys") throw new Error("tmux server unavailable");
    return { stdout: "", stderr: "" };
  });

  await assert.rejects(() => switchClientWithReturn({ targetSession: "pi-agent-hub-target", stateDir }, exec), /tmux server unavailable/);
  assert.equal(exec.calls.some((call) => call.args[0] === "bind-key"), false);
  assert.equal(exec.calls.some((call) => call.args[0] === "switch-client"), false);
});

test("switchClientWithReturn restores binding when switch fails after bind", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-return-"));
  const exec = fakeTmux((call) => {
    if (call.args[0] === "display-message" && call.args[2] === "#{session_name}") return { stdout: "control\n", stderr: "" };
    if (call.args[0] === "display-message" && call.args[2] === "#{client_name}") return { stdout: "/dev/ttys011\n", stderr: "" };
    if (call.args[0] === "list-keys") return { stdout: "bind-key -T root C-q send-prefix\n", stderr: "" };
    if (call.args[0] === "switch-client") throw new Error("switch failed");
    return { stdout: "", stderr: "" };
  });

  await assert.rejects(() => switchClientWithReturn({ targetSession: "pi-agent-hub-target", stateDir }, exec), /switch failed/);

  const switchIndex = exec.calls.findIndex((call) => call.args[0] === "switch-client");
  const unbindIndex = exec.calls.findIndex((call, index) => index > switchIndex && call.args[0] === "unbind-key");
  const sourceIndex = exec.calls.findIndex((call, index) => index > switchIndex && call.args[0] === "source-file");
  assert.notEqual(unbindIndex, -1);
  assert.notEqual(sourceIndex, -1);
});

test("inspectSwitchReturnBinding reports missing and stale return state", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-return-"));

  assert.deepEqual(await inspectSwitchReturnBinding({ stateDir }), { active: false });

  const previousPath = join(stateDir, "previous.tmux");
  await writeFile(join(stateDir, "active.json"), JSON.stringify({
    ownerPid: 999999999,
    controlSession: "pi-agent-hub-dashboard",
    targetSession: "pi-agent-hub-target",
    returnKey: "C-q",
    restorePath: previousPath,
  }));

  const status = await inspectSwitchReturnBinding({ stateDir });
  assert.equal(status.active, true);
  if (status.active) {
    assert.equal(status.stale, true);
    assert.equal(status.controlSession, "pi-agent-hub-dashboard");
  }
});

test("restoreSwitchReturnBinding restores active binding without rebinding", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-return-"));
  const previousPath = join(stateDir, "previous.tmux");
  await writeFile(previousPath, "bind-key -T root C-q send-prefix\n");
  await writeFile(join(stateDir, "active.json"), JSON.stringify({
    ownerPid: process.pid,
    controlSession: "old-control",
    targetSession: "pi-agent-hub-old",
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
  const stateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-return-"));
  const previousPath = join(stateDir, "previous.tmux");
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
  try {
    assert.ok(child.pid);
    await writeFile(previousPath, "", "utf8");
    await writeFile(join(stateDir, "active.json"), JSON.stringify({
      ownerPid: child.pid,
      controlSession: "other-control",
      targetSession: "pi-agent-hub-other",
      returnKey: "C-q",
      restorePath: previousPath,
    }));
    const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));

    await assert.rejects(() => switchClientWithReturn({ targetSession: "pi-agent-hub-target", stateDir }, exec), /already active/);
    assert.deepEqual(exec.calls, []);
  } finally {
    child.kill();
  }
});

test("switchClientWithReturn restores stale active binding before rebinding", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-return-"));
  const previousPath = join(stateDir, "previous.tmux");
  await writeFile(previousPath, "bind-key -T root C-q send-prefix\n");
  await writeFile(join(stateDir, "active.json"), JSON.stringify({
    ownerPid: 999999999,
    controlSession: "old-control",
    targetSession: "pi-agent-hub-old",
    returnKey: "C-q",
    restorePath: previousPath,
  }));
  const exec = fakeTmux((call) => {
    if (call.args[0] === "display-message" && call.args[2] === "#{session_name}") return { stdout: "control\n", stderr: "" };
    if (call.args[0] === "display-message" && call.args[2] === "#{client_name}") return { stdout: "/dev/ttys011\n", stderr: "" };
    if (call.args[0] === "list-keys") return { stdout: "", stderr: "" };
    return { stdout: "", stderr: "" };
  });

  await switchClientWithReturn({ targetSession: "pi-agent-hub-target", stateDir }, exec);

  assert.deepEqual(exec.calls.slice(0, 2).map((call) => call.args[0]), ["unbind-key", "source-file"]);
  const active = JSON.parse(await readFile(join(stateDir, "active.json"), "utf8")) as { targetSession: string };
  assert.equal(active.targetSession, "pi-agent-hub-target");
});
