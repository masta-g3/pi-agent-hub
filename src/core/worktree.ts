import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { worktreePath, worktreesDir } from "./paths.js";
import type { ManagedSession } from "./types.js";

const execFileAsync = promisify(execFile);

export interface CreateWorktreeInput {
  cwd: string;
  sessionId: string;
  branch: string;
  env?: NodeJS.ProcessEnv;
}

export interface CreatedWorktree {
  cwd: string;
  worktreePath: string;
  worktreeRepoRoot: string;
  worktreeBranch: string;
  worktreeBaseBranch: string;
  worktreeOwnedByHub: true;
}

export interface FinishWorktreeInput {
  session: ManagedSession;
  env?: NodeJS.ProcessEnv;
}

export interface FinishedWorktree {
  branch: string;
  baseBranch: string;
  worktreePath: string;
  branchDeleted: boolean;
}

export async function createOwnedWorktree(input: CreateWorktreeInput): Promise<CreatedWorktree> {
  const cwd = resolve(input.cwd);
  const branch = input.branch.trim();
  if (!branch) throw new Error("Worktree branch is required");
  const root = await repoRoot(cwd);
  await validateBranchName(root, branch);
  const baseBranch = await currentBranch(root);
  if (!baseBranch) throw new Error("Cannot create worktree from detached HEAD");

  const target = worktreePath(basename(root), input.sessionId, branchSlug(branch), input.env);
  await mkdir(dirname(target), { recursive: true });
  await git(root, ["worktree", "add", "-b", branch, target]);
  return {
    cwd: target,
    worktreePath: target,
    worktreeRepoRoot: root,
    worktreeBranch: branch,
    worktreeBaseBranch: baseBranch,
    worktreeOwnedByHub: true,
  };
}

export async function finishOwnedWorktree(input: FinishWorktreeInput): Promise<FinishedWorktree> {
  const meta = requireWorktreeMetadata(input.session);
  assertOwnedWorktreePath(meta.worktreePath, input.env);
  await assertClean(meta.worktreePath, "Worktree has uncommitted changes; commit or stash before finishing");
  await assertClean(meta.worktreeRepoRoot, "Base repo has uncommitted changes; clean it before finishing");
  await git(meta.worktreeRepoRoot, ["checkout", meta.worktreeBaseBranch]);
  try {
    await git(meta.worktreeRepoRoot, ["merge", "--no-ff", "--no-edit", meta.worktreeBranch]);
  } catch (error) {
    await gitOk(meta.worktreeRepoRoot, ["merge", "--abort"]);
    throw new Error(`Merge failed; worktree was kept: ${errorMessage(error)}`);
  }
  await git(meta.worktreeRepoRoot, ["worktree", "remove", meta.worktreePath]);
  await git(meta.worktreeRepoRoot, ["worktree", "prune"]);
  const branchDeleted = await gitOk(meta.worktreeRepoRoot, ["branch", "-d", meta.worktreeBranch]);
  return {
    branch: meta.worktreeBranch,
    baseBranch: meta.worktreeBaseBranch,
    worktreePath: meta.worktreePath,
    branchDeleted,
  };
}

export async function removeOwnedWorktree(session: ManagedSession, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const meta = requireWorktreeMetadata(session);
  assertOwnedWorktreePath(meta.worktreePath, env);
  await assertClean(meta.worktreePath, "Worktree has uncommitted changes; commit or stash before removing");
  await git(meta.worktreeRepoRoot, ["worktree", "remove", meta.worktreePath]);
  await git(meta.worktreeRepoRoot, ["worktree", "prune"]);
  await gitOk(meta.worktreeRepoRoot, ["branch", "-D", meta.worktreeBranch]);
}

export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  return (await git(cwd, ["status", "--porcelain"])).trim().length > 0;
}

export async function validateBranchName(cwd: string, branch: string): Promise<void> {
  if (!branch.trim()) throw new Error("Worktree branch is required");
  await git(cwd, ["check-ref-format", "--branch", branch.trim()]);
}

export function branchSlug(branch: string): string {
  const slug = branch.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "worktree";
}

export function isWorktreeSession(session: ManagedSession): boolean {
  return Boolean(session.worktreePath && session.worktreeBranch);
}

async function assertClean(cwd: string, message: string): Promise<void> {
  if (await hasUncommittedChanges(cwd)) throw new Error(message);
}

async function repoRoot(cwd: string): Promise<string> {
  try {
    return resolve((await git(cwd, ["rev-parse", "--show-toplevel"])).trim());
  } catch {
    throw new Error("Project path is not a Git repository");
  }
}

async function currentBranch(cwd: string): Promise<string> {
  return (await git(cwd, ["branch", "--show-current"])).trim();
}

function requireWorktreeMetadata(session: ManagedSession): Required<Pick<ManagedSession, "worktreePath" | "worktreeRepoRoot" | "worktreeBranch" | "worktreeBaseBranch" | "worktreeOwnedByHub">> {
  if (!session.worktreePath || !session.worktreeRepoRoot || !session.worktreeBranch || !session.worktreeBaseBranch || session.worktreeOwnedByHub !== true) {
    throw new Error("Selected session is not a hub-owned worktree");
  }
  return {
    worktreePath: session.worktreePath,
    worktreeRepoRoot: session.worktreeRepoRoot,
    worktreeBranch: session.worktreeBranch,
    worktreeBaseBranch: session.worktreeBaseBranch,
    worktreeOwnedByHub: true,
  };
}

function assertOwnedWorktreePath(path: string, env: NodeJS.ProcessEnv = process.env): void {
  const root = resolve(worktreesDir(env));
  const target = resolve(path);
  const diff = relative(root, target);
  if (!diff || diff.startsWith("..") || isAbsolute(diff)) throw new Error("Selected session is not a hub-owned worktree");
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
    return result.stdout;
  } catch (error) {
    throw new Error(gitError(args, error));
  }
}

async function gitOk(cwd: string, args: string[]): Promise<boolean> {
  try {
    await git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

function gitError(args: string[], error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const failed = error as { stderr?: string; stdout?: string; message?: string };
    return failed.stderr?.trim() || failed.stdout?.trim() || failed.message || `git ${args.join(" ")} failed`;
  }
  return String(error);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
