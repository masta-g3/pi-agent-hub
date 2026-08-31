import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { darkTmuxChrome } from "../src/core/chrome.js";
import { attachSessionCommand, cliTuiCommand, clientSessionByTty, clientSessionsByTty, clientSize, configureDashboardStatusBar, configureManagedSessionStatusBar, currentTmuxClient, currentTmuxSession, displayClientMessage, inspectSidebarReturnBinding, inspectSwitchReturnBinding, installSidebarReturnBinding, killPane, listSessions, listTmuxClients, listWindowPanes, presizeSessionWindow, reconcileSidebarReturnBinding, removeSidebarReturnBinding, resetSessionWindowSize, resizePaneWidth, restoreSwitchReturnBinding, selectPane, sendTextToSession, sessionPresence, sessionPresenceSnapshot, setDashboardMouse, setSessionStatusBarVisible, setPaneSlot, setPaneTitle, setWindowPaneBorderStatus, shellQuote, splitPaneAttach, splitWindowAttach, switchClient, switchClientTo, switchClientWithReturn, type TmuxExec } from "../src/core/tmux.js";
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

test("dashboard tui command uses current node and CLI file", () => {
  const command = cliTuiCommand({ nodePath: "/opt/node bin/node", cliPath: "/pkg/pi-agent-hub/dist/cli's.js" });

  assert.equal(command, "'/opt/node bin/node' '/pkg/pi-agent-hub/dist/cli'\\''s.js' tui");
  assert.doesNotMatch(command, /^pi-hub tui$/);
});

test("switchClient switches the current tmux client", async () => {
  const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));

  await switchClient("pi-agent-hub-dashboard", exec);

  assert.deepEqual(exec.calls, [{ command: "tmux", args: ["switch-client", "-t", "pi-agent-hub-dashboard"] }]);
});

test("attachSessionCommand returns tmux attach argv", () => {
  assert.deepEqual(attachSessionCommand("pi-agent-hub-dashboard"), {
    command: "tmux",
    args: ["attach-session", "-t", "pi-agent-hub-dashboard"],
  });
});

test("shellQuote uses POSIX single quote escaping", () => {
  assert.equal(shellQuote("pkg's path"), "'pkg'\\''s path'");
});

test("listWindowPanes parses pane geometry and titles for the current window", async () => {
  const exec = fakeTmux(() => ({ stdout: "%1\t/dev/ttys001\t1\t0\t0\t42\t60\t160\t60\t\tSidebar title\n%2\t/dev/ttys002\t0\t43\t12\t117\t48\t160\t60\t3\tPanel with spaces\tand tabs\n%3\t/dev/ttys003\t0\tnope\t10\t40\t20\t160\t60\t\tIgnored\n%4\t/dev/ttys004\t0\t20\t20\tnope\t20\t160\t60\t\tIgnored\n", stderr: "" }));

  assert.deepEqual(await listWindowPanes("%1", exec), [
    { id: "%1", tty: "/dev/ttys001", active: true, left: 0, top: 0, width: 42, height: 60, windowWidth: 160, windowHeight: 60, title: "Sidebar title" },
    { id: "%2", tty: "/dev/ttys002", active: false, left: 43, top: 12, width: 117, height: 48, windowWidth: 160, windowHeight: 60, slot: 3, title: "Panel with spaces\tand tabs" },
  ]);
  assert.deepEqual(exec.calls, [{ command: "tmux", args: ["list-panes", "-t", "%1", "-F", "#{pane_id}\t#{pane_tty}\t#{pane_active}\t#{pane_left}\t#{pane_top}\t#{pane_width}\t#{pane_height}\t#{window_width}\t#{window_height}\t#{@pi_hub_slot}\t#{pane_title}"] }]);
});

test("setPaneSlot writes transient pane-local slot metadata", async () => {
  const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));
  await setPaneSlot("%7", 3, exec);
  assert.deepEqual(exec.calls, [{ command: "tmux", args: ["set-option", "-p", "-t", "%7", "@pi_hub_slot", "3"] }]);
});

test("splitWindowAttach creates a detached side pane at its final size", async () => {
  const exec = fakeTmux(() => ({ stdout: "%2\n", stderr: "" }));

  assert.equal(await splitWindowAttach({ pane: "%1", target: "pi-agent-hub-api's", size: 117 }, exec), "%2");

  assert.deepEqual(exec.calls, [
    { command: "tmux", args: ["split-window", "-d", "-h", "-l", "117", "-P", "-F", "#{pane_id}", "-t", "%1", "env -u TMUX tmux attach-session -t 'pi-agent-hub-api'\\''s'"] },
  ]);
});

