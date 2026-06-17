import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readlink, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { loadRegistry, saveRegistry } from "../src/core/registry.js";
import { addManagedSession, forkManagedSession, managedPiCommand } from "../src/app/session-commands.js";
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
    const created = await addManagedSession({ cwd: api, additionalCwds: [web], title: "feature", group: "test", worktree: { branch: "feature/multi" } });
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
    assert.match(await readFile(log, "utf8"), new RegExp(`new-session.*-c ${saved.workspaceCwd!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  } finally {
    if (oldDir === undefined) delete process.env.PI_AGENT_HUB_DIR;
    else process.env.PI_AGENT_HUB_DIR = oldDir;
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
});

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

test("forkManagedSession does not register a fork when source history is not saved", async () => {
  const oldDir = process.env.PI_AGENT_HUB_DIR;
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-hub-fork-"));
  process.env.PI_AGENT_HUB_DIR = dir;
  try {
    await saveRegistry({ version: 1, sessions: [session({ sessionFile: join(dir, "missing.jsonl") })] });

    await assert.rejects(
      () => forkManagedSession("source-session", { title: "source fork", group: "default" }),
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
