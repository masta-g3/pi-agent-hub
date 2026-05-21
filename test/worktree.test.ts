import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import { discardWorktreeSession, finishWorktreeSession } from "../src/app/worktree-session.js";
import { createOwnedWorktree, finishOwnedWorktree, branchSlug } from "../src/core/worktree.js";
import { createSessionRecord, loadRegistry, saveRegistry } from "../src/core/registry.js";
import { heartbeatPath, registryPath, worktreesDir } from "../src/core/paths.js";
import type { ManagedSession } from "../src/core/types.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return result.stdout;
}

async function tempEnv() {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-worktree-"));
  return {
    root,
    env: {
      PI_CODING_AGENT_DIR: join(root, "agent"),
      PI_AGENT_HUB_DIR: join(root, "hub"),
    },
  };
}

async function tempRepo() {
  const { root, env } = await tempEnv();
  const repo = join(root, "repo");
  await git(root, ["init", repo]);
  await git(repo, ["config", "user.email", "test@example.com"]);
  await git(repo, ["config", "user.name", "Test User"]);
  await writeFile(join(repo, "README.md"), "base\n", "utf8");
  await git(repo, ["add", "README.md"]);
  await git(repo, ["commit", "-m", "initial"]);
  await git(repo, ["branch", "-M", "main"]);
  return { repo, env };
}

test("branchSlug keeps readable filesystem-safe names", () => {
  assert.equal(branchSlug("feature/work tree"), "feature-work-tree");
});

test("createOwnedWorktree creates a hub-owned Git worktree", async () => {
  const { repo, env } = await tempRepo();

  const created = await createOwnedWorktree({ cwd: repo, sessionId: "1234567890abcdef", branch: "feature/worktree", env });

  assert.equal(created.worktreeRepoRoot, await realpath(repo));
  assert.equal(created.worktreeBaseBranch, "main");
  assert.equal(created.worktreeBranch, "feature/worktree");
  assert.equal(created.worktreeOwnedByHub, true);
  assert.match(created.worktreePath, new RegExp(`${worktreesDir(env).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.+1234567890ab-feature-worktree`));
  assert.equal((await git(created.worktreePath, ["branch", "--show-current"])).trim(), "feature/worktree");
});

test("createOwnedWorktree rejects invalid branch names before creating a path", async () => {
  const { repo, env } = await tempRepo();

  await assert.rejects(
    createOwnedWorktree({ cwd: repo, sessionId: "bad-branch", branch: "bad branch", env }),
    /is not a valid branch name|invalid|fatal/i,
  );
  await assert.rejects(lstat(worktreesDir(env)), /ENOENT/);
});

test("finishOwnedWorktree merges a clean worktree and removes it", async () => {
  const { repo, env } = await tempRepo();
  const created = await createOwnedWorktree({ cwd: repo, sessionId: "finish-session", branch: "feature/done", env });
  await writeFile(join(created.worktreePath, "feature.txt"), "done\n", "utf8");
  await git(created.worktreePath, ["add", "feature.txt"]);
  await git(created.worktreePath, ["commit", "-m", "feature"]);
  const session = worktreeSession(created);

  const finished = await finishOwnedWorktree({ session, env });

  assert.deepEqual(finished, {
    branch: "feature/done",
    baseBranch: "main",
    worktreePath: created.worktreePath,
    branchDeleted: true,
  });
  assert.equal(await readFile(join(repo, "feature.txt"), "utf8"), "done\n");
  await assert.rejects(lstat(created.worktreePath), /ENOENT/);
  assert.equal((await git(repo, ["branch", "--list", "feature/done"])).trim(), "");
});

test("discardWorktreeSession removes a clean worktree branch without merging", async () => {
  const { repo, env } = await tempRepo();
  const created = await createOwnedWorktree({ cwd: repo, sessionId: "discard-session", branch: "feature/discard", env });
  await writeFile(join(created.worktreePath, "discard.txt"), "discard\n", "utf8");
  await git(created.worktreePath, ["add", "discard.txt"]);
  await git(created.worktreePath, ["commit", "-m", "discard"]);
  const session = { ...worktreeSession(created), id: "discard", tmuxSession: "pi-agent-hub-discard" };
  await saveRegistry({ version: 1, sessions: [session] }, registryPath(env));

  const discarded = await discardWorktreeSession(session.id, { env });

  assert.equal(discarded.id, session.id);
  await assert.rejects(readFile(join(repo, "discard.txt"), "utf8"), /ENOENT/);
  await assert.rejects(lstat(created.worktreePath), /ENOENT/);
  assert.equal((await git(repo, ["branch", "--list", "feature/discard"])).trim(), "");
  assert.deepEqual(await loadRegistry(registryPath(env)), { version: 1, sessions: [] });
});