test("splitPaneAttach creates a detached panel in either direction", async () => {
  const exec = fakeTmux(() => ({ stdout: "%3\n", stderr: "" }));

  assert.equal(await splitPaneAttach({ pane: "%2", target: "pi-agent-hub-api's", direction: "vertical" }, exec), "%3");

  assert.deepEqual(exec.calls, [
    { command: "tmux", args: ["split-window", "-d", "-v", "-P", "-F", "#{pane_id}", "-t", "%2", "env -u TMUX tmux attach-session -t 'pi-agent-hub-api'\\''s'"] },
  ]);
});

test("session sizing helpers use explicit tmux window and client geometry", async () => {
  const exec = fakeTmux((call) => ({ stdout: call.args[0] === "display-message" ? "160 60\n" : "", stderr: "" }));

  assert.deepEqual(await clientSize("/dev/ttys011", exec), { width: 160, height: 60 });
  await presizeSessionWindow({ target: "pi-agent-hub-api", width: 117, height: 58 }, exec);
  await resetSessionWindowSize("pi-agent-hub-api", exec);

  assert.deepEqual(exec.calls.map((call) => call.args), [
    ["display-message", "-p", "-c", "/dev/ttys011", "#{client_width} #{client_height}"],
    ["resize-window", "-t", "pi-agent-hub-api", "-x", "117", "-y", "58"],
    ["set-option", "-w", "-t", "pi-agent-hub-api", "window-size", "latest"],
  ]);
});

test("switchClientTo switches a nested client by tty", async () => {
  const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));

  await switchClientTo({ clientTty: "/dev/ttys002", target: "pi-agent-hub-docs" }, exec);

  assert.deepEqual(exec.calls, [{ command: "tmux", args: ["switch-client", "-c", "/dev/ttys002", "-t", "pi-agent-hub-docs"] }]);
});

test("pane helpers target pane ids and window-local border chrome", async () => {
  const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));

  await killPane("%2", exec);
  await selectPane("%2", exec);
  await resizePaneWidth("%0", 42, exec);
  await setPaneTitle("%2", "LIVE · API", exec);
  await setWindowPaneBorderStatus("%0", true, undefined, exec);
  await setWindowPaneBorderStatus("%0", false, undefined, exec);

  assert.deepEqual(exec.calls, [
    { command: "tmux", args: ["kill-pane", "-t", "%2"] },
    { command: "tmux", args: ["select-pane", "-t", "%2"] },
    { command: "tmux", args: ["resize-pane", "-t", "%0", "-x", "42"] },
    { command: "tmux", args: ["select-pane", "-t", "%2", "-T", "LIVE · API"] },
    { command: "tmux", args: ["set-option", "-w", "-t", "%0", "pane-border-format", " #{pane_title} "] },
    { command: "tmux", args: ["set-option", "-w", "-t", "%0", "pane-border-status", "top"] },
    { command: "tmux", args: ["set-option", "-w", "-t", "%0", "pane-border-status", "off"] },
    { command: "tmux", args: ["set-option", "-w", "-u", "-t", "%0", "pane-border-format"] },
    { command: "tmux", args: ["set-option", "-w", "-u", "-t", "%0", "pane-border-style"] },
    { command: "tmux", args: ["set-option", "-w", "-u", "-t", "%0", "pane-active-border-style"] },
  ]);
});

test("pane border chrome applies theme-derived active and inactive styles", async () => {
  const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));
  await setWindowPaneBorderStatus("%0", true, darkTmuxChrome, exec);
  assert.deepEqual(exec.calls, [
    { command: "tmux", args: ["set-option", "-w", "-t", "%0", "pane-border-format", darkTmuxChrome.paneBorderFormat] },
    { command: "tmux", args: ["set-option", "-w", "-t", "%0", "pane-border-style", darkTmuxChrome.paneBorderStyle] },
    { command: "tmux", args: ["set-option", "-w", "-t", "%0", "pane-active-border-style", darkTmuxChrome.paneActiveBorderStyle] },
    { command: "tmux", args: ["set-option", "-w", "-t", "%0", "pane-border-status", "top"] },
  ]);
});

