import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { formatCliInstallWarning, inspectCliInstall, piBinCandidates, shouldWarnForCommand } from "../src/core/install-diagnostics.js";

async function packageRoot(root: string, version: string): Promise<string> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "pi-agent-hub", version }));
  return root;
}

async function executable(path: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "#!/bin/sh\n");
  await chmod(path, 0o755);
}

test("install diagnostics are ok when running from Pi package root", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-install-"));
  const agentDir = join(root, "agent");
  const piRoot = await packageRoot(join(agentDir, "npm", "node_modules", "pi-agent-hub"), "1.2.0");
  await executable(join(agentDir, "npm", "node_modules", ".bin", "pi-hub"));

  const status = await inspectCliInstall({
    env: { PI_CODING_AGENT_DIR: agentDir, PATH: join(agentDir, "npm", "node_modules", ".bin") },
    currentFile: join(piRoot, "dist", "cli.js"),
  });

  assert.equal(status.status, "ok");
  assert.equal(status.piVersion, "1.2.0");
  assert.equal(formatCliInstallWarning(status), undefined);
});

test("install diagnostics detect version mismatch with global running package", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-install-"));
  const agentDir = join(root, "agent");
  const piRoot = await packageRoot(join(agentDir, "npm", "node_modules", "pi-agent-hub"), "1.3.0");
  const globalRoot = await packageRoot(join(root, "global", "lib", "node_modules", "pi-agent-hub"), "1.2.0");
  await executable(join(agentDir, "npm", "node_modules", ".bin", "pi-hub"));
  await executable(join(root, "global", "bin", "pi-hub"));

  const status = await inspectCliInstall({
    env: { PI_CODING_AGENT_DIR: agentDir, PATH: [join(root, "global", "bin"), join(agentDir, "npm", "node_modules", ".bin")].join(delimiter) },
    currentFile: join(globalRoot, "dist", "cli.js"),
  });

  assert.equal(status.status, "version-mismatch");
  assert.equal(status.piPackageRoot, piRoot);
  assert.match(formatCliInstallWarning(status) ?? "", /not the Pi-installed package/);
});

test("install diagnostics detect matching-version global bin before Pi bin", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-install-"));
  const agentDir = join(root, "agent");
  const globalBin = join(root, "global", "bin");
  const piBin = join(agentDir, "npm", "node_modules", ".bin");
  await packageRoot(join(agentDir, "npm", "node_modules", "pi-agent-hub"), "1.2.0");
  const globalRoot = await packageRoot(join(root, "global", "lib", "node_modules", "pi-agent-hub"), "1.2.0");
  await executable(join(globalBin, "pi-hub"));
  await executable(join(piBin, "pi-hub"));

  const status = await inspectCliInstall({
    env: { PI_CODING_AGENT_DIR: agentDir, PATH: [globalBin, piBin].join(delimiter) },
    currentFile: join(globalRoot, "dist", "cli.js"),
  });

  assert.equal(status.status, "path-not-pi-bin");
  assert.equal(status.pathCommand, join(globalBin, "pi-hub"));
});

test("install diagnostics accept POSIX Pi bin first and symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-install-"));
  const agentDir = join(root, "agent");
  const piBin = join(agentDir, "npm", "node_modules", ".bin");
  const localBin = join(root, "local", "bin");
  const globalRoot = await packageRoot(join(root, "global", "lib", "node_modules", "pi-agent-hub"), "1.2.0");
  await packageRoot(join(agentDir, "npm", "node_modules", "pi-agent-hub"), "1.2.0");
  await executable(join(piBin, "pi-hub"));
  await mkdir(localBin, { recursive: true });
  await symlink(join(piBin, "pi-hub"), join(localBin, "pi-hub"));

  const status = await inspectCliInstall({
    env: { PI_CODING_AGENT_DIR: agentDir, PATH: localBin },
    currentFile: join(globalRoot, "dist", "cli.js"),
  });

  assert.equal(status.status, "ok");
  assert.equal(status.pathCommand, join(localBin, "pi-hub"));
});

test("install diagnostics simulate Windows Path and PATHEXT resolution", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-install-"));
  const agentDir = join(root, "agent");
  const piBin = join(agentDir, "npm", "node_modules", ".bin");
  const globalBin = join(root, "global", "bin");
  const globalRoot = await packageRoot(join(root, "global", "lib", "node_modules", "pi-agent-hub"), "1.2.0");
  await packageRoot(join(agentDir, "npm", "node_modules", "pi-agent-hub"), "1.2.0");
  await mkdir(piBin, { recursive: true });
  await mkdir(globalBin, { recursive: true });
  await writeFile(join(piBin, "pi-hub.ps1"), "");
  await writeFile(join(globalBin, "pi-hub.cmd"), "");

  const globalFirst = await inspectCliInstall({
    platform: "win32",
    env: { PI_CODING_AGENT_DIR: agentDir, Path: [globalBin, piBin].join(";"), PATHEXT: ".CMD;.PS1" },
    currentFile: join(globalRoot, "dist", "cli.js"),
  });
  assert.equal(globalFirst.status, "path-not-pi-bin");
  assert.equal(globalFirst.pathCommand, join(globalBin, "pi-hub.cmd"));

  const piFirst = await inspectCliInstall({
    platform: "win32",
    env: { PI_CODING_AGENT_DIR: agentDir, Path: [piBin, globalBin].join(";"), PATHEXT: ".CMD;.PS1" },
    currentFile: join(globalRoot, "dist", "cli.js"),
  });
  assert.equal(piFirst.status, "ok");
  assert.equal(piFirst.pathCommand, join(piBin, "pi-hub.ps1"));
});

test("install diagnostics do not warn when Pi package is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-install-"));
  const runningRoot = await packageRoot(join(root, "repo"), "1.2.0");

  const status = await inspectCliInstall({
    env: { PI_CODING_AGENT_DIR: join(root, "agent"), PATH: "" },
    currentFile: join(runningRoot, "dist", "cli.js"),
  });

  assert.equal(status.status, "pi-package-missing");
  assert.equal(formatCliInstallWarning(status), undefined);
});

test("Windows Pi bin candidates include command shims", () => {
  const candidates = piBinCandidates({ PI_CODING_AGENT_DIR: "C:/Users/me/.pi/agent" }, "win32")
    .map((candidate) => candidate.replace(/\\/g, "/"));

  assert.ok(candidates[0]?.endsWith("/npm/node_modules/.bin/pi-hub.cmd"));
  assert.ok(candidates[1]?.endsWith("/npm/node_modules/.bin/pi-hub.ps1"));
  assert.ok(candidates[2]?.endsWith("/npm/node_modules/.bin/pi-hub"));
});

test("startup warnings are limited to interactive commands", () => {
  assert.equal(shouldWarnForCommand("dashboard"), true);
  assert.equal(shouldWarnForCommand("tui"), true);
  assert.equal(shouldWarnForCommand("list"), false);
  assert.equal(shouldWarnForCommand("config"), false);
});
