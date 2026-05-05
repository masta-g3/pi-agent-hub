import { mkdir, realpath, rm, stat, symlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { multiRepoWorkspacePath } from "./paths.js";
import type { ManagedSession } from "./types.js";

export function isMultiRepo(session: Pick<ManagedSession, "additionalCwds" | "workspaceCwd">): boolean {
  return Boolean(session.additionalCwds?.length || session.workspaceCwd);
}

export function allProjectCwds(session: Pick<ManagedSession, "cwd" | "additionalCwds">): string[] {
  return [session.cwd, ...(session.additionalCwds ?? [])];
}

export function effectiveSessionCwd(session: ManagedSession): string {
  if (!session.additionalCwds?.length) return session.cwd;
  return session.workspaceCwd ?? multiRepoWorkspaceDir(session.id);
}

export function projectStateCwd(session: Pick<ManagedSession, "cwd">): string {
  return session.cwd;
}

export function normalizeAdditionalCwds(primary: string, additional: string[] | undefined): string[] {
  const primaryPath = resolve(primary);
  const seen = new Set([primaryPath]);
  const out: string[] = [];
  for (const input of additional ?? []) {
    const cleaned = stripQuotes(input.trim());
    if (!cleaned) continue;
    const value = resolve(cleaned);
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function dedupeBasenames(paths: string[]): string[] {
  const counts = new Map<string, number>();
  return paths.map((path) => {
    const base = basename(path) || "repo";
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  });
}

export function multiRepoWorkspaceDir(sessionId: string, env: NodeJS.ProcessEnv = process.env): string {
  return multiRepoWorkspacePath(sessionId, env);
}

export async function ensureMultiRepoWorkspace(session: ManagedSession, env: NodeJS.ProcessEnv = process.env): Promise<ManagedSession> {
  const inputPaths = allProjectCwds(session);
  if (!session.additionalCwds?.length) return { ...session, additionalCwds: undefined, workspaceCwd: undefined };

  const paths = await canonicalProjectPaths(inputPaths);
  const primary = paths[0];
  if (!primary) throw new Error("Primary project path is required");
  const additional = dedupeCanonicalProjects(primary, paths.slice(1));
  if (!additional.length) return { ...session, cwd: primary.path, additionalCwds: undefined, workspaceCwd: undefined };

  const workspaceCwd = multiRepoWorkspaceDir(session.id, env);
  assertOwnedWorkspace(session.id, workspaceCwd, env);
  await rm(workspaceCwd, { recursive: true, force: true });
  await mkdir(workspaceCwd, { recursive: true });
  await mkdir(join(primary.path, ".pi"), { recursive: true });

  const projectPaths = [primary.path, ...additional.map((item) => item.path)];
  const linkNames = dedupeBasenames(projectPaths);
  for (let i = 0; i < projectPaths.length; i += 1) {
    await symlink(projectPaths[i]!, join(workspaceCwd, linkNames[i]!), "dir");
  }
  await symlink(join(primary.path, ".pi"), join(workspaceCwd, ".pi"), "dir");

  return {
    ...session,
    cwd: primary.path,
    additionalCwds: additional.map((item) => item.path),
    workspaceCwd,
  };
}

export async function removeMultiRepoWorkspace(session: ManagedSession, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const workspaceCwd = session.workspaceCwd ?? (session.additionalCwds?.length ? multiRepoWorkspaceDir(session.id, env) : undefined);
  if (!workspaceCwd) return;
  assertOwnedWorkspace(session.id, workspaceCwd, env);
  await rm(workspaceCwd, { recursive: true, force: true });
}

async function canonicalProjectPaths(paths: string[]): Promise<Array<{ path: string; real: string }>> {
  const out: Array<{ path: string; real: string }> = [];
  for (const path of paths) {
    const resolved = resolve(path);
    const info = await stat(resolved).catch((error: unknown) => {
      if (isNotFound(error)) throw new Error(`Project path does not exist: ${resolved}`);
      throw error;
    });
    if (!info.isDirectory()) throw new Error(`Project path is not a directory: ${resolved}`);
    out.push({ path: resolved, real: await realpath(resolved) });
  }
  return out;
}

function dedupeCanonicalProjects(primary: { path: string; real: string }, additional: Array<{ path: string; real: string }>): Array<{ path: string; real: string }> {
  const seen = new Set([primary.real]);
  const out: Array<{ path: string; real: string }> = [];
  for (const item of additional) {
    if (seen.has(item.real)) continue;
    seen.add(item.real);
    out.push(item);
  }
  return out;
}

function assertOwnedWorkspace(sessionId: string, workspaceCwd: string, env: NodeJS.ProcessEnv): void {
  const expected = multiRepoWorkspaceDir(sessionId, env);
  if (resolve(workspaceCwd) !== resolve(expected)) throw new Error(`Refusing to remove non-owned workspace: ${workspaceCwd}`);
}

function stripQuotes(value: string): string {
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) return value.slice(1, -1);
  return value;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