test("listTmuxClients parses exact client focus identity and flags", async () => {
  const exec = fakeTmux(() => ({ stdout: "client-a\t/dev/ttys001\tpi-agent-hub-api\t%3\tattached,focused\nclient-b\t/dev/ttys002\tsession with spaces\t%8\tattached\ninvalid\n", stderr: "" }));

  assert.deepEqual(await listTmuxClients(exec), [
    { name: "client-a", tty: "/dev/ttys001", session: "pi-agent-hub-api", paneId: "%3", flags: ["attached", "focused"] },
    { name: "client-b", tty: "/dev/ttys002", session: "session with spaces", paneId: "%8", flags: ["attached"] },
  ]);
  assert.deepEqual(exec.calls, [{ command: "tmux", args: ["list-clients", "-F", "#{client_name}\t#{client_tty}\t#{client_session}\t#{pane_id}\t#{client_flags}"] }]);
});

test("displayClientMessage targets one client for six seconds with literal-safe text", async () => {
  const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));
  await displayClientMessage("client-a", "API #{session_name}\u001b]0;secret\u0007\u001b[31m\nneeds you", exec);
  assert.deepEqual(exec.calls, [{ command: "tmux", args: ["display-message", "-d", "6000", "-c", "client-a", "API ##{session_name} needs you"] }]);
});

test("clientSessionsByTty derives session names from the shared client projection", async () => {
  const exec = fakeTmux(() => ({ stdout: "client-a\t/dev/ttys001\tpi-agent-hub-api\t%3\tattached\nclient-b\t/dev/ttys002\tsession with spaces\t%8\tattached\n", stderr: "" }));

  assert.deepEqual(await clientSessionsByTty(exec), new Map([
    ["/dev/ttys001", "pi-agent-hub-api"],
    ["/dev/ttys002", "session with spaces"],
  ]));
  assert.deepEqual(exec.calls, [
    { command: "tmux", args: ["list-clients", "-F", "#{client_name}\t#{client_tty}\t#{client_session}\t#{pane_id}\t#{client_flags}"] },
  ]);
});

test("clientSessionByTty reads one tty from the client map", async () => {
  const exec = fakeTmux(() => ({ stdout: "client-a\t/dev/ttys001\tpi-agent-hub-api\t%3\tattached\nclient-b\t/dev/ttys002\tsession with spaces\t%8\tattached\n", stderr: "" }));

  assert.equal(await clientSessionByTty("/dev/ttys002", exec), "session with spaces");
  assert.equal(await clientSessionByTty("/dev/ttys003", exec), undefined);
});

test("listSessions and sessionPresenceSnapshot classify one list-sessions result", async () => {
  const exec = fakeTmux(() => ({ stdout: "api\nother\n", stderr: "" }));
  assert.deepEqual(await listSessions(exec), new Set(["api", "other"]));
  assert.deepEqual(await sessionPresenceSnapshot(["api", "missing"], exec), new Map([
    ["api", { presence: "present" }], ["missing", { presence: "missing" }],
  ]));
  assert.deepEqual(exec.calls.map((call) => call.args[0]), ["list-sessions", "list-sessions"]);
});

test("sessionPresenceSnapshot maps no-server to missing and retains unknown errors", async () => {
  const noServer = fakeTmux(() => { throw new Error("tmux list-sessions failed: no server running"); });
  assert.deepEqual(await sessionPresenceSnapshot(["api"], noServer), new Map([["api", { presence: "missing" }]]));
  const unknown = fakeTmux(() => { throw new Error("tmux list-sessions failed: permission denied"); });
  assert.deepEqual(await sessionPresenceSnapshot(["api"], unknown), new Map([["api", { presence: "unknown", error: "tmux list-sessions failed: permission denied" }]]));
});

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

test("configureManagedSessionStatusBar keeps chrome configured while hidden in a panel", async () => {
  const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));

  await configureManagedSessionStatusBar({ name: "pi-agent-hub-api", title: "package", cwd: "/repo/example-service", visible: false }, exec);

  const args = exec.calls[0]?.args ?? [];
  assert.deepEqual(args.slice(0, 5), ["set-option", "-t", "pi-agent-hub-api", "status", "off"]);
  assert.ok(args.includes("status-right"));
  assert.ok(args.includes("window-status-current-format"));
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

