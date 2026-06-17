import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { worktreePath, worktreesDir } from "./paths.js";
import type { ManagedSession, ManagedWorktree } from "./types.js";

const execFileAsync = promisify(execFile);

export interface CreateWorktreeInput {
  cwd: string;
  sessionId: string;
  branch: string;
  env?: NodeJS.ProcessEnv;
}

export interface CreateWorktreesInput {
  cwds: string[];
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
  role?: "primary" | "additional";
}

export interface CreatedWorktrees {
  cwd: string;
  additionalCwds?: string[];
  worktrees: ManagedWorktree[];
  primary: CreatedWorktree;
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

export interface FinishedWorktrees {
  finished: ManagedWorktree[];
}

export class PartialWorktreeFailure extends Error {
  constructor(message: string, readonly finished: ManagedWorktree[], readonly remaining: ManagedWorktree[]) {
    super(message);
  }
}

export async function createOwnedWorktree(input: CreateWorktreeInput): Promise<CreatedWorktree> {
  const created = await createOwnedWorktrees({ cwds: [input.cwd], sessionId: input.sessionId, branch: input.branch, env: input.env });
  return created.primary;
}

export async function createOwnedWorktrees(input: CreateWorktreesInput): Promise<CreatedWorktrees> {
  const branch = input.branch.trim();
  if (!branch) throw new Error("Worktree branch is required");
  if (!input.cwds.length) throw new Error("Project path is required");

  const repos: Array<{ root: string; baseBranch: string; target: string; role: "primary" | "additional" }> = [];
  const seenRoots = new Set<string>();
  const seenTargets = new Set<string>();
  for (const cwd of input.cwds) {
    const root = await repoRoot(resolve(cwd));
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);
    await validateBranchName(root, branch);
    if (await branchExists(root, branch)) throw new Error(`Branch already exists in ${root}: ${branch}`);
    const baseBranch = await currentBranch(root);
    if (!baseBranch) throw new Error("Cannot create worktree from detached HEAD");
    const target = worktreePath(basename(root), input.sessionId, branchSlug(branch), input.env);
    if (seenTargets.has(resolve(target))) throw new Error(`Duplicate worktree target: ${target}`);
    seenTargets.add(resolve(target));
    if (await pathExists(target)) throw new Error(`Worktree path already exists: ${target}`);
    repos.push({ root, baseBranch, target, role: repos.length === 0 ? "primary" : "additional" });
  }
  if (!repos.length) throw new Error("Project path is required");

  const created: CreatedWorktree[] = [];
  try {
    for (const repo of repos) {
      await mkdir(dirname(repo.target), { recursive: true });
      await git(repo.root, ["worktree", "add", "-b", branch, repo.target]);
      created.push({
        cwd: repo.target,
        worktreePath: repo.target,
        worktreeRepoRoot: repo.root,
        worktreeBranch: branch,
        worktreeBaseBranch: repo.baseBranch,
        worktreeOwnedByHub: true,
        role: repo.role,
      });
    }
  } catch (error) {
    const rollbackErrors = await rollbackCreatedWorktrees(created, input.env);
    if (rollbackErrors.length) throw new Error(`${errorMessage(error)}; rollback failed: ${rollbackErrors.map(errorMessage).join("; ")}`);
    throw error;
  }

  const [primary, ...additional] = created;
  if (!primary) throw new Error("Project path is required");
  return {
    cwd: primary.worktreePath,
    ...(additional.length ? { additionalCwds: additional.map((item) => item.worktreePath) } : {}),
    worktrees: created.map(toManagedWorktree),
    primary,
  };
}

export async function finishOwnedWorktree(input: FinishWorktreeInput): Promise<FinishedWorktree> {
  const meta = requireWorktreeMetadata(input.session);
  const finished = await finishOne(meta, input.env);
  return {
    branch: finished.branch,
    baseBranch: finished.baseBranch,
    worktreePath: finished.path,
    branchDeleted: await branchMissing(finished.repoRoot, finished.branch),
  };
}

