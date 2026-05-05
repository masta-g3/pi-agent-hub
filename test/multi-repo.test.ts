import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, readlink, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mkdtemp } from "node:fs/promises";
import {
  allProjectCwds,
  dedupeBasenames,
  effectiveSessionCwd,
  ensureMultiRepoWorkspace,
  isMultiRepo,
  normalizeAdditionalCwds,
  projectStateCwd,
  removeMultiRepoWorkspace,
} from "../src/core/multi-repo.js";
import type { ManagedSession } from "../src/core/types.js";

function session(root: string, overrides: Partial<ManagedSession> = {}): ManagedSession {
  return {
    id: "session-one",
    title: "api",
    cwd: join(root, "api"),
    group: "default",
    tmuxSession: "pi-sessions-session",
    status: "starting",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test("dedupeBasenames appends stable numeric suffixes", () => {
  assert.deepEqual(dedupeBasenames(["/a/src", "/b/src", "/c/api", "/d/src"]), ["src", "src-1", "api", "src-2"]);
});

test("normalizeAdditionalCwds removes blanks, duplicates, and primary", () => {
  const primary = "/repo/api";
  assert.deepEqual(normalizeAdditionalCwds(primary, ["", " /repo/api ", "/repo/web", "'/repo/web'", '"/repo/shared"']), [
    resolve("/repo/web"),
    resolve("/repo/shared"),
  ]);
});

test("effective cwd separates runtime workspace from primary project state", () => {
  const single = session("/tmp/root");
  assert.equal(isMultiRepo(single), false);
  assert.equal(effectiveSessionCwd(single), single.cwd);
  assert.equal(projectStateCwd(single), single.cwd);

  const multi = { ...single, additionalCwds: ["/tmp/web"], workspaceCwd: "/tmp/workspace" };
  assert.equal(isMultiRepo(multi), true);
  assert.equal(effectiveSessionCwd(multi), "/tmp/workspace");
  assert.equal(projectStateCwd(multi), single.cwd);
  assert.deepEqual(allProjectCwds(multi), [single.cwd, "/tmp/web"]);
});

test("ensureMultiRepoWorkspace creates repo symlinks and primary .pi link", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-sessions-multi-"));
  const state = join(root, "state");
  const api = join(root, "api");
  const web = join(root, "web");
  const duplicateName = join(root, "nested", "web");
  await mkdir(api, { recursive: true });
  await mkdir(web, { recursive: true });
  await mkdir(duplicateName, { recursive: true });
  const original = session(root, { additionalCwds: [web, duplicateName] });

  const ensured = await ensureMultiRepoWorkspace(original, { PI_SESSIONS_DIR: state });

  assert.equal(ensured.workspaceCwd, join(state, "workspaces", original.id));
  assert.equal(effectiveSessionCwd(ensured), ensured.workspaceCwd);
  for (const name of ["api", "web", "web-1", ".pi"]) {
    assert.equal((await lstat(join(ensured.workspaceCwd!, name))).isSymbolicLink(), true, name);
  }
  assert.equal(resolve(await readlink(join(ensured.workspaceCwd!, "api"))), api);
  assert.equal(resolve(await readlink(join(ensured.workspaceCwd!, "web"))), web);
  assert.equal(resolve(await readlink(join(ensured.workspaceCwd!, "web-1"))), duplicateName);
  assert.equal(resolve(await readlink(join(ensured.workspaceCwd!, ".pi"))), join(api, ".pi"));

  await writeFile(join(ensured.workspaceCwd!, "stale"), "remove me", "utf8");
  await ensureMultiRepoWorkspace(ensured, { PI_SESSIONS_DIR: state });
  await assert.rejects(lstat(join(ensured.workspaceCwd!, "stale")), /ENOENT/);
});

test("ensureMultiRepoWorkspace dedupes canonical paths and degrades duplicate-only extras to single repo", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-sessions-multi-"));
  const state = join(root, "state");
  const api = join(root, "api");
  await mkdir(api, { recursive: true });
  const ensured = await ensureMultiRepoWorkspace(session(root, { additionalCwds: [api] }), { PI_SESSIONS_DIR: state });

  assert.equal(ensured.additionalCwds, undefined);
  assert.equal(ensured.workspaceCwd, undefined);
  assert.equal(effectiveSessionCwd(ensured), api);
  assert.equal(await realpath(api), await realpath(ensured.cwd));
});

test("ensureMultiRepoWorkspace fails missing or non-directory paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-sessions-multi-"));
  const state = join(root, "state");
  const api = join(root, "api");
  await mkdir(api, { recursive: true });

  await assert.rejects(
    () => ensureMultiRepoWorkspace(session(root, { additionalCwds: [join(root, "missing")] }), { PI_SESSIONS_DIR: state }),
    /Project path does not exist/,
  );

  const file = join(root, "file.txt");
  await writeFile(file, "not a dir", "utf8");
  await assert.rejects(
    () => ensureMultiRepoWorkspace(session(root, { additionalCwds: [file] }), { PI_SESSIONS_DIR: state }),
    /Project path is not a directory/,
  );
});

test("removeMultiRepoWorkspace removes only the owned workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-sessions-multi-"));
  const state = join(root, "state");
  const api = join(root, "api");
  const web = join(root, "web");
  await mkdir(api, { recursive: true });
  await mkdir(web, { recursive: true });
  const ensured = await ensureMultiRepoWorkspace(session(root, { additionalCwds: [web] }), { PI_SESSIONS_DIR: state });

  await removeMultiRepoWorkspace({ ...ensured, workspaceCwd: undefined }, { PI_SESSIONS_DIR: state });

  await assert.rejects(lstat(ensured.workspaceCwd!), /ENOENT/);
  assert.equal((await lstat(api)).isDirectory(), true);
  await assert.rejects(
    () => removeMultiRepoWorkspace({ ...ensured, workspaceCwd: api }, { PI_SESSIONS_DIR: state }),
    /Refusing to remove non-owned workspace/,
  );
});