test("configureDashboardStatusBar escapes tmux format markers in the project path", async () => {
  const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));

  await configureDashboardStatusBar({ name: "pi-agent-hub-dashboard", cwd: "/repo/proj#ect" }, exec);

  assert.match(exec.calls[0]?.args.join("\n"), /proj##ect/);
});

test("configureDashboardStatusBar applies theme-derived chrome", async () => {
  const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));

  await configureDashboardStatusBar({ name: "pi-agent-hub-dashboard", cwd: "/repo/example-service", theme: { text: "#111111", accent: "#222222", border: "#333333", dim: 244 } }, exec);

  assert.match(exec.calls[0]?.args.join("\n"), /status-style\nbg=#333333,fg=#111111/);
  assert.match(exec.calls[0]?.args.join("\n"), /#\[fg=colour244\]dashboard#\[default\]/);
  assert.match(exec.calls[0]?.args.join("\n"), /window-status-current-style\nfg=#111111,bg=#333333/);
});

test("configureDashboardStatusBar can keep dashboard chrome configured while status is hidden", async () => {
  const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));

  await configureDashboardStatusBar({ name: "pi-agent-hub-dashboard", cwd: "/repo/example-service", visible: false }, exec);

  const args = exec.calls[0]?.args ?? [];
  assert.deepEqual(args.slice(0, 5), ["set-option", "-t", "pi-agent-hub-dashboard", "status", "off"]);
  assert.ok(args.includes("status-right"));
  assert.ok(args.includes("window-status-current-format"));
});

test("setSessionStatusBarVisible toggles only the target session status option", async () => {
  const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));

  await setSessionStatusBarVisible({ name: "pi-agent-hub-dashboard", visible: false }, exec);
  await setSessionStatusBarVisible({ name: "pi-agent-hub-dashboard", visible: true }, exec);

  assert.deepEqual(exec.calls, [
    { command: "tmux", args: ["set-option", "-t", "pi-agent-hub-dashboard", "status", "off"] },
    { command: "tmux", args: ["set-option", "-t", "pi-agent-hub-dashboard", "status", "on"] },
  ]);
});

test("setDashboardMouse toggles only the dashboard mouse option", async () => {
  const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));

  await setDashboardMouse({ name: "pi-agent-hub", enabled: true }, exec);
  await setDashboardMouse({ name: "pi-agent-hub", enabled: false }, exec);

  assert.deepEqual(exec.calls, [
    { command: "tmux", args: ["set-option", "-t", "pi-agent-hub", "mouse", "on"] },
    { command: "tmux", args: ["set-option", "-u", "-t", "pi-agent-hub", "mouse"] },
  ]);
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

test("sidebar bindings deliver guarded spatial and return intents to the exact cockpit pane then restore prior bindings", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-sidebar-return-"));
  const exec = fakeTmux((call) => {
    if (call.args[0] === "list-keys") return { stdout: `bind-key -T root ${call.args.at(-1)} send-prefix\n`, stderr: "" };
    return { stdout: "", stderr: "" };
  });

  await installSidebarReturnBinding({ dashboardSession: "pi-agent-hub", sidebarPane: "%1", stateDir }, exec);

  const binds = exec.calls.filter((call) => call.args[0] === "bind-key");
  const keys = ["C-q", "M-q", "M-1", "M-2", "M-3", "M-4", "M-Left", "M-Right", "M-Up", "M-Down"];
  assert.deepEqual(binds.map((call) => call.args[2]), keys);
  const delivered = ["C-q", "M-q", "Escape '1'", "Escape '2'", "Escape '3'", "Escape '4'", "Escape '[1;3D'", "Escape '[1;3C'", "Escape '[1;3A'", "Escape '[1;3B'"];
  for (const [index, key] of keys.entries()) {
    assert.deepEqual(binds[index]?.args.slice(3), [
      "if-shell", "-F", "#{==:#{session_name},pi-agent-hub}",
      `send-keys -t '%1' ${delivered[index]}`,
      `send-keys ${key}`,
    ]);
  }
  const status = await inspectSidebarReturnBinding({ stateDir });
  assert.deepEqual(status.active && status.keys, keys);
  assert.match(await readFile(join(stateDir, "previous.tmux"), "utf8"), /M-Down/);

  await removeSidebarReturnBinding({ stateDir }, exec);

  assert.deepEqual(exec.calls.filter((call) => call.args[0] === "unbind-key").map((call) => call.args.at(-1)), keys);
  assert.deepEqual(exec.calls.at(-1)?.args, ["source-file", join(stateDir, "previous.tmux")]);
  assert.deepEqual(await inspectSidebarReturnBinding({ stateDir }), { active: false });
});

