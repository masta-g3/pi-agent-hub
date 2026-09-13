import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { loadRegistry, updateRegistry } from "../src/core/registry.js";
import { heartbeatPath } from "../src/core/paths.js";
import { nameCommandPath } from "../src/core/name-command.js";
import { PRIMARY_CWD_ENV, SUBAGENT_PROMPT_APPEND_ENV, WORKTREE_GUIDANCE_ENV } from "../src/core/names.js";
import {
  addManagedSession,
  cancelForkPreparation,
  forkManagedSession,
  managedPiCommand,
  restartManagedSessionFresh,
  restartManagedSession,
  retryForkPreparation,
  startManagedSession,
  stopManagedSession,
} from "../src/app/session-lifecycle.js";
import { SessionsController } from "../src/app/controller.js";
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

test("renameManagedSession publishes an exact-conversation command without typing into Pi", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-rename-"));
  const oldDir = process.env.PI_AGENT_HUB_DIR;
  process.env.PI_AGENT_HUB_DIR = join(root, "hub");
  const managed: ManagedSession = { id: "api", title: "api", cwd: "/tmp/api", group: "default", tmuxSession: "pi-agent-hub-api", status: "waiting", createdAt: 1, updatedAt: 1 };
  const writeHeartbeat = (name: string) => writeFile(heartbeatPath("api"), JSON.stringify({
    managedSessionId: "api", piSessionId: "conversation-api", piSessionName: name, cwd: "/tmp/api",
    state: "waiting", stateSince: 1, updatedAt: Date.now(),
  }), "utf8");
  try {
    await updateRegistry(() => ({ version: 1, sessions: [managed] }));
    await mkdir(join(root, "hub", "heartbeats"), { recursive: true });
    await writeHeartbeat("api");
    const rename = renameManagedSession("api", "Canonical Name");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const command = JSON.parse(await readFile(nameCommandPath("api"), "utf8")) as { piSessionId: string; name: string };
        assert.deepEqual([command.piSessionId, command.name], ["conversation-api", "Canonical Name"]);
        await writeHeartbeat("Canonical Name");
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    await rename;
    assert.equal((await loadRegistry()).sessions[0]?.title, "api");
    await assert.rejects(renameManagedSession("api", "bad\nname"), /one nonblank line/);
  } finally {
    if (oldDir === undefined) delete process.env.PI_AGENT_HUB_DIR; else process.env.PI_AGENT_HUB_DIR = oldDir;
    await rm(root, { recursive: true, force: true });
  }
});