test("finishWorktreeSession does not kill tmux when base repo is dirty", async () => {
  const { repo, env } = await tempRepo();
  const { root: tmuxRoot } = await tempEnv();
  const log = join(tmuxRoot, "tmux.log");
  const fakeTmux = join(tmuxRoot, "tmux");
  await writeFile(fakeTmux, `#!/bin/sh\necho "$1 $2 $3" >> ${JSON.stringify(log)}\n[ "$1" = "has-session" ] && exit 0\nexit 0\n`, "utf8");
  await chmod(fakeTmux, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${tmuxRoot}:${oldPath ?? ""}`;
  try {
    const created = await createOwnedWorktree({ cwd: repo, sessionId: "dirty-base-session", branch: "feature/base-dirty", env });
    await writeFile(join(repo, "base-dirty.txt"), "dirty\n", "utf8");
    const session = { ...worktreeSession(created), id: "dirty-base", tmuxSession: "pi-agent-hub-dirty-base" };
    await saveRegistry({ version: 1, sessions: [session] }, registryPath(env));

    await assert.rejects(finishWorktreeSession(session.id, { env }), /Base repo has uncommitted changes/);

    const tmuxLog = await readFile(log, "utf8").catch(() => "");
    assert.doesNotMatch(tmuxLog, /kill-session/);
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
});

test("finishWorktreeSession removes parent, subagent rows, and heartbeats after merge", async () => {
  const { repo, env } = await tempRepo();
  const created = await createOwnedWorktree({ cwd: repo, sessionId: "app-finish-session", branch: "feature/app", env });
  await writeFile(join(created.worktreePath, "app.txt"), "app\n", "utf8");
  await git(created.worktreePath, ["add", "app.txt"]);
  await git(created.worktreePath, ["commit", "-m", "app"]);
  const parent = { ...worktreeSession(created), id: "parent", tmuxSession: "pi-agent-hub-parent" };
  const child = {
    ...createSessionRecord({ cwd: created.worktreePath, title: "smoke", now: 2 }),
    id: "child",
    tmuxSession: "pi-agent-hub-child",
    kind: "subagent" as const,
    parentId: parent.id,
    agentName: "smoke",
  };
  await saveRegistry({ version: 1, sessions: [parent, child] }, registryPath(env));
  await mkdir(join(env.PI_AGENT_HUB_DIR, "heartbeats"), { recursive: true });
  await writeFile(heartbeatPath(parent.id, env), JSON.stringify({ ok: true }), "utf8");
  await writeFile(heartbeatPath(child.id, env), JSON.stringify({ ok: true }), "utf8");

  const finished = await finishWorktreeSession(parent.id, { env });

  assert.equal(finished.id, parent.id);
  assert.equal(await readFile(join(repo, "app.txt"), "utf8"), "app\n");
  assert.deepEqual(await loadRegistry(registryPath(env)), { version: 1, sessions: [] });
  await assert.rejects(readFile(heartbeatPath(parent.id, env), "utf8"), /ENOENT/);
  await assert.rejects(readFile(heartbeatPath(child.id, env), "utf8"), /ENOENT/);
});

test("finishOwnedWorktree blocks dirty worktrees and keeps files", async () => {
  const { repo, env } = await tempRepo();
  const created = await createOwnedWorktree({ cwd: repo, sessionId: "dirty-session", branch: "feature/dirty", env });
  await writeFile(join(created.worktreePath, "dirty.txt"), "dirty\n", "utf8");

  await assert.rejects(
    finishOwnedWorktree({ session: worktreeSession(created), env }),
    /Worktree has uncommitted changes/,
  );
  assert.equal(await readFile(join(created.worktreePath, "dirty.txt"), "utf8"), "dirty\n");
  assert.equal((await git(repo, ["branch", "--show-current"])).trim(), "main");
});

function worktreeSession(created: Awaited<ReturnType<typeof createOwnedWorktree>>): ManagedSession {
  return {
    id: "session",
    title: "session",
    cwd: created.worktreePath,
    group: "default",
    tmuxSession: "pi-agent-hub-session",
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    worktreePath: created.worktreePath,
    worktreeRepoRoot: created.worktreeRepoRoot,
    worktreeBranch: created.worktreeBranch,
    worktreeBaseBranch: created.worktreeBaseBranch,
    worktreeOwnedByHub: true,
  };
}
