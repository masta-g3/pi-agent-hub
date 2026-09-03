import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readlink, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { loadRegistry, updateRegistry } from "../src/core/registry.js";
import { heartbeatPath } from "../src/core/paths.js";
import { PRIMARY_CWD_ENV, SUBAGENT_PROMPT_APPEND_ENV, WORKTREE_GUIDANCE_ENV } from "../src/core/names.js";
import {
  addManagedSession,
  forkManagedSession,
  managedPiCommand,
  restartManagedSessionFresh,
  startManagedSession,
  stopManagedSession,
} from "../src/app/session-lifecycle.js";
import { renameManagedSession } from "../src/app/session-commands.js";
import type { ManagedSession } from "../src/core/types.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return result.stdout;
}

async function createRepo(root: string, name: string): Promise<string> {
  const repo = join(root, name);
  await git(root, ["init", repo]);
  await git(repo, ["config", "user.email", "test@example.com"]);
  await git(repo, ["config", "user.name", "Test User"]);
  await writeFile(join(repo, "README.md"), `${name}\n`, "utf8");
  await git(repo, ["add", "README.md"]);
  await git(repo, ["commit", "-m", "initial"]);
  await git(repo, ["branch", "-M", "main"]);
  return repo;
}

test("managedPiCommand keeps the existing plain command without prelude", () => {
  assert.equal(managedPiCommand({ piArgs: ["--extension", "/tmp/ext path/index.js"] }), "pi '--extension' '/tmp/ext path/index.js'");
});

