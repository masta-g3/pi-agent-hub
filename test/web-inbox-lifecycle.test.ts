import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { phoneInboxAddress, startWebInbox, stopWebInbox, WEB_TMUX_SESSION } from "../src/app/web-inbox.js";
import type { TmuxExec } from "../src/core/tmux.js";
import type { WebStatus } from "../src/core/web-status.js";

const RUNNING: WebStatus = { pid: 42, port: 4747, instanceId: "i", startedAt: 1 };

function fakeTmux(sessions: string[] = []): TmuxExec & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async exec(_command, args) {
      calls.push(args);
      if (args[0] === "has-session") {
        // Real tmux treats `=name` as an exact match and a bare name as a prefix.
        const target = args[2]!;
        const found = target.startsWith("=") ? sessions.includes(target.slice(1)) : sessions.some((name) => name.startsWith(target));
        if (!found) throw new Error(`can't find session: ${target}`);
      }
      return { stdout: "", stderr: "" };
    },
  };
}

const base = { cliPath: "/pkg/dist/src/cli.js", nodePath: "/bin/node", pollMs: 1, timeoutMs: 50 };

test("start returns a running server without touching tmux", async () => {
  const exec = fakeTmux();
  const status = await startWebInbox({ ...base, exec, read: async () => [RUNNING] });
  assert.deepEqual(status, RUNNING);
  assert.deepEqual(exec.calls, []);
});

test("start launches pi-hub web in its own tmux session with absolute state dirs", async () => {
  const exec = fakeTmux();
  let reads = 0;
  const status = await startWebInbox({
    ...base, exec,
    env: { PI_CODING_AGENT_DIR: "rel/agent", PI_AGENT_HUB_GLYPHS: "nerd" },
    read: async () => (reads++ < 3 ? [] : [RUNNING]),
  });
  assert.deepEqual(status, RUNNING);
  assert.equal(WEB_TMUX_SESSION, "pi-hub-web");
  assert.deepEqual(exec.calls[0], ["has-session", "-t", "=pi-hub-web"]);
  const launch = exec.calls[1]!;
  assert.deepEqual(launch.slice(0, 4), ["new-session", "-d", "-s", "pi-hub-web"]);
  const command = launch.at(-1)!;
  assert.match(command, new RegExp(`PI_CODING_AGENT_DIR='${resolve("rel/agent")}'`, "u"));
  assert.match(command, new RegExp(`PI_AGENT_HUB_DIR='${resolve("rel/agent", "pi-agent-hub")}'`, "u"));
  assert.match(command, /PI_AGENT_HUB_GLYPHS='nerd'/u);
  assert.match(command, /'\/bin\/node' '\/pkg\/dist\/src\/cli\.js' web$/u);
});

test("start fails with the manual command when no server appears", async () => {
  await assert.rejects(
    startWebInbox({ ...base, exec: fakeTmux(), read: async () => [] }),
    /did not start.*tmux attach -t pi-hub-web/u,
  );
});

test("start refuses when the exact session exists without a server, and ignores a prefix match", async () => {
  await assert.rejects(startWebInbox({ ...base, exec: fakeTmux(["pi-hub-web"]), read: async () => [] }), /tmux session pi-hub-web exists/u);
  const exec = fakeTmux(["pi-hub-web-test"]);
  let reads = 0;
  await startWebInbox({ ...base, exec, read: async () => (reads++ < 2 ? [] : [RUNNING]) });
  assert.equal(exec.calls[1]?.[0], "new-session");
});

test("stop signals every verified server and waits for each to exit", async () => {
  const other = { ...RUNNING, pid: 43, port: 4800 };
  const killed: number[] = [];
  const live = new Set([42, 43]);
  const stopped = await stopWebInbox({
    ...base,
    read: async () => [RUNNING, other],
    kill: (pid, signal) => { assert.equal(signal, "SIGTERM"); killed.push(pid); setTimeout(() => live.delete(pid), 5); },
    alive: (pid) => live.has(pid),
  });
  assert.equal(stopped, 2);
  assert.deepEqual(killed, [42, 43]);
});

test("stop with nothing verified signals nothing", async () => {
  const stopped = await stopWebInbox({ ...base, read: async () => [], kill: () => assert.fail("no signal"), alive: () => true });
  assert.equal(stopped, 0);
});

test("stop reports a server that does not exit in time", async () => {
  await assert.rejects(
    stopWebInbox({ ...base, read: async () => [RUNNING], kill: () => {}, alive: () => true }),
    /pid 42 did not exit/u,
  );
});

test("stop keeps going when a server exits before its signal, and reports other failures after trying all", async () => {
  const servers = [RUNNING, { ...RUNNING, pid: 43, port: 4800 }, { ...RUNNING, pid: 44, port: 4801 }];
  const killed: number[] = [];
  const live = new Set([43, 44]);
  const errno = (code: string) => Object.assign(new Error(code), { code });
  await assert.rejects(stopWebInbox({
    ...base,
    read: async () => servers,
    kill: (pid) => {
      killed.push(pid);
      if (pid === 42) throw errno("ESRCH");
      if (pid === 44) throw errno("EPERM");
      live.delete(pid);
    },
    alive: (pid) => live.has(pid),
  }), (error: Error) => error.message === "phone inbox: pid 44: EPERM");
  assert.deepEqual(killed, [42, 43, 44]);
});

test("stop waits on one shared deadline for every signalled server", async () => {
  const servers = [RUNNING, { ...RUNNING, pid: 43, port: 4800 }, { ...RUNNING, pid: 44, port: 4801 }];
  const started = Date.now();
  await assert.rejects(
    stopWebInbox({ ...base, timeoutMs: 100, read: async () => servers, kill: () => {}, alive: () => true }),
    /pid 42 did not exit; pid 43 did not exit; pid 44 did not exit/u,
  );
  assert.ok(Date.now() - started < 250, "one deadline, not one per pid");
});

test("the phone address prefers the first published server and falls back to loopback", async () => {
  const serve = (port: number) => ({ TCP: { 443: { HTTPS: true } }, Web: { "mac.tail1.ts.net:443": { Handlers: { "/": { Proxy: `http://127.0.0.1:${port}` } } } } });
  const two = async () => [RUNNING, { ...RUNNING, pid: 43, port: 4800 }];
  // 4747 is not published, 4800 is: the published one wins.
  assert.deepEqual(await phoneInboxAddress({ readServe: async () => serve(4800), read: two }), { address: "https://mac.tail1.ts.net", published: true, port: 4800 });
  assert.deepEqual(await phoneInboxAddress({ readServe: async () => undefined, read: two }), { address: "http://127.0.0.1:4747", published: false, port: 4747 });
  // Serve still points at a server that already stopped: nothing runs, so nothing shows.
  assert.equal(await phoneInboxAddress({ readServe: async () => serve(4747), read: async () => [] }), undefined);
});