export async function finishOwnedWorktrees(input: FinishWorktreeInput): Promise<FinishedWorktrees> {
  await assertWorktreesReady(input.session, input.env);
  const ordered = finishOrder(sessionWorktrees(input.session));
  const finished: ManagedWorktree[] = [];
  for (const worktree of ordered) {
    try {
      await finishOne(worktree, input.env);
      finished.push(worktree);
    } catch (error) {
      const remaining = ordered.filter((item) => !finished.includes(item));
      throw new PartialWorktreeFailure(`Merge failed for ${basename(worktree.repoRoot)}; worktree was kept: ${errorMessage(error)}`, finished, remaining);
    }
  }
  return { finished };
}

export async function removeOwnedWorktree(session: ManagedSession, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const meta = requireWorktreeMetadata(session);
  await removeOne(meta, env);
}

export async function removeOwnedWorktrees(session: ManagedSession, env: NodeJS.ProcessEnv = process.env): Promise<ManagedWorktree[]> {
  await assertWorktreesClean(session, env, "Worktree has uncommitted changes; commit or stash before removing");
  const ordered = finishOrder(sessionWorktrees(session));
  const removed: ManagedWorktree[] = [];
  for (const worktree of ordered) {
    try {
      await removeOne(worktree, env);
      removed.push(worktree);
    } catch (error) {
      const remaining = ordered.filter((item) => !removed.includes(item));
      throw new PartialWorktreeFailure(`Remove failed for ${basename(worktree.repoRoot)}; worktree was kept: ${errorMessage(error)}`, removed, remaining);
    }
  }
  return removed;
}

export async function assertWorktreesReady(session: ManagedSession, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await assertWorktreesClean(session, env, "Worktree has uncommitted changes; commit or stash before finishing");
  for (const worktree of sessionWorktrees(session)) {
    if (await hasUncommittedChanges(worktree.repoRoot, { ignorePiState: true })) throw new Error("Base repo has uncommitted changes; clean it before finishing");
  }
}

export async function assertWorktreesClean(session: ManagedSession, env: NodeJS.ProcessEnv = process.env, message = "Worktree has uncommitted changes; commit or stash before finishing"): Promise<void> {
  const worktrees = sessionWorktrees(session);
  if (!worktrees.length || session.worktreeOwnedByHub !== true) throw new Error("Selected session is not a hub-owned worktree");
  for (const worktree of worktrees) {
    assertOwnedWorktreePath(worktree.path, env);
    if (await hasUncommittedChanges(worktree.path)) throw new Error(message);
  }
}

export async function hasUncommittedChanges(cwd: string, options: { ignorePiState?: boolean } = {}): Promise<boolean> {
  const lines = (await git(cwd, ["status", "--porcelain"])).split(/\r?\n/).filter(Boolean);
  if (!options.ignorePiState) return lines.length > 0;
  return lines.some((line) => !isRootPiStatusLine(line));
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
  return sessionWorktrees(session).length > 0;
}

export function sessionWorktrees(session: ManagedSession): ManagedWorktree[] {
  if (session.worktrees?.length) return session.worktrees;
  if (!session.worktreePath || !session.worktreeRepoRoot || !session.worktreeBranch || !session.worktreeBaseBranch || session.worktreeOwnedByHub !== true) return [];
  return [{ path: session.worktreePath, repoRoot: session.worktreeRepoRoot, branch: session.worktreeBranch, baseBranch: session.worktreeBaseBranch, role: "primary" }];
}

export function primaryWorktree(session: ManagedSession): ManagedWorktree | undefined {
  return sessionWorktrees(session).find((item) => item.role === "primary") ?? sessionWorktrees(session)[0];
}

export function remainingWorktreeSession(session: ManagedSession, removed: ManagedWorktree[]): ManagedSession {
  const removedPaths = new Set(removed.map((item) => item.path));
  const worktrees = sessionWorktrees(session).filter((item) => !removedPaths.has(item.path));
  const primary = primaryWorktree({ ...session, worktrees });
  return {
    ...session,
    cwd: primary?.path ?? session.cwd,
    additionalCwds: worktrees.filter((item) => item.path !== primary?.path).map((item) => item.path),
    worktrees: worktrees.length ? worktrees : undefined,
    worktreePath: primary?.path,
    worktreeRepoRoot: primary?.repoRoot,
    worktreeBranch: primary?.branch,
    worktreeBaseBranch: primary?.baseBranch,
  };
}