test("managedPiCommand wraps prelude before exec and gates on its final status", () => {
  const command = managedPiCommand({
    shell: "/bin/zsh",
    prelude: "echo setup",
    piArgs: ["--extension", "/tmp/ext path/index.js"],
  });

  assert.match(command, /^'\/bin\/zsh' -lc '/);
  assert.match(command, /echo setup/);
  assert.match(command, /__pi_agent_hub_prelude_status=\$\?/);
  assert.match(command, /exit \$__pi_agent_hub_prelude_status/);
  assert.match(command, /exec pi '\\''--extension'\\'' '\\''\/tmp\/ext path\/index\.js'\\'''$/);
  assert.ok(command.indexOf("echo setup") < command.indexOf("__pi_agent_hub_prelude_status=$?"));
  assert.ok(command.indexOf("__pi_agent_hub_prelude_status=$?") < command.indexOf("exec pi"));
});

test("managedPiCommand shell-quotes prelude and Pi args", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-command-"));
  const bin = join(root, "bin");
  const output = join(root, "args.txt");
  await mkdir(bin);
  await writeFile(join(bin, "pi"), "#!/bin/sh\nprintf '%s\\n' \"$MARK\" > \"$OUTPUT\"\nprintf '%s\\n' \"$@\" >> \"$OUTPUT\"\n", "utf8");
  await chmod(join(bin, "pi"), 0o755);

  const command = managedPiCommand({
    shell: "/bin/sh",
    prelude: "export MARK='setup ok'",
    piArgs: ["--resume", "/tmp/it's saved.jsonl"],
  });
  const child = spawn("/bin/sh", ["-lc", command], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, OUTPUT: output },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));

  assert.equal(code, 0, Buffer.concat(stderr).toString("utf8"));
  assert.deepEqual((await readFile(output, "utf8")).trimEnd().split("\n"), ["setup ok", "--resume", "/tmp/it's saved.jsonl"]);
});

test("managedPiCommand does not start Pi when prelude exits nonzero", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-command-"));
  const bin = join(root, "bin");
  const output = join(root, "args.txt");
  await mkdir(bin);
  await writeFile(join(bin, "pi"), `#!/bin/sh\necho ran > ${JSON.stringify(output)}\n`, "utf8");
  await chmod(join(bin, "pi"), 0o755);

  const command = managedPiCommand({ shell: "/bin/sh", prelude: "false", piArgs: ["--help"] });
  const child = spawn("/bin/sh", ["-lc", command], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));

  assert.equal(code, 1, Buffer.concat(stderr).toString("utf8"));
  await assert.rejects(() => readFile(output, "utf8"), /ENOENT/);
});

test("managedPiCommand treats whitespace-only prelude as unset", () => {
  assert.equal(managedPiCommand({ prelude: "   ", piArgs: ["--help"] }), "pi '--help'");
});

test("renameManagedSession sends exact Pi name command and never mutates the cached title", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-rename-"));
  const bin = join(root, "bin");
  const log = join(root, "tmux.log");
  await mkdir(bin);
  await writeFile(join(bin, "tmux"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\nexit 0\n`, "utf8");
  await chmod(join(bin, "tmux"), 0o755);
  const oldDir = process.env.PI_AGENT_HUB_DIR;
  const oldPath = process.env.PATH;
  process.env.PI_AGENT_HUB_DIR = join(root, "hub");
  process.env.PATH = `${bin}:${oldPath ?? ""}`;
  try {
    const managed: ManagedSession = { id: "api", title: "api", cwd: "/tmp/api", group: "default", tmuxSession: "pi-agent-hub-api", status: "waiting", createdAt: 1, updatedAt: 1 };
    await updateRegistry(() => ({ version: 1, sessions: [managed] }));
    await renameManagedSession("api", "Canonical Name");
    assert.equal((await loadRegistry()).sessions[0]?.title, "api");
    assert.match(await readFile(log, "utf8"), /set-buffer .* -- \/name Canonical Name[\s\S]*paste-buffer[\s\S]*send-keys .* Enter/);
    await assert.rejects(renameManagedSession("api", "bad\nname"), /one nonblank line/);
  } finally {
    if (oldDir === undefined) delete process.env.PI_AGENT_HUB_DIR; else process.env.PI_AGENT_HUB_DIR = oldDir;
    process.env.PATH = oldPath;
  }
});

test("addManagedSession creates multi-repo worktree sessions in a source-pi workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-add-wt-"));
  const bin = join(root, "bin");
  const log = join(root, "tmux.log");
  await mkdir(bin);
  await writeFile(join(bin, "tmux"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\n[ "$1" = "has-session" ] && exit 1\nexit 0\n`, "utf8");
  await chmod(join(bin, "tmux"), 0o755);
  const api = await createRepo(root, "api");
  const web = await createRepo(root, "web");
  const oldDir = process.env.PI_AGENT_HUB_DIR;
  const oldPath = process.env.PATH;
  process.env.PI_AGENT_HUB_DIR = join(root, "hub");
  process.env.PATH = `${bin}:${oldPath ?? ""}`;
  try {
    const created = await addManagedSession({ cwd: api, additionalCwds: [web], group: "test", worktree: { branch: "feature/multi" } });
    const registry = await loadRegistry();
    const saved = registry.sessions[0]!;

    assert.equal(saved.id, created.id);
    assert.equal(saved.worktreeOwnedByHub, true);
    assert.equal(saved.worktrees?.length, 2);
    assert.equal(saved.cwd, saved.worktrees![0]!.path);
    assert.deepEqual(saved.additionalCwds, [saved.worktrees![1]!.path]);
    assert.equal(resolve(await readlink(join(saved.workspaceCwd!, ".pi"))), join(await realpath(api), ".pi"));
    assert.equal((await git(saved.worktrees![0]!.path, ["branch", "--show-current"])).trim(), "feature/multi");
    assert.equal((await git(saved.worktrees![1]!.path, ["branch", "--show-current"])).trim(), "feature/multi");
    const commands = await readFile(log, "utf8");
    assert.match(commands, new RegExp(`new-session.*-c ${saved.workspaceCwd!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(commands, new RegExp(`${WORKTREE_GUIDANCE_ENV}=`));
    assert.match(commands, new RegExp(`${SUBAGENT_PROMPT_APPEND_ENV}=`));
    assert.match(commands, new RegExp(`${PRIMARY_CWD_ENV}='${saved.cwd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
    assert.doesNotMatch(commands, new RegExp(`${PRIMARY_CWD_ENV}='${saved.workspaceCwd!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
    assert.doesNotMatch(commands, new RegExp(`${PRIMARY_CWD_ENV}='${saved.additionalCwds![0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
    assert.match(commands, new RegExp(saved.worktrees![0]!.repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(commands, new RegExp(saved.worktrees![1]!.repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    if (oldDir === undefined) delete process.env.PI_AGENT_HUB_DIR;
    else process.env.PI_AGENT_HUB_DIR = oldDir;
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
});

test("addManagedSession injects worktree guidance for a single-repo worktree", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-add-single-wt-"));
  const bin = join(root, "bin");
  const log = join(root, "tmux.log");
  await mkdir(bin);
  await writeFile(join(bin, "tmux"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\n[ "$1" = "has-session" ] && exit 1\nexit 0\n`, "utf8");
  await chmod(join(bin, "tmux"), 0o755);
  const repo = await createRepo(root, "api");
  const oldDir = process.env.PI_AGENT_HUB_DIR;
  const oldPath = process.env.PATH;
  process.env.PI_AGENT_HUB_DIR = join(root, "hub");
  process.env.PATH = `${bin}:${oldPath ?? ""}`;
  try {
    const created = await addManagedSession({ cwd: repo, worktree: { branch: "feature/single" } });
    const commands = await readFile(log, "utf8");

    assert.equal(created.additionalCwds, undefined);
    assert.match(commands, new RegExp(`${WORKTREE_GUIDANCE_ENV}=`));
    assert.match(commands, new RegExp(`${SUBAGENT_PROMPT_APPEND_ENV}=`));
    assert.match(commands, new RegExp((created.worktreeRepoRoot ?? "missing").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    if (oldDir === undefined) delete process.env.PI_AGENT_HUB_DIR;
    else process.env.PI_AGENT_HUB_DIR = oldDir;
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
});

function seedRegistry(registry: import("../src/core/types.js").SessionsRegistry, path?: string): Promise<import("../src/core/types.js").SessionsRegistry> {
  return updateRegistry(() => registry, path);
}

function session(overrides: Partial<ManagedSession> = {}): ManagedSession {
  return {
    id: "source-session",
    title: "source",
    cwd: "/tmp/project",
    group: "default",
    tmuxSession: "pi-agent-hub-source",
    status: "waiting",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test("startManagedSession merges prepared workspace outputs into the latest row", async () => {
  const oldDir = process.env.PI_AGENT_HUB_DIR;
  const oldPath = process.env.PATH;
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-start-fresh-"));
  const bin = join(root, "bin");
  const log = join(root, "tmux.log");
  await mkdir(bin);
  await writeFile(join(bin, "tmux"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\nif [ "$1" = "has-session" ]; then exit 1; fi\nexit 0\n`, "utf8");
  await chmod(join(bin, "tmux"), 0o755);
  process.env.PI_AGENT_HUB_DIR = root;
  process.env.PATH = `${bin}:${oldPath ?? ""}`;
  try {
    const original = session({ cwd: "/tmp/input", additionalCwds: ["/tmp/extra"] });
    await seedRegistry({ version: 1, sessions: [original] });

    await startManagedSession("source-session", async (prepared) => {
      await updateRegistry((latest) => ({
        ...latest,
        sessions: latest.sessions.map((item) => item.id === prepared.id ? { ...item, title: "latest title", group: "latest group", status: "running" as const } : item),
      }));
      return { ...prepared, cwd: "/tmp/canonical", additionalCwds: ["/tmp/canonical-extra"], workspaceCwd: join(root, "workspace") };
    });

    const committed = (await loadRegistry()).sessions[0]!;
    assert.equal(committed.title, "latest title");
    assert.equal(committed.group, "latest group");
    assert.equal(committed.status, "running");
    assert.equal(committed.cwd, "/tmp/canonical");
    assert.deepEqual(committed.additionalCwds, ["/tmp/canonical-extra"]);
    const commands = await readFile(log, "utf8");
    assert.match(commands, /new-session/);
    assert.match(commands, new RegExp(`${PRIMARY_CWD_ENV}='\/tmp\/canonical'`));
    assert.doesNotMatch(commands, new RegExp(`${PRIMARY_CWD_ENV}='${join(root, "workspace").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
    assert.doesNotMatch(commands, new RegExp(`${PRIMARY_CWD_ENV}='\/tmp\/canonical-extra'`));
  } finally {
    if (oldDir === undefined) delete process.env.PI_AGENT_HUB_DIR;
    else process.env.PI_AGENT_HUB_DIR = oldDir;
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
});

test("startManagedSession aborts when workspace identity changes during preparation", async () => {
  const oldDir = process.env.PI_AGENT_HUB_DIR;
  const oldPath = process.env.PATH;
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-start-conflict-"));
  const bin = join(root, "bin");
  const log = join(root, "tmux.log");
  await mkdir(bin);
  await writeFile(join(bin, "tmux"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\nif [ "$1" = "has-session" ]; then exit 1; fi\nexit 0\n`, "utf8");
  await chmod(join(bin, "tmux"), 0o755);
  process.env.PI_AGENT_HUB_DIR = root;
  process.env.PATH = `${bin}:${oldPath ?? ""}`;
  try {
    const original = session({ cwd: "/tmp/input", additionalCwds: ["/tmp/extra"] });
    await seedRegistry({ version: 1, sessions: [original] });

    await assert.rejects(
      () => startManagedSession("source-session", async (prepared) => {
        await updateRegistry((latest) => ({
          ...latest,
          sessions: latest.sessions.map((item) => item.id === prepared.id ? { ...item, cwd: "/tmp/reconfigured" } : item),
        }));
        return { ...prepared, workspaceCwd: join(root, "workspace") };
      }),
      /Session changed while starting; retry/,
    );

    assert.equal((await loadRegistry()).sessions[0]?.cwd, "/tmp/reconfigured");

    for (const mutate of [
      (latest: import("../src/core/types.js").SessionsRegistry) => ({ ...latest, sessions: [] }),
      (latest: import("../src/core/types.js").SessionsRegistry) => ({
        ...latest,
        sessions: latest.sessions.map((item) => ({ ...item, kind: "subagent" as const, parentId: "parent" })),
      }),
    ]) {
      await seedRegistry({ version: 1, sessions: [original] });
      await assert.rejects(
        () => startManagedSession("source-session", async (prepared) => {
          await updateRegistry(mutate);
          return prepared;
        }),
        /Session changed while starting; retry/,
      );
    }

    assert.doesNotMatch(await readFile(log, "utf8"), /new-session/);
  } finally {
    if (oldDir === undefined) delete process.env.PI_AGENT_HUB_DIR;
    else process.env.PI_AGENT_HUB_DIR = oldDir;
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
});

test("restartManagedSessionFresh clears saved Pi state and starts a new tmux session", async () => {
  const oldDir = process.env.PI_AGENT_HUB_DIR;
  const oldPath = process.env.PATH;
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-restart-fresh-"));
  const bin = join(root, "bin");
  const log = join(root, "tmux.log");
  const alive = join(root, "alive");
  await mkdir(bin);
  await writeFile(alive, "yes", "utf8");
  await writeFile(join(bin, "tmux"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\nif [ "$1" = "has-session" ]; then [ -f ${JSON.stringify(alive)} ] && exit 0 || exit 1; fi\nif [ "$1" = "kill-session" ]; then rm -f ${JSON.stringify(alive)}; exit 0; fi\nif [ "$1" = "new-session" ]; then touch ${JSON.stringify(alive)}; exit 0; fi\nexit 0\n`, "utf8");
  await chmod(join(bin, "tmux"), 0o755);
  process.env.PI_AGENT_HUB_DIR = root;
  process.env.PATH = `${bin}:${oldPath ?? ""}`;
  try {
    await seedRegistry({
      version: 1,
      sessions: [session({
        status: "waiting",
        sessionFile: join(root, "saved.jsonl"),
        piSessionId: "pi-session",
        acknowledgedAt: 123,
        error: "previous error",
        activeTheme: { name: "custom", tokens: { accent: "#ff00ff" } },
      })],
    });
    await mkdir(join(root, "heartbeats"));
    await writeFile(heartbeatPath("source-session"), "{}", "utf8");

    await restartManagedSessionFresh("source-session");

    const registry = await loadRegistry();
    const restarted = registry.sessions[0]!;
    assert.equal(restarted.status, "starting");
    assert.equal(restarted.title, "project");
    assert.equal(restarted.sessionFile, undefined);
    assert.equal(restarted.piSessionId, undefined);
    assert.equal(restarted.acknowledgedAt, undefined);
    assert.equal(restarted.error, undefined);
    assert.equal(restarted.activeTheme, undefined);
    await assert.rejects(() => readFile(heartbeatPath("source-session"), "utf8"), /ENOENT/);
    const commands = await readFile(log, "utf8");
    assert.match(commands, /kill-session -t pi-agent-hub-source/);
    assert.match(commands, /new-session .*PI_AGENT_HUB_SESSION_ID='source-session'/);
    assert.doesNotMatch(commands, new RegExp(`${WORKTREE_GUIDANCE_ENV}=`));
    assert.doesNotMatch(commands, new RegExp(`${SUBAGENT_PROMPT_APPEND_ENV}=`));
    assert.match(commands, /set-option -t pi-agent-hub-source status on/);
    assert.match(commands, /status-right .*project/);
  } finally {
    if (oldDir === undefined) delete process.env.PI_AGENT_HUB_DIR;
    else process.env.PI_AGENT_HUB_DIR = oldDir;
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
});

test("lifecycle commands reject subagent registry rows", async () => {
  const oldDir = process.env.PI_AGENT_HUB_DIR;
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-hub-subagent-lifecycle-"));
  process.env.PI_AGENT_HUB_DIR = dir;
  try {
    await seedRegistry({ version: 1, sessions: [session({ kind: "subagent", parentId: "parent", agentName: "worker" })] });

    await assert.rejects(() => startManagedSession("source-session"), /start managed session source-session: Cannot start subagent row: source/);
    await assert.rejects(() => stopManagedSession("source-session"), /stop managed session source-session: Cannot stop subagent row: source/);
    await assert.rejects(() => forkManagedSession("source-session"), /fork managed session source-session: Cannot fork subagent row: source/);
    await assert.rejects(() => startManagedSession("missing"), /start managed session missing: Unknown session: missing/);
  } finally {
    if (oldDir === undefined) delete process.env.PI_AGENT_HUB_DIR;
    else process.env.PI_AGENT_HUB_DIR = oldDir;
  }
});

test("forkManagedSession exports the fork record primary cwd without changing conversation fork behavior", async () => {
  const oldDir = process.env.PI_AGENT_HUB_DIR;
  const oldPath = process.env.PATH;
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-fork-primary-cwd-"));
  const bin = join(root, "bin");
  const log = join(root, "tmux.log");
  const history = join(root, "saved.jsonl");
  const primary = join(root, "primary");
  const additional = join(root, "additional");
  await mkdir(bin);
  await mkdir(primary);
  await mkdir(additional);
  await writeFile(history, "{}\n", "utf8");
  await writeFile(join(bin, "tmux"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\nexit 0\n`, "utf8");
  await chmod(join(bin, "tmux"), 0o755);
  process.env.PI_AGENT_HUB_DIR = join(root, "hub");
  process.env.PATH = `${bin}:${oldPath ?? ""}`;
  try {
    await seedRegistry({ version: 1, sessions: [session({ cwd: primary, additionalCwds: [additional], sessionFile: history })] });
    const fork = await forkManagedSession("source-session");
    const commands = await readFile(log, "utf8");
    assert.equal(fork.cwd, primary);
    assert.match(commands, new RegExp(`${PRIMARY_CWD_ENV}='${primary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
    assert.doesNotMatch(commands, new RegExp(`${PRIMARY_CWD_ENV}='${additional.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
    assert.match(commands, /--fork/);
    assert.equal(fork.worktreeOwnedByHub, undefined);
  } finally {
    if (oldDir === undefined) delete process.env.PI_AGENT_HUB_DIR; else process.env.PI_AGENT_HUB_DIR = oldDir;
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
  }
});

test("forkManagedSession marks compact forks for one-time startup handling", async () => {
  const oldDir = process.env.PI_AGENT_HUB_DIR;
  const oldPath = process.env.PATH;
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-fork-compact-"));
  const bin = join(root, "bin");
  const log = join(root, "tmux.log");
  const history = join(root, "saved.jsonl");
  const primary = join(root, "primary");
  await mkdir(bin);
  await mkdir(primary);
  await writeFile(history, "{}\n", "utf8");
  await writeFile(join(bin, "tmux"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\nexit 0\n`, "utf8");
  await chmod(join(bin, "tmux"), 0o755);
  process.env.PI_AGENT_HUB_DIR = join(root, "hub");
  process.env.PATH = `${bin}:${oldPath ?? ""}`;
  try {
    await seedRegistry({ version: 1, sessions: [session({ cwd: primary, sessionFile: history })] });
    await mkdir(join(root, "hub", "heartbeats"), { recursive: true });
    const heartbeatTask = (async () => {
      let child: ManagedSession | undefined;
      while (!child) {
        child = (await loadRegistry()).sessions.find((item) => item.id !== "source-session");
        if (!child) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const writeForkHeartbeat = (operation: "running" | "complete") => writeFile(heartbeatPath(child!.id, { PI_AGENT_HUB_DIR: join(root, "hub") }), JSON.stringify({
        managedSessionId: child!.id, cwd: primary, state: operation === "running" ? "running" : "waiting", stateSince: 1, updatedAt: Date.now(),
        operation: { kind: "fork-compact", phase: operation, id: "op-1" },
      }), "utf8");
      await writeForkHeartbeat("running");
      await new Promise((resolve) => setTimeout(resolve, 500));
      await writeForkHeartbeat("complete");
    })();
    const fork = await forkManagedSession("source-session", { compact: true });
    await heartbeatTask;
    const registry = await loadRegistry();
    assert.equal(registry.sessions.length, 2);
    assert.equal(registry.sessions.find((item) => item.id === "source-session")?.group, "default");
    assert.equal(fork.group, "default");
    const commands = await readFile(log, "utf8");
    assert.match(commands, /PI_AGENT_HUB_FORK_COMPACT='1'/);
  } finally {
    if (oldDir === undefined) delete process.env.PI_AGENT_HUB_DIR; else process.env.PI_AGENT_HUB_DIR = oldDir;
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
  }
});

test("forkManagedSession keeps worktree-session forks blocked", async () => {
  const oldDir = process.env.PI_AGENT_HUB_DIR;
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-hub-fork-worktree-"));
  process.env.PI_AGENT_HUB_DIR = dir;
  try {
    await seedRegistry({ version: 1, sessions: [session({ worktreeOwnedByHub: true, worktreePath: "/tmp/worktree", worktreeRepoRoot: "/tmp/source", worktreeBranch: "feature/test", worktreeBaseBranch: "main", sessionFile: join(dir, "saved.jsonl") })] });
    await assert.rejects(() => forkManagedSession("source-session"), /Cannot fork worktree sessions in v1/);
    assert.equal((await loadRegistry()).sessions.length, 1);
  } finally {
    if (oldDir === undefined) delete process.env.PI_AGENT_HUB_DIR; else process.env.PI_AGENT_HUB_DIR = oldDir;
  }
});

test("forkManagedSession does not register a fork when source history is not saved", async () => {
  const oldDir = process.env.PI_AGENT_HUB_DIR;
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-hub-fork-"));
  process.env.PI_AGENT_HUB_DIR = dir;
  try {
    await seedRegistry({ version: 1, sessions: [session({ sessionFile: join(dir, "missing.jsonl") })] });

    await assert.rejects(
      () => forkManagedSession("source-session", { group: "default" }),
      /history is not saved yet/,
    );

    const registry = JSON.parse(await readFile(join(dir, "registry.json"), "utf8"));
    assert.equal(registry.sessions.length, 1);
    assert.equal(registry.sessions[0].id, "source-session");
  } finally {
    if (oldDir === undefined) delete process.env.PI_AGENT_HUB_DIR;
    else process.env.PI_AGENT_HUB_DIR = oldDir;
  }
});