test("sidebar return cleanup supports legacy state without keys", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-sidebar-return-"));
  const restorePath = join(stateDir, "previous.tmux");
  await writeFile(restorePath, "");
  await writeFile(join(stateDir, "active.json"), JSON.stringify({
    ownerPid: process.pid, dashboardSession: "pi-agent-hub", sidebarPane: "%1", returnKey: "C-q", restorePath,
  }));
  const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));
  const status = await inspectSidebarReturnBinding({ stateDir });
  assert.deepEqual(status.active && status.keys, ["C-q"]);
  await removeSidebarReturnBinding({ stateDir }, exec);
  assert.deepEqual(exec.calls.map((call) => call.args), [["unbind-key", "-T", "root", "C-q"]]);
});

test("binding state readers propagate malformed JSON and release sidebar locks", async () => {
  const switchStateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-return-"));
  const sidebarStateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-sidebar-return-"));
  await writeFile(join(switchStateDir, "active.json"), "{");
  await writeFile(join(sidebarStateDir, "active.json"), "{");

  await assert.rejects(() => inspectSwitchReturnBinding({ stateDir: switchStateDir }), SyntaxError);
  await assert.rejects(() => inspectSidebarReturnBinding({ stateDir: sidebarStateDir }), SyntaxError);

  const sidebarExec = fakeTmux(() => ({ stdout: "", stderr: "" }));
  await assert.rejects(() => removeSidebarReturnBinding({ stateDir: sidebarStateDir }, sidebarExec), SyntaxError);
  await assert.rejects(() => access(join(sidebarStateDir, "active.json.lock")), { code: "ENOENT" });
  assert.deepEqual(sidebarExec.calls, []);

  const restoreExec = fakeTmux(() => ({ stdout: "", stderr: "" }));
  await assert.rejects(() => restoreSwitchReturnBinding({ stateDir: switchStateDir }, restoreExec), SyntaxError);
  assert.deepEqual(restoreExec.calls, []);
});

test("binding cleanup treats missing active state as a no-op", async () => {
  const switchStateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-return-"));
  const sidebarStateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-sidebar-return-"));
  const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));

  await removeSidebarReturnBinding({ stateDir: sidebarStateDir }, exec);
  await restoreSwitchReturnBinding({ stateDir: switchStateDir }, exec);

  assert.deepEqual(exec.calls, []);
});

test("sidebar binding install failure rolls back the whole binding set", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-sidebar-return-"));
  const exec = fakeTmux((call) => {
    if (call.args[0] === "list-keys") return { stdout: "", stderr: "" };
    if (call.args[0] === "bind-key" && call.args[2] === "M-Right") throw new Error("bind failed");
    return { stdout: "", stderr: "" };
  });
  await assert.rejects(() => installSidebarReturnBinding({ dashboardSession: "pi-agent-hub", sidebarPane: "%1", stateDir }, exec), /bind failed/);
  assert.deepEqual(exec.calls.filter((call) => call.args[0] === "unbind-key").map((call) => call.args.at(-1)), ["C-q", "M-q", "M-1", "M-2", "M-3", "M-4", "M-Left", "M-Right", "M-Up", "M-Down"]);
  assert.deepEqual(await inspectSidebarReturnBinding({ stateDir }), { active: false });
});

test("sidebar return reconciliation yields to full-screen bindings and self-heals afterward", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-sidebar-return-"));
  const switchStateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-return-"));
  const exec = fakeTmux((call) => ({ stdout: call.args[0] === "list-keys" ? "" : "", stderr: "" }));
  await writeFile(join(switchStateDir, "active.json"), JSON.stringify({
    ownerPid: process.pid,
    controlSession: "pi-agent-hub",
    targetSession: "pi-agent-hub-api",
    returnKey: "C-q",
    restorePath: join(switchStateDir, "previous.tmux"),
  }));

  await reconcileSidebarReturnBinding({
    desired: true,
    dashboardSession: "pi-agent-hub",
    sidebarPane: "%1",
    stateDir,
    switchStateDir,
  }, exec);
  assert.equal(exec.calls.length, 0);

  await rm(join(switchStateDir, "active.json"));
  await reconcileSidebarReturnBinding({
    desired: true,
    dashboardSession: "pi-agent-hub",
    sidebarPane: "%1",
    stateDir,
    switchStateDir,
  }, exec);
  assert.equal(exec.calls.some((call) => call.args[0] === "bind-key"), true);

  await reconcileSidebarReturnBinding({
    desired: false,
    dashboardSession: "pi-agent-hub",
    sidebarPane: "%1",
    stateDir,
    switchStateDir,
  }, exec);
  assert.equal(exec.calls.some((call) => call.args[0] === "unbind-key"), true);
});