async function finishOne(worktree: ManagedWorktree, env: NodeJS.ProcessEnv = process.env): Promise<ManagedWorktree> {
  assertOwnedWorktreePath(worktree.path, env);
  await assertClean(worktree.path, "Worktree has uncommitted changes; commit or stash before finishing");
  await assertClean(worktree.repoRoot, "Base repo has uncommitted changes; clean it before finishing", { ignorePiState: true });
  const originalBranch = await currentBranch(worktree.repoRoot);
  await git(worktree.repoRoot, ["checkout", worktree.baseBranch]);
  try {
    await git(worktree.repoRoot, ["merge", "--no-ff", "--no-edit", worktree.branch]);
  } catch (error) {
    await gitOk(worktree.repoRoot, ["merge", "--abort"]);
    if (originalBranch) await gitOk(worktree.repoRoot, ["checkout", originalBranch]);
    throw new Error(`Merge failed; worktree was kept: ${errorMessage(error)}`);
  }
  try {
    await git(worktree.repoRoot, ["worktree", "remove", worktree.path]);
    await git(worktree.repoRoot, ["worktree", "prune"]);
    await gitOk(worktree.repoRoot, ["branch", "-d", worktree.branch]);
  } catch (error) {
    if (originalBranch) await gitOk(worktree.repoRoot, ["checkout", originalBranch]);
    throw error;
  }
  if (originalBranch && originalBranch !== worktree.branch) await gitOk(worktree.repoRoot, ["checkout", originalBranch]);
  return worktree;
}

async function removeOne(worktree: ManagedWorktree, env: NodeJS.ProcessEnv): Promise<void> {
  assertOwnedWorktreePath(worktree.path, env);
  await assertClean(worktree.path, "Worktree has uncommitted changes; commit or stash before removing");
  await git(worktree.repoRoot, ["worktree", "remove", worktree.path]);
  await git(worktree.repoRoot, ["worktree", "prune"]);
  await gitOk(worktree.repoRoot, ["branch", "-D", worktree.branch]);
}

async function assertClean(cwd: string, message: string, options: { ignorePiState?: boolean } = {}): Promise<void> {
  if (await hasUncommittedChanges(cwd, options)) throw new Error(message);
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

function requireWorktreeMetadata(session: ManagedSession): ManagedWorktree {
  const meta = primaryWorktree(session);
  if (!meta || session.worktreeOwnedByHub !== true) throw new Error("Selected session is not a hub-owned worktree");
  return meta;
}

function finishOrder(worktrees: ManagedWorktree[]): ManagedWorktree[] {
  return [...worktrees.filter((item) => item.role !== "primary"), ...worktrees.filter((item) => item.role === "primary")];
}

function toManagedWorktree(created: CreatedWorktree): ManagedWorktree {
  return {
    path: created.worktreePath,
    repoRoot: created.worktreeRepoRoot,
    branch: created.worktreeBranch,
    baseBranch: created.worktreeBaseBranch,
    role: created.role ?? "primary",
  };
}

async function rollbackCreatedWorktrees(created: CreatedWorktree[], env: NodeJS.ProcessEnv = process.env): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const worktree of [...created].reverse()) {
    try {
      await removeOne(toManagedWorktree(worktree), env);
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

function assertOwnedWorktreePath(path: string, env: NodeJS.ProcessEnv = process.env): void {
  const root = resolve(worktreesDir(env));
  const target = resolve(path);
  const diff = relative(root, target);
  if (!diff || diff.startsWith("..") || isAbsolute(diff)) throw new Error("Selected session is not a hub-owned worktree");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function branchExists(cwd: string, branch: string): Promise<boolean> {
  return gitOk(cwd, ["show-ref", "--verify", `refs/heads/${branch}`]);
}

async function branchMissing(cwd: string, branch: string): Promise<boolean> {
  return !(await branchExists(cwd, branch));
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

function isRootPiStatusLine(line: string): boolean {
  const path = line.slice(3);
  return path === ".pi" || path.startsWith(".pi/");
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