test("renameManagedSession rejects linked tickets before publish and during confirmation", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-ticket-rename-"));
  const oldDir = process.env.PI_AGENT_HUB_DIR;
  process.env.PI_AGENT_HUB_DIR = join(root, "hub");
  const managed: ManagedSession = { id: "api", title: "api", cwd: "/tmp/api", group: "default", tmuxSession: "pi-agent-hub-api", status: "waiting", createdAt: 1, updatedAt: 1 };
  const writeHeartbeat = async (linked: boolean) => {
    await mkdir(join(root, "hub", "heartbeats"), { recursive: true });
    await writeFile(heartbeatPath("api"), JSON.stringify({
      managedSessionId: "api", piSessionId: "conversation-api", piSessionName: "api", cwd: "/tmp/api",
      state: "waiting", stateSince: 1, updatedAt: Date.now(),
      ...(linked ? { context: { version: 1, updatedAt: Date.now(), ticket: { id: "naming-001" } } } : {}),
    }), "utf8");
  };
  try {
    await updateRegistry(() => ({ version: 1, sessions: [managed] }));
    await writeHeartbeat(true);
    await assert.rejects(renameManagedSession("api", "Manual Name"), /linked ticket owns the session name/);
    await assert.rejects(readFile(nameCommandPath("api"), "utf8"), /ENOENT/);

    await writeHeartbeat(false);
    const rename = renameManagedSession("api", "Race Name");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { await readFile(nameCommandPath("api"), "utf8"); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 5)); }
    }
    await writeHeartbeat(true);
    await assert.rejects(rename, /linked ticket owns the session name/);
  } finally {
    if (oldDir === undefined) delete process.env.PI_AGENT_HUB_DIR; else process.env.PI_AGENT_HUB_DIR = oldDir;
    await rm(root, { recursive: true, force: true });
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
    assert.equal(saved.title, "New · api");
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
    assert.equal(created.title, "New · api");
    assert.match(commands, /'--name' 'New · api'/);
    const more = await Promise.all([addManagedSession({ cwd: repo }), addManagedSession({ cwd: repo })]);
    assert.deepEqual(new Set(more.map((item) => item.title)), new Set(["New · api · 2", "New · api · 3"]));
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

async function withForkFixture(run: (root: string, log: string, history: string) => Promise<void>, tmuxBody = "exit 0") {
  const root = await mkdtemp(join(tmpdir(), "hub-preparation-action-"));
  const previous = { dir: process.env.PI_AGENT_HUB_DIR, path: process.env.PATH };
  const bin = join(root, "bin");
  const log = join(root, "tmux.log");
  const history = join(root, "child.jsonl");
  await mkdir(bin);
  await writeFile(history, "saved child history\n");
  await writeFile(join(bin, "tmux"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\n${tmuxBody}\n`);
  await chmod(join(bin, "tmux"), 0o755);
  process.env.PI_AGENT_HUB_DIR = join(root, "hub");
  process.env.PATH = `${bin}:${previous.path ?? ""}`;
  try { await run(root, log, history); }
  finally {
    if (previous.dir === undefined) delete process.env.PI_AGENT_HUB_DIR; else process.env.PI_AGENT_HUB_DIR = previous.dir;
    if (previous.path === undefined) delete process.env.PATH; else process.env.PATH = previous.path;
    await rm(root, { recursive: true, force: true });
  }
}

test("pending fork cannot start, restart, rename, or fork through application routes", async () => {
  await withForkFixture(async (root, log, history) => {
    await seedRegistry({ version: 1, sessions: [session({ cwd: root, sessionFile: history, forkPreparation: { id: "attempt", phase: "compacting", launchConfirmed: true } })] });
    for (const action of [() => startManagedSession("source-session"), () => restartManagedSession("source-session"), () => restartManagedSessionFresh("source-session"), () => renameManagedSession("source-session", "changed"), () => forkManagedSession("source-session")]) {
      await assert.rejects(action, /Compacting/);
    }
    assert.doesNotMatch(await readFile(log, "utf8"), /kill-session|new-session|send-keys|load-buffer/);
    assert.equal(await readFile(history, "utf8"), "saved child history\n");
  });
});

test("cancel failed preparation keeps the session and ignores the old heartbeat gate", async () => {
  await withForkFixture(async (root, log, history) => {
    const original = session({ cwd: root, sessionFile: history, forkPreparation: { id: "failed-attempt", phase: "error", error: "reset missing" } });
    await seedRegistry({ version: 1, sessions: [original] });
    await mkdir(join(root, "hub", "heartbeats"), { recursive: true });
    const context = { version: 1, updatedAt: 10, ticket: { id: "manual-001", subtitle: "Keep current work" } };
    const heartbeat = JSON.stringify({ managedSessionId: original.id, cwd: root, state: "waiting", stateSince: 1, updatedAt: Date.now(), forkPreparation: original.forkPreparation, context });
    await writeFile(heartbeatPath(original.id), heartbeat);
    const controller = new SessionsController(undefined, async () => "present");
    await controller.refresh();
    assert.equal(controller.snapshot().sessions[0]?.context, undefined);
    const before = (await loadRegistry()).sessions[0]!;
    await cancelForkPreparation(original.id);
    const after = (await loadRegistry()).sessions[0]!;
    const { forkPreparation: _preparation, ...kept } = before;
    assert.deepEqual(after, { ...kept, updatedAt: after.updatedAt });
    assert.ok(after.updatedAt > before.updatedAt);
    assert.equal(await readFile(history, "utf8"), "saved child history\n");
    assert.equal(await readFile(heartbeatPath(original.id), "utf8"), heartbeat);
    await assert.rejects(readFile(log), { code: "ENOENT" });
    await controller.refresh();
    assert.equal(controller.snapshot().sessions[0]?.forkPreparation, undefined);
    assert.deepEqual(controller.snapshot().sessions[0]?.context, context);
    await assert.rejects(() => cancelForkPreparation(original.id), /Only failed fork preparation/);
  });
});

test("preparation cancellation rejects active attempts and subagents", async () => {
  await withForkFixture(async (root, _log, history) => {
    for (const change of [
      { forkPreparation: { id: "attempt", phase: "preparing" } },
      { forkPreparation: { id: "attempt", phase: "compacting" } },
      { forkPreparation: { id: "attempt", phase: "ready", outcome: "compacted" } },
      { kind: "subagent", forkPreparation: { id: "attempt", phase: "error" } },
    ] as const) {
      await seedRegistry({ version: 1, sessions: [session({ cwd: root, sessionFile: history, ...change })] });
      const before = await loadRegistry();
      await assert.rejects(() => cancelForkPreparation("source-session"), /Only failed fork preparation/);
      assert.deepEqual(await loadRegistry(), before);
    }
  });
});

test("failed preparation retries the same saved child with a fresh attempt", async () => {
  await withForkFixture(async (root, log, history) => {
    await seedRegistry({ version: 1, sessions: [session({ cwd: root, sessionFile: history, forkPreparation: { id: "failed-attempt", phase: "error", error: "provider failed" } })] });
    await mkdir(join(root, "hub", "heartbeats"), { recursive: true });
    await writeFile(heartbeatPath("source-session"), JSON.stringify({ managedSessionId: "source-session", cwd: root, state: "waiting", stateSince: 1, updatedAt: Date.now() }));
    await retryForkPreparation("source-session");
    const rows = (await loadRegistry()).sessions;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, "source-session");
    assert.notEqual(rows[0]?.forkPreparation?.id, "failed-attempt");
    assert.equal(rows[0]?.forkPreparation?.phase, "preparing");
    const commands = await readFile(log, "utf8");
    assert.match(commands, /kill-session/);
    assert.match(commands, /--session/);
    assert.doesNotMatch(commands, /--fork/);
    assert.equal(await readFile(history, "utf8"), "saved child history\n");
  });
});

test("normal fork preserves its launched child when status-bar setup fails", async () => {
  await withForkFixture(async (root, log, history) => {
    await seedRegistry({ version: 1, sessions: [session({ cwd: root, sessionFile: history })] });
    await assert.rejects(() => forkManagedSession("source-session"), /status-bar failed/);
    assert.equal((await loadRegistry()).sessions.length, 2);
    const commands = await readFile(log, "utf8");
    assert.match(commands, /new-session/);
    assert.doesNotMatch(commands, /kill-session/);
    assert.equal(await readFile(history, "utf8"), "saved child history\n");
  }, 'if [ "$1" = "set-option" ]; then echo "status-bar failed" >&2; exit 1; fi\nexit 0');
});

test("fork launch failure removes its unusable child but preserves the source", async () => {
  await withForkFixture(async (root, _log, history) => {
    await seedRegistry({ version: 1, sessions: [session({ cwd: root, sessionFile: history })] });
    await assert.rejects(() => forkManagedSession("source-session", { compact: true }), /spawn failed/);
    assert.deepEqual((await loadRegistry()).sessions.map((row) => row.id), ["source-session"]);
    assert.equal(await readFile(history, "utf8"), "saved child history\n");
  }, 'if [ "$1" = "new-session" ]; then echo "spawn failed" >&2; exit 1; fi\nexit 0');
});

test("stopping an unconfirmed fork prevents its deferred launch", async () => {
  await withForkFixture(async (root, log, history) => {
    await seedRegistry({ version: 1, sessions: [session({ cwd: root, sessionFile: history })] });
    await assert.rejects(() => forkManagedSession("source-session", {
      compact: true,
      onRegistered: (child) => stopManagedSession(child.id),
    }), /cancelled or replaced/);
    assert.doesNotMatch(await readFile(log, "utf8"), /new-session/);
    assert.equal(await readFile(history, "utf8"), "saved child history\n");
  }, '[ "$1" = "has-session" ] && exit 1\nexit 0');
});

test("deletion during deferred launch cleans up the exact late child", async () => {
  await withForkFixture(async (root, log, history) => {
    await seedRegistry({ version: 1, sessions: [session({ cwd: root, sessionFile: history })] });
    await assert.rejects(() => forkManagedSession("source-session", {
      compact: true,
      async onRegistered(child) {
        setTimeout(() => { void updateRegistry((registry) => ({ ...registry, sessions: registry.sessions.filter((row) => row.id !== child.id) })); }, 30);
      },
    }), /cancelled or replaced/);
    assert.deepEqual((await loadRegistry()).sessions.map((row) => row.id), ["source-session"]);
    assert.match(await readFile(log, "utf8"), /kill-session/);
  }, 'if [ "$1" = "new-session" ]; then sleep 0.2; fi\nexit 0');
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
    assert.equal(restarted.title, "New · project");
    assert.equal(restarted.sessionFile, undefined);
    assert.equal(restarted.piSessionId, undefined);
    assert.equal(restarted.acknowledgedAt, undefined);
    assert.equal(restarted.error, undefined);
    assert.equal(restarted.activeTheme, undefined);
    await assert.rejects(() => readFile(heartbeatPath("source-session"), "utf8"), /ENOENT/);
    const commands = await readFile(log, "utf8");
    assert.match(commands, /kill-session -t pi-agent-hub-source/);
    assert.match(commands, /new-session .*PI_AGENT_HUB_SESSION_ID='source-session'/);
    assert.match(commands, /'--name' 'New · project'/);
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
    assert.equal(fork.title, "Fork · source");
    assert.match(commands, /'--name' 'Fork · source'/);
    const second = await forkManagedSession("source-session");
    assert.equal(second.title, "Fork · source · 2");
    assert.equal((await loadRegistry()).sessions.find((item) => item.id === "source-session")?.title, "source");
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
    let compactionCompleted = false;
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
      compactionCompleted = true;
      await writeForkHeartbeat("complete");
    })();
    const fork = await forkManagedSession("source-session", { compact: true });
    const returnedBeforeCompletion = !compactionCompleted;
    await heartbeatTask;
    assert.equal(returnedBeforeCompletion, true, "fork launch must not wait for compaction");
    assert.ok("forkPreparation" in fork, "the child is gated before its first heartbeat");
    const registry = await loadRegistry();
    assert.equal(registry.sessions.length, 2);
    assert.equal(registry.sessions.find((item) => item.id === "source-session")?.group, "default");
    assert.equal(fork.group, "default");
    const commands = await readFile(log, "utf8");
    assert.match(commands, /PI_AGENT_HUB_FORK_COMPACT='[a-f0-9-]{36}'/);
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