test("sidebar reconciliation preserves a live binding owned by another process", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-sidebar-return-"));
  const switchStateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-return-"));
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
  try {
    assert.ok(child.pid);
    await writeFile(join(stateDir, "active.json"), JSON.stringify({
      ownerPid: child.pid,
      dashboardSession: "pi-agent-hub",
      sidebarPane: "%9",
      returnKey: "C-q",
      restorePath: join(stateDir, "previous.tmux"),
    }));
    const exec = fakeTmux(() => ({ stdout: "", stderr: "" }));

    await reconcileSidebarReturnBinding({
      desired: false,
      dashboardSession: "pi-agent-hub",
      sidebarPane: "%1",
      stateDir,
      switchStateDir,
    }, exec);

    assert.deepEqual(exec.calls, []);
    const status = await inspectSidebarReturnBinding({ stateDir });
    assert.equal(status.active && status.ownerPid, child.pid);
  } finally {
    child.kill();
  }
});

test("stale full-screen return state does not block sidebar return reconciliation", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-sidebar-return-"));
  const switchStateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-return-"));
  const exec = fakeTmux((call) => ({ stdout: call.args[0] === "list-keys" ? "" : "", stderr: "" }));
  await writeFile(join(switchStateDir, "active.json"), JSON.stringify({
    ownerPid: 999999999,
    controlSession: "pi-agent-hub",
    targetSession: "pi-agent-hub-api",
    returnKey: "C-q",
    restorePath: join(switchStateDir, "previous.tmux"),
  }));

  await reconcileSidebarReturnBinding({
    desired: true,
    dashboardSession: "pi-agent-hub",
    sidebarPane: "%1",
    stateDir,
    switchStateDir,
  }, exec);

  assert.equal(exec.calls.some((call) => call.args[0] === "bind-key"), true);
});

test("switchClientWithReturn installs return binding then switches client", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-return-"));
  const exec = fakeTmux((call) => {
    const subcommand = call.args[0];
    if (subcommand === "display-message" && call.args[2] === "#{session_name}") return { stdout: "control\n", stderr: "" };
    if (subcommand === "display-message" && call.args[2] === "#{client_name}") return { stdout: "/dev/ttys011\n", stderr: "" };
    if (subcommand === "display-message" && call.args[2] === "-c") return { stdout: "160 60\n", stderr: "" };
    if (subcommand === "list-keys") return { stdout: "bind-key -T root C-q send-prefix\n", stderr: "" };
    return { stdout: "", stderr: "" };
  });

  await switchClientWithReturn({ targetSession: "pi-agent-hub-target", stateDir }, exec);

  assert.deepEqual(exec.calls.map((call) => call.args[0] === "bind-key" ? call.args.slice(0, 4) : call.args), [
    ["display-message", "-p", "#{session_name}"],
    ["display-message", "-p", "#{client_name}"],
    ["list-keys", "-T", "root", "C-q"],
    ["list-keys", "-T", "root", "M-q"],
    ["bind-key", "-n", "C-q", "run-shell"],
    ["bind-key", "-n", "M-q", "run-shell"],
    ["display-message", "-p", "-c", "/dev/ttys011", "#{client_width} #{client_height}"],
    ["resize-window", "-t", "pi-agent-hub-target", "-x", "160", "-y", "59"],
    ["switch-client", "-c", "/dev/ttys011", "-t", "pi-agent-hub-target"],
    ["set-option", "-w", "-t", "pi-agent-hub-target", "window-size", "latest"],
  ]);
  const script = exec.calls.find((call) => call.args[0] === "bind-key")?.args[4] ?? "";
  assert.match(script, /pi-agent-hub-\*/);
  assert.doesNotMatch(script, /\*\);/);
  assert.match(script, /control/);
  assert.match(script, /previous\.tmux/);
  assert.match(script, /active\.json/);
  assert.match(script, /source-file/);
  assert.match(script, /unbind-key/);
  assert.doesNotMatch(script, /"action":"return"/);
  const altScript = exec.calls.find((call) => call.args[0] === "bind-key" && call.args[2] === "M-q")?.args[4] ?? "";
  assert.match(altScript, /"action":"return","key":"alt-q"/);
  assert.match(altScript, /if tmux switch-client[^;]+; then printf/);
  assert.match(altScript, /alt-return\.previous\.tmux/);
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
    ["bind-key", "-n", "M-q", "run-shell"],
    ["bind-key", "-n", "M-r", "run-shell"],
  ]);
  const renameScript = bindCalls.find((call) => call.args[2] === "M-r")?.args[4] ?? "";
  assert.match(renameScript, /\"action\":\"rename\"/);
  assert.match(renameScript, /\"tmuxSession\":\"pi-agent-hub-target\"/);
  assert.match(renameScript, /dashboard-action\.json/);
  assert.match(renameScript, /tmux switch-client -t 'control'/);
  assert.match(renameScript, /unbind-key -T root 'C-q'/);
  assert.match(renameScript, /unbind-key -T root 'M-q'/);
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
  assert.equal(exec.calls.some((call) => call.args[0] === "resize-window"), false);
  assert.equal(exec.calls.some((call) => call.args[0] === "switch-client"), false);
});

test("switchClientWithReturn resets target sizing and restores binding when switch fails after bind", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-return-"));
  const exec = fakeTmux((call) => {
    if (call.args[0] === "display-message" && call.args[2] === "#{session_name}") return { stdout: "control\n", stderr: "" };
    if (call.args[0] === "display-message" && call.args[2] === "#{client_name}") return { stdout: "/dev/ttys011\n", stderr: "" };
    if (call.args[0] === "display-message" && call.args[2] === "-c") return { stdout: "160 60\n", stderr: "" };
    if (call.args[0] === "list-keys") return { stdout: "bind-key -T root C-q send-prefix\n", stderr: "" };
    if (call.args[0] === "switch-client") throw new Error("switch failed");
    return { stdout: "", stderr: "" };
  });

  await assert.rejects(() => switchClientWithReturn({ targetSession: "pi-agent-hub-target", stateDir }, exec), /switch failed/);

  const switchIndex = exec.calls.findIndex((call) => call.args[0] === "switch-client");
  const resetIndex = exec.calls.findIndex((call, index) => index > switchIndex && call.args.includes("window-size"));
  const unbindIndex = exec.calls.findIndex((call, index) => index > switchIndex && call.args[0] === "unbind-key");
  const sourceIndex = exec.calls.findIndex((call, index) => index > switchIndex && call.args[0] === "source-file");
  assert.notEqual(resetIndex, -1);
  assert.ok(resetIndex < unbindIndex);
  assert.notEqual(unbindIndex, -1);
  assert.notEqual(sourceIndex, -1);
});

test("switchClientWithReturn preserves the return binding when the post-switch size reset fails", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-return-"));
  const exec = fakeTmux((call) => {
    if (call.args[0] === "display-message" && call.args[2] === "#{session_name}") return { stdout: "control\n", stderr: "" };
    if (call.args[0] === "display-message" && call.args[2] === "#{client_name}") return { stdout: "/dev/ttys011\n", stderr: "" };
    if (call.args[0] === "display-message" && call.args[2] === "-c") return { stdout: "160 60\n", stderr: "" };
    if (call.args[0] === "list-keys") return { stdout: "bind-key -T root C-q send-prefix\n", stderr: "" };
    if (call.args[0] === "set-option") throw new Error("reset failed");
    return { stdout: "", stderr: "" };
  });

  await assert.rejects(() => switchClientWithReturn({ targetSession: "pi-agent-hub-target", stateDir }, exec), /reset failed/);

  assert.equal(exec.calls.some((call) => call.args[0] === "switch-client"), true);
  assert.equal(exec.calls.some((call) => call.args[0] === "unbind-key"), false);
  assert.equal(JSON.parse(await readFile(join(stateDir, "active.json"), "utf8")).targetSession, "pi-agent-hub-target");
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
